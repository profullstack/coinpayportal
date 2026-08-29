import 'server-only';

/**
 * Which upstream a finance connection talks to.
 *
 * The two providers answer the same question — "what is in this merchant's
 * accounts?" — so they are normalised to one shape (`SimpleFinAccountSet`) and
 * `sync.ts` stays single-path. The name is historical: SimpleFIN was here first
 * and its shape was already the internal one, so Plaid adapts to it rather than
 * both adapting to a third format nobody would gain from.
 *
 * They differ in ways that matter to the caller, not to the sync loop:
 *
 *   SimpleFIN — the merchant mints a setup token at the bridge and pastes it.
 *               Cheap, open, community-scale coverage.
 *   Plaid     — the merchant links inside our page. Widest US coverage; billed
 *               per connected account per month, so it is opt-in per deployment.
 */

import { fetchAccountSet, type SimpleFinAccountSet } from './simplefin';
import { fetchPlaidAccountSet, isPlaidConfigured } from './plaid';

export const FINANCE_PROVIDERS = ['simplefin', 'plaid'] as const;
export type FinanceProvider = (typeof FINANCE_PROVIDERS)[number];

export function isFinanceProvider(value: unknown): value is FinanceProvider {
  return typeof value === 'string' && (FINANCE_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Whether Plaid may be offered to merchants here.
 *
 * Two gates, deliberately. Credentials being present is not consent to spend:
 * Plaid bills per connected account per month, so a deployment must also say
 * `FINANCES_PLAID_ENABLED=true` before the link button appears.
 */
export function isPlaidEnabled(): boolean {
  return process.env.FINANCES_PLAID_ENABLED === 'true' && isPlaidConfigured();
}

export interface ProviderFetchOptions {
  startDate?: Date;
  /** Include not-yet-posted transactions (SimpleFIN only; Plaid always sends them). */
  pending?: boolean;
  /** Institution label stored on the connection, used to name the account's org. */
  orgName?: string | null;
}

/**
 * Fetch one connection's accounts and transactions, whoever provides them.
 *
 * `credential` is the decrypted contents of `access_url_encrypted` — a SimpleFIN
 * access URL or a Plaid access token depending on the provider. Both are live
 * read credentials for someone's bank, so neither is ever logged or returned.
 */
export async function fetchAccountSetForProvider(
  provider: string,
  credential: string,
  options: ProviderFetchOptions = {},
): Promise<SimpleFinAccountSet> {
  switch (provider) {
    case 'plaid':
      return fetchPlaidAccountSet(credential, {
        startDate: options.startDate,
        orgName: options.orgName,
      });

    case 'simplefin':
      return fetchAccountSet(credential, {
        startDate: options.startDate,
        pending: options.pending,
      });

    default:
      // A provider we cannot service must fail loudly. Defaulting to SimpleFIN
      // would hand a Plaid token to the wrong client and report the resulting
      // parse failure as a bank problem.
      throw new Error(`Unknown finance provider "${provider}"`);
  }
}
