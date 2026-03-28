'use client';

/**
 * Web Wallet Context Provider
 *
 * Manages wallet state including:
 * - Multi-wallet registry in localStorage
 * - Encrypted seed storage per wallet
 * - SDK instance with auth
 * - Auto-lock on inactivity
 * - Lock/unlock state
 * - Real-time balance polling
 * - Lock on tab close (visibility change)
 * - Wallet switching
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { Wallet } from '@/lib/wallet-sdk';
import type { WalletChain } from '@/lib/web-wallet/identity';
import {
  encryptWithPassword,
  decryptWithPassword,
} from '@/lib/web-wallet/client-crypto';
import {
  type WalletEntry,
  getActiveWalletId,
  setActiveWalletId,
  getActiveWallet,
  addWalletToRegistry,
  removeWalletFromRegistry,
  updateWalletInRegistry,
  getAllWallets,
  hasAnyWallet,
  getWalletCount,
  onWalletRegistryChange,
} from '@/lib/web-wallet/wallet-registry';
import { ensureMigrated } from '@/lib/web-wallet/migration';

interface BalanceInfo {
  totalUsd: number;
  lastUpdated: number;
}

interface WalletState {
  /** Whether any wallet exists in localStorage */
  hasWallet: boolean;
  /** Whether the wallet is currently unlocked */
  isUnlocked: boolean;
  /** The SDK wallet instance (null when locked) */
  wallet: Wallet | null;
  /** The wallet ID */
  walletId: string | null;
  /** Supported chains */
  chains: string[];
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Cached balance info for real-time updates */
  balanceInfo: BalanceInfo | null;
  /** Active wallet ID from registry */
  activeWalletId: string | null;
  /** All wallets in registry */
  wallets: WalletEntry[];
}

interface WalletActions {
  /** Create a new wallet with password */
  createWallet: (
    password: string,
    options?: { words?: 12 | 24; chains?: string[]; label?: string }
  ) => Promise<{ mnemonic: string; walletId: string }>;
  /** Import wallet from mnemonic with password */
  importWallet: (
    mnemonic: string,
    password: string,
    options?: { chains?: string[]; label?: string }
  ) => Promise<{ walletId: string }>;
  /** Unlock the wallet with password */
  unlock: (password: string) => Promise<boolean>;
  /** Lock the wallet */
  lock: () => void;
  /** Delete wallet from device */
  deleteWallet: () => void;
  /** Reset error */
  clearError: () => void;
  /** Change the wallet password */
  changePassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<boolean>;
  /** Refresh balance data */
  refreshBalance: () => Promise<void>;
  /** Refresh chains list after deriving new addresses */
  refreshChains: () => Promise<void>;
  /** Re-sync wallet record from currently unlocked seed phrase */
  resyncWalletFromSeed: () => Promise<{ walletId: string }>;
  /** Switch to a different wallet */
  switchWallet: (id: string) => void;
  /** Update a wallet's label */
  updateWalletLabel: (id: string, label: string) => void;
}

type WalletContextType = WalletState & WalletActions;

const WalletContext = createContext<WalletContextType | null>(null);

const DEFAULT_CHAINS = [
  'BTC', 'BCH', 'ETH', 'POL', 'SOL',
  'DOGE', 'XRP', 'ADA', 'BNB', 'LN',
  'USDC_ETH', 'USDC_POL', 'USDC_SOL',
  'USDT_ETH', 'USDT_POL', 'USDT_SOL',
];
const AUTO_LOCK_MS = 15 * 60 * 1000; // 15 minutes
const BALANCE_POLL_MS = 30_000; // 30 seconds

function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL || (process.env.NODE_ENV === 'production' ? 'https://coinpayportal.com' : 'http://localhost:3000');
}

/** Reload wallets + active ID from registry into state */
function loadRegistryState() {
  const wallets = getAllWallets();
  const activeId = getActiveWalletId();
  const active = activeId ? wallets.find((w) => w.id === activeId) : null;
  return {
    wallets,
    activeWalletId: active?.id ?? (wallets[0]?.id ?? null),
    hasWallet: wallets.length > 0,
    walletId: active?.id ?? (wallets[0]?.id ?? null),
    chains: active?.chains ?? (wallets[0]?.chains ?? []),
  };
}

