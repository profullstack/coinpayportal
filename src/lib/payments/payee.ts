/**
 * Payee (recipient) resolution for invoices and proposals.
 *
 * Rule: a CoinPay invoice or proposal must ALWAYS name the address the money
 * ends up at. There is no implicit fallback — historically an invoice with no
 * `merchant_wallet_address` was sent through `createPayment` with an empty
 * string, which quietly routed the merchant's net to the platform wallet
 * instead of failing. Every path now resolves a payee or refuses.
 *
 * Resolution order:
 *   1. an address supplied explicitly by the caller (manual entry)
 *   2. the business's own wallet for that coin        (`business_wallets`)
 *   3. the account-global wallet for that coin        (`merchant_wallets`)
 *   4. a linked non-custodial web wallet              (`wallet_account_links`)
 *
 * When none of 2-4 produce an address the caller gets `PAYEE_REQUIRED`, which
 * clients render as "enter a payee address" rather than a dead end. That is the
 * "even manually" half of the rule: not being able to derive a wallet from the
 * session is never a reason to create a payee-less invoice or proposal.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getPaymentReceivingWallet, type WalletSource } from '@/lib/wallets/supported-coins';
import { isValidPayoutAddress } from '@/lib/blockchain/address-format';

/** Where a resolved payee address came from. */
export type PayeeSource = WalletSource | 'manual' | 'inherited';

export interface ResolvePayeeInput {
  businessId: string;
  merchantId: string;
  /** Chain/coin the payment settles on. */
  cryptocurrency: string;
  /** Address typed by the user, or carried over from a previous revision. */
  requestedAddress?: string | null;
  /** Marks a non-empty `requestedAddress` as carried over rather than typed. */
  inherited?: boolean;
}

export type ResolvePayeeResult =
  | { ok: true; address: string; source: PayeeSource }
  | { ok: false; code: PayeeErrorCode; error: string; status: number };

export type PayeeErrorCode =
  | 'PAYEE_REQUIRED'
  | 'PAYEE_INVALID'
  | 'CRYPTO_REQUIRED'
  | 'LOOKUP_FAILED';

/** Human-facing ask that always accompanies PAYEE_REQUIRED. */
export function payeeRequiredMessage(cryptocurrency: string): string {
  return (
    `No ${cryptocurrency} wallet could be determined from your account ` +
    `(business wallets, global wallets, or a linked web wallet). ` +
    `Enter a ${cryptocurrency} payee address to continue.`
  );
}

/**
 * Resolve the address a payment should settle to, or explain what the caller
 * must supply. Never returns a blank address.
 */
export async function resolvePayee(
  supabase: SupabaseClient,
  input: ResolvePayeeInput,
): Promise<ResolvePayeeResult> {
  const cryptocurrency = (input.cryptocurrency || '').trim().toUpperCase();
  if (!cryptocurrency) {
    return {
      ok: false,
      code: 'CRYPTO_REQUIRED',
      error: 'A cryptocurrency must be selected before a payee can be determined.',
      status: 400,
    };
  }

  const requested = typeof input.requestedAddress === 'string' ? input.requestedAddress.trim() : '';

  if (requested) {
    // `false` = malformed for this chain → reject. `null` = a chain we have no
    // validator for → trust the caller rather than block a legitimate payout.
    if (isValidPayoutAddress(requested, cryptocurrency) === false) {
      return {
        ok: false,
        code: 'PAYEE_INVALID',
        error: `"${requested}" is not a valid ${cryptocurrency} address.`,
        status: 400,
      };
    }
    return { ok: true, address: requested, source: input.inherited ? 'inherited' : 'manual' };
  }

  const wallet = await getPaymentReceivingWallet(supabase, {
    businessId: input.businessId,
    merchantId: input.merchantId,
    cryptocurrency,
  });

  if (wallet.walletAddress) {
    return { ok: true, address: wallet.walletAddress, source: wallet.source ?? 'business' };
  }

  return {
    ok: false,
    code: 'PAYEE_REQUIRED',
    error: payeeRequiredMessage(cryptocurrency),
    status: 400,
  };
}

/**
 * Assert that a record already carries a usable payee. Used on the paths that
 * move money (sending an invoice, accepting a proposal) so a row that predates
 * this rule — or was written by a path that skipped it — cannot settle to
 * nowhere.
 */
export function assertPayee(
  address: string | null | undefined,
  cryptocurrency: string | null | undefined,
): { ok: true; address: string } | { ok: false; code: PayeeErrorCode; error: string; status: number } {
  const crypto = (cryptocurrency || '').trim().toUpperCase();
  if (!crypto) {
    return {
      ok: false,
      code: 'CRYPTO_REQUIRED',
      error: 'Crypto currency must be set first.',
      status: 400,
    };
  }

  const trimmed = (address || '').trim();
  if (!trimmed) {
    return { ok: false, code: 'PAYEE_REQUIRED', error: payeeRequiredMessage(crypto), status: 400 };
  }

  if (isValidPayoutAddress(trimmed, crypto) === false) {
    return {
      ok: false,
      code: 'PAYEE_INVALID',
      error: `The saved payee address is not a valid ${crypto} address.`,
      status: 400,
    };
  }

  return { ok: true, address: trimmed };
}
