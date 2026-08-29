/**
 * Bank & card data module.
 *
 * Reads merchant bank and credit-card activity so fiat settlements can be reconciled
 * against what CoinPay believes it paid out. Plaid is the default provider (widest US
 * institution coverage); the registry exists so a second provider can be added without
 * callers changing.
 */

import { plaidProvider } from './plaid';
import { BankDataError, type BankDataProvider, type BankDataProviderName } from './types';

export * from './types';
export * from './reconcile';
export { resetPlaidClient } from './plaid';

const PROVIDERS: Record<BankDataProviderName, BankDataProvider> = {
  plaid: plaidProvider,
};

/**
 * Whether bank linking is switched on for this deployment.
 *
 * Off by default. The feature costs money per connected account per month, so it must
 * be an explicit opt-in rather than something that turns itself on the moment
 * credentials happen to be present in the environment.
 */
export function isBankDataEnabled(): boolean {
  return process.env.BANKDATA_ENABLED === 'true';
}

/** Resolve the configured provider, or throw if the deployment is misconfigured. */
export function getBankDataProvider(): BankDataProvider {
  const name = (process.env.BANKDATA_PROVIDER || 'plaid') as BankDataProviderName;
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new BankDataError(
      `Unknown BANKDATA_PROVIDER "${name}" (expected: ${Object.keys(PROVIDERS).join(', ')})`,
      'plaid',
    );
  }
  return provider;
}
