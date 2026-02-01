'use client';

/**
 * Web Wallet Context Provider
 *
 * Manages wallet state including:
 * - Encrypted seed storage in localStorage
 * - SDK instance with auth
 * - Auto-lock on inactivity
 * - Lock/unlock state
 * - Real-time balance polling
 * - Lock on tab close (visibility change)
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
import {
  encryptWithPassword,
  decryptWithPassword,
  saveWalletToStorage,
  loadWalletFromStorage,
  removeWalletFromStorage,
  hasStoredWallet,
  type StoredWallet,
} from '@/lib/web-wallet/client-crypto';

interface BalanceInfo {
  totalUsd: number;
  lastUpdated: number;
}

interface WalletState {
  /** Whether a wallet exists in localStorage */
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
}

interface WalletActions {
  /** Create a new wallet with password */
  createWallet: (
    password: string,
    options?: { words?: 12 | 24; chains?: string[] }
  ) => Promise<{ mnemonic: string; walletId: string }>;
  /** Import wallet from mnemonic with password */
  importWallet: (
    mnemonic: string,
    password: string,
    options?: { chains?: string[] }
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
}

type WalletContextType = WalletState & WalletActions;

const WalletContext = createContext<WalletContextType | null>(null);

const DEFAULT_CHAINS = ['BTC', 'BCH', 'ETH', 'POL', 'SOL'];
const AUTO_LOCK_MS = 15 * 60 * 1000; // 15 minutes
const BALANCE_POLL_MS = 30_000; // 30 seconds

function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:8080';
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
  });

  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activityRef = useRef<number>(Date.now());
  const balancePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check for stored wallet on mount
  useEffect(() => {
    const stored = hasStoredWallet();
    const data = stored ? loadWalletFromStorage() : null;
    setState((s) => ({
      ...s,
      hasWallet: stored,
      walletId: data?.walletId ?? null,
      chains: data?.chains ?? [],
      isLoading: false,
    }));
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
    } catch {
      // Silently fail — old balance stays displayed
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

    // Initial fetch
    refreshBalance();

    // Start polling
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
      options?: { words?: 12 | 24; chains?: string[] }
    ) => {
      setState((s) => ({ ...s, isLoading: true, error: null }));
      try {
        const chains = (options?.chains || DEFAULT_CHAINS) as any[];
        const wallet = await Wallet.create({
          baseUrl: getBaseUrl(),
          chains,
          words: options?.words || 12,
        });

        const mnemonic = wallet.getMnemonic()!;
        const encrypted = await encryptWithPassword(mnemonic, password);

        const stored: StoredWallet = {
          walletId: wallet.walletId,
          encrypted,
          createdAt: new Date().toISOString(),
          chains,
        };
        saveWalletToStorage(stored);

        setState((s) => ({
          ...s,
          hasWallet: true,
          isUnlocked: true,
          wallet,
          walletId: wallet.walletId,
          chains,
          isLoading: false,
        }));

        return { mnemonic, walletId: wallet.walletId };
      } catch (err: any) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err.message || 'Failed to create wallet',
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
      options?: { chains?: string[] }
    ) => {
      setState((s) => ({ ...s, isLoading: true, error: null }));
      try {
        const chains = (options?.chains || DEFAULT_CHAINS) as any[];
        const wallet = await Wallet.fromSeed(mnemonic, {
          baseUrl: getBaseUrl(),
          chains,
        });

        const encrypted = await encryptWithPassword(mnemonic, password);
        const stored: StoredWallet = {
          walletId: wallet.walletId,
          encrypted,
          createdAt: new Date().toISOString(),
          chains,
        };
        saveWalletToStorage(stored);

        setState((s) => ({
          ...s,
          hasWallet: true,
          isUnlocked: true,
          wallet,
          walletId: wallet.walletId,
          chains,
          isLoading: false,
        }));

        return { walletId: wallet.walletId };
      } catch (err: any) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err.message || 'Failed to import wallet',
        }));
        throw err;
      }
    },
    []
  );

  const unlock = useCallback(async (password: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const stored = loadWalletFromStorage();
      if (!stored) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: 'No wallet found',
        }));
        return false;
      }

      const mnemonic = await decryptWithPassword(stored.encrypted, password);
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
        chains: stored.chains as any[],
      });

      setState((s) => ({
        ...s,
        isUnlocked: true,
        wallet,
        walletId: stored.walletId,
        chains: stored.chains,
        isLoading: false,
        error: null,
      }));

      return true;
    } catch (err: any) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err.message || 'Failed to unlock wallet',
      }));
      return false;
    }
  }, []);

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
    removeWalletFromStorage();
    setState({
      hasWallet: false,
      isUnlocked: false,
      wallet: null,
      walletId: null,
      chains: [],
      isLoading: false,
      error: null,
      balanceInfo: null,
    });
  }, [state.wallet]);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<boolean> => {
      const stored = loadWalletFromStorage();
      if (!stored) return false;

      // Verify current password
      const mnemonic = await decryptWithPassword(
        stored.encrypted,
        currentPassword
      );
      if (!mnemonic) return false;

      // Re-encrypt with new password
      const newEncrypted = await encryptWithPassword(mnemonic, newPassword);
      const updated: StoredWallet = {
        ...stored,
        encrypted: newEncrypted,
      };
      saveWalletToStorage(updated);
      return true;
    },
    []
  );

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
