/**
 * The USD account partner registry.
 *
 * Off unless configured, twice over: USD_ACCOUNTS_ENABLED=1 is the master flag,
 * and a partner must also report itself configured (keys present, or the dev
 * stub opted into outside production). Either missing and the answer is null,
 * which every caller must treat as "this feature does not exist right now".
 */

import { usdAccountsFlagOn, type UsdAccountProvider } from './types';
import { StubUsdAccountProvider } from './stub';
import { ModernTreasuryProvider } from './modern-treasury';

let registry: UsdAccountProvider[] | null = null;

/** Every known partner, configured or not. Real partners first; the stub last. */
export function getUsdAccountProviders(): UsdAccountProvider[] {
  registry ??= [new ModernTreasuryProvider(), new StubUsdAccountProvider()];
  return registry;
}

/** The partner new accounts are opened with, or null when the feature is off. */
export function getActiveUsdAccountProvider(): UsdAccountProvider | null {
  if (!usdAccountsFlagOn()) return null;
  return getUsdAccountProviders().find((p) => p.isConfigured()) ?? null;
}

/**
 * A specific partner by id, for its webhook route. Null when the flag is off
 * or that partner is not configured, so an unconfigured partner's endpoint
 * cannot be used to inject events.
 */
export function getUsdAccountProvider(id: string): UsdAccountProvider | null {
  if (!usdAccountsFlagOn()) return null;
  return getUsdAccountProviders().find((p) => p.id === id && p.isConfigured()) ?? null;
}

export function usdAccountsEnabled(): boolean {
  return getActiveUsdAccountProvider() !== null;
}

/** Test seam. */
export function resetUsdAccountProviderRegistry(): void {
  registry = null;
}