export function WebWalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    hasWallet: false,
    isUnlocked: false,
    wallet: null,
    walletId: null,
    chains: [],
    isLoading: true,
    error: null,
    balanceInfo: null,
    activeWalletId: null,
    wallets: [],
  });

  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activityRef = useRef<number>(Date.now());
  const balancePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Run migration + load registry on mount
  useEffect(() => {
    ensureMigrated();
    const reg = loadRegistryState();

    // If migration set an active wallet, also fix it
    if (reg.activeWalletId && !getActiveWalletId()) {
      setActiveWalletId(reg.activeWalletId);
    }

    setState((s) => ({
      ...s,
      ...reg,
      isLoading: false,
    }));
  }, []);

  // Cross-tab sync
  useEffect(() => {
    const unsub = onWalletRegistryChange(() => {
      const reg = loadRegistryState();
      setState((s) => ({
        ...s,
        ...reg,
        // If the active wallet changed and we're unlocked for a different one, lock
        ...(s.isUnlocked && s.walletId !== reg.activeWalletId
          ? { isUnlocked: false, wallet: null, balanceInfo: null }
          : {}),
      }));
    });
    return unsub;
  }, []);

  // Auto-lock timer
  const resetLockTimer = useCallback(() => {
    activityRef.current = Date.now();
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
    }
    lockTimerRef.current = setTimeout(() => {
      setState((s) => {
        if (s.isUnlocked) {
          s.wallet?.destroy();
          return {
            ...s,
            isUnlocked: false,
            wallet: null,
            error: null,
            balanceInfo: null,
          };
        }
        return s;
      });
    }, AUTO_LOCK_MS);
  }, []);

  // Listen for activity to reset the timer
  useEffect(() => {
    if (!state.isUnlocked) return;

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    const handler = () => resetLockTimer();

    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    resetLockTimer();

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    };
  }, [state.isUnlocked, resetLockTimer]);

  // Lock on tab close / visibility change
  useEffect(() => {
    if (!state.isUnlocked) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setState((s) => {
          if (s.isUnlocked) {
            s.wallet?.destroy();
            return {
              ...s,
              isUnlocked: false,
              wallet: null,
              error: null,
              balanceInfo: null,
            };
          }
          return s;
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [state.isUnlocked]);

  // Real-time balance polling
  const refreshBalance = useCallback(async () => {
    const w = state.wallet;
    if (!w) return;

    try {
      const data = await w.getTotalBalanceUSD();
      setState((s) => ({
        ...s,
        balanceInfo: {
          totalUsd: data.totalUsd,
          lastUpdated: Date.now(),
        },
      }));
    } catch (err) {
      console.error('Balance poll failed:', err);
    }
  }, [state.wallet]);

  useEffect(() => {
    if (!state.isUnlocked || !state.wallet) {
      if (balancePollRef.current) {
        clearInterval(balancePollRef.current);
        balancePollRef.current = null;
      }
      return;
    }

    refreshBalance();
    balancePollRef.current = setInterval(refreshBalance, BALANCE_POLL_MS);

    return () => {
      if (balancePollRef.current) {
        clearInterval(balancePollRef.current);
        balancePollRef.current = null;
      }
    };
  }, [state.isUnlocked, state.wallet, refreshBalance]);

  const createWallet = useCallback(
    async (
      password: string,
      options?: { words?: 12 | 24; chains?: string[]; label?: string }
    ) => {
      setState((s) => ({ ...s, isLoading: true, error: null }));
      try {
        const chains = (options?.chains || DEFAULT_CHAINS) as WalletChain[];
        const wallet = await Wallet.create({
          baseUrl: getBaseUrl(),
          chains,
          words: options?.words || 12,
        });

        const mnemonic = wallet.getMnemonic()!;
        const encrypted = await encryptWithPassword(mnemonic, password);

        const label =
          options?.label?.trim() || `Wallet ${getWalletCount() + 1}`;

        const entry: WalletEntry = {
          id: wallet.walletId,
          label,
          encrypted,
          createdAt: new Date().toISOString(),
          chains,
        };
        addWalletToRegistry(entry);
        setActiveWalletId(wallet.walletId);

        const reg = loadRegistryState();

        setState((s) => ({
          ...s,
          ...reg,
          isUnlocked: true,
          wallet,
          walletId: wallet.walletId,
          chains,
          isLoading: false,
        }));

        return { mnemonic, walletId: wallet.walletId };
      } catch (err: unknown) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to create wallet',
        }));
        throw err;
      }
    },
    []
  );

  const importWallet = useCallback(
    async (
      mnemonic: string,
      password: string,
      options?: { chains?: string[]; label?: string }
    ) => {
      setState((s) => ({ ...s, isLoading: true, error: null }));
      try {
        const chains = (options?.chains || DEFAULT_CHAINS) as WalletChain[];
        const wallet = await Wallet.fromSeed(mnemonic, {
          baseUrl: getBaseUrl(),
          chains,
        });

        const encrypted = await encryptWithPassword(mnemonic, password);
        const label =
          options?.label?.trim() || `Wallet ${getWalletCount() + 1}`;

        const entry: WalletEntry = {
          id: wallet.walletId,
          label,
          encrypted,
          createdAt: new Date().toISOString(),
          chains,
        };
        addWalletToRegistry(entry);
        setActiveWalletId(wallet.walletId);

        const reg = loadRegistryState();

        setState((s) => ({
          ...s,
          ...reg,
          isUnlocked: true,
          wallet,
          walletId: wallet.walletId,
          chains,
          isLoading: false,
        }));

        return { walletId: wallet.walletId };
      } catch (err: unknown) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to import wallet',
        }));
        throw err;
      }
    },
    []
  );

  const unlock = useCallback(async (password: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const entry = getActiveWallet();
      if (!entry) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: 'No wallet found',
        }));
        return false;
      }

      const mnemonic = await decryptWithPassword(entry.encrypted, password);
      if (!mnemonic) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: 'Incorrect password',
        }));
        return false;
      }

      const wallet = await Wallet.fromSeed(mnemonic, {
        baseUrl: getBaseUrl(),
        chains: entry.chains as WalletChain[],
      });

      setState((s) => ({
        ...s,
        isUnlocked: true,
        wallet,
        walletId: entry.id,
        chains: entry.chains,
        isLoading: false,
        error: null,
      }));

      return true;
    } catch (err: unknown) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to unlock wallet',
      }));
      return false;
    }
  }, []);

  const resyncWalletFromSeed = useCallback(async (): Promise<{ walletId: string }> => {
    const mnemonic = state.wallet?.getMnemonic();
    if (!mnemonic) {
      throw new Error('Wallet must be unlocked to re-sync from seed phrase');
    }

    const chains = ((state.chains?.length ? state.chains : DEFAULT_CHAINS) as WalletChain[]);

    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const wallet = await Wallet.fromSeed(mnemonic, {
        baseUrl: getBaseUrl(),
        chains,
      });

      // Update the registry entry
      const activeId = state.activeWalletId;
      if (activeId) {
        updateWalletInRegistry(activeId, {
          chains,
        });
        // If walletId changed, we need to handle that
        if (wallet.walletId !== activeId) {
          // Remove old entry, add new one
          const entry = getActiveWallet();
          if (entry) {
            removeWalletFromRegistry(activeId);
            addWalletToRegistry({
              ...entry,
              id: wallet.walletId,
              chains,
            });
            setActiveWalletId(wallet.walletId);
          }
        }
      }

      const reg = loadRegistryState();

      setState((s) => ({
        ...s,
        ...reg,
        isUnlocked: true,
        wallet,
        walletId: wallet.walletId,
        chains,
        isLoading: false,
      }));

      return { walletId: wallet.walletId };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to re-sync wallet from seed phrase';
      setState((s) => ({ ...s, isLoading: false, error: message }));
      throw err;
    }
  }, [state.wallet, state.chains, state.activeWalletId]);

  const lock = useCallback(() => {
    state.wallet?.destroy();
    setState((s) => ({
      ...s,
      isUnlocked: false,
      wallet: null,
      error: null,
      balanceInfo: null,
    }));
  }, [state.wallet]);

  const deleteWallet = useCallback(() => {
    state.wallet?.destroy();

    const activeId = state.activeWalletId;
    if (activeId) {
      removeWalletFromRegistry(activeId);
    }

    const reg = loadRegistryState();

    setState({
      ...reg,
      isUnlocked: false,
      wallet: null,
      isLoading: false,
      error: null,
      balanceInfo: null,
    });
  }, [state.wallet, state.activeWalletId]);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<boolean> => {
      const entry = getActiveWallet();
      if (!entry) return false;

      // Verify current password
      const mnemonic = await decryptWithPassword(
        entry.encrypted,
        currentPassword
      );
      if (!mnemonic) return false;

      // Re-encrypt with new password
      const newEncrypted = await encryptWithPassword(mnemonic, newPassword);
      updateWalletInRegistry(entry.id, { encrypted: newEncrypted });
      return true;
    },
    []
  );

  const refreshChains = useCallback(async () => {
    const w = state.wallet;
    if (!w) return;

    try {
      const addresses = await w.getAddresses();
      const currentChains = [...new Set(addresses.map((a) => a.chain))];

      // Update registry
      const activeId = state.activeWalletId;
      if (activeId) {
        updateWalletInRegistry(activeId, { chains: currentChains });
      }

      setState((s) => ({
        ...s,
        chains: currentChains,
        wallets: getAllWallets(),
      }));
    } catch (err) {
      console.error('Failed to refresh chains:', err);
    }
  }, [state.wallet, state.activeWalletId]);

  const switchWallet = useCallback(
    (id: string) => {
      // Lock current wallet
      state.wallet?.destroy();

      setActiveWalletId(id);
      const reg = loadRegistryState();
      const target = reg.wallets.find((w) => w.id === id);

      setState((s) => ({
        ...s,
        ...reg,
        isUnlocked: false,
        wallet: null,
        walletId: id,
        chains: target?.chains ?? [],
        error: null,
        balanceInfo: null,
      }));
    },
    [state.wallet]
  );

  const updateWalletLabel = useCallback((id: string, label: string) => {
    if (!label.trim()) return;
    updateWalletInRegistry(id, { label: label.trim() });
    setState((s) => ({
      ...s,
      wallets: getAllWallets(),
    }));
  }, []);

  return (
    <WalletContext.Provider
      value={{
        ...state,
        createWallet,
        importWallet,
        unlock,
        lock,
        deleteWallet,
        clearError,
        changePassword,
        refreshBalance,
        refreshChains,
        resyncWalletFromSeed,
        switchWallet,
        updateWalletLabel,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWebWallet(): WalletContextType {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWebWallet must be used within a WebWalletProvider');
  }
  return ctx;
}
