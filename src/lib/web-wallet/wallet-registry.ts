/**
 * Multi-Wallet Registry
 *
 * Manages multiple wallets in localStorage under:
 * - coinpay_wallets: Record<string, WalletEntry>
 * - coinpay_active_wallet: string (wallet ID)
 */

import type { EncryptedData } from './client-crypto';

export interface WalletEntry {
  id: string;
  label: string;
  encrypted: EncryptedData;
  createdAt: string;
  chains: string[];
}

const REGISTRY_KEY = 'coinpay_wallets';
const ACTIVE_KEY = 'coinpay_active_wallet';
const MAX_WALLETS = 10;

export function getWalletRegistry(): Record<string, WalletEntry> {
  const raw = localStorage.getItem(REGISTRY_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveWalletRegistry(
  registry: Record<string, WalletEntry>
): void {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
}

export function getActiveWalletId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveWalletId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function getActiveWallet(): WalletEntry | null {
  const id = getActiveWalletId();
  if (!id) return null;
  const registry = getWalletRegistry();
  return registry[id] ?? null;
}

export function addWalletToRegistry(entry: WalletEntry): void {
  const registry = getWalletRegistry();
  if (
    Object.keys(registry).length >= MAX_WALLETS &&
    !registry[entry.id]
  ) {
    throw new Error(`Maximum of ${MAX_WALLETS} wallets reached`);
  }
  registry[entry.id] = entry;
  saveWalletRegistry(registry);
}

export function removeWalletFromRegistry(id: string): void {
  const registry = getWalletRegistry();
  delete registry[id];
  saveWalletRegistry(registry);

  // If we deleted the active wallet, switch to another or clear
  if (getActiveWalletId() === id) {
    const remaining = Object.keys(registry);
    if (remaining.length > 0) {
      setActiveWalletId(remaining[0]);
    } else {
      localStorage.removeItem(ACTIVE_KEY);
    }
  }
}

export function updateWalletInRegistry(
  id: string,
  updates: Partial<Omit<WalletEntry, 'id'>>
): void {
  const registry = getWalletRegistry();
  if (!registry[id]) return;
  registry[id] = { ...registry[id], ...updates };
  saveWalletRegistry(registry);
}

export function getWalletCount(): number {
  return Object.keys(getWalletRegistry()).length;
}

export function hasAnyWallet(): boolean {
  return (
    getWalletCount() > 0 ||
    localStorage.getItem('coinpay_wallet') !== null
  );
}

export function getAllWallets(): WalletEntry[] {
  const registry = getWalletRegistry();
  return Object.values(registry).sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

/** Listen for cross-tab registry changes */
export function onWalletRegistryChange(callback: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === REGISTRY_KEY || e.key === ACTIVE_KEY) {
      callback();
    }
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
