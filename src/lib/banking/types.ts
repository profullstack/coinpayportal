/**
 * Bank transfers — money in and out of a user's own bank account.
 *
 * This is the leg CoinPay was missing. The cross-border legs already exist:
 * stablecoin carries value across the border and `src/lib/remittance` pays it
 * into a local rail at the far end. What had no implementation was moving money
 * between a user and us over their domestic banking rail.
 *
 * ## ACH does not cross borders
 *
 * Worth stating once, because the shape of this module depends on it. NACHA ACH
 * is a US-domestic network. There is no ACH transfer from a US bank to a
 * Nigerian or Indian one, and no configuration makes there be. A cross-border
 * transfer is therefore always three legs — a domestic debit here, stablecoin
 * across, a domestic credit there — and this module is only ever one end of
 * that. The provider interface is deliberately named for *bank transfers*
 * rather than for ACH so that a non-US rail can implement it later.
 *
 * ## Why a provider interface rather than one integration
 *
 * The card rail taught this the expensive way: it was written directly against
 * one processor, and losing access to that processor left no path to money at
 * all. Everything below is expressed in our own vocabulary, and a provider
 * translates. Swapping originators is then an adapter, not a migration.
 */

/**
 * Which way the money moves, always from CoinPay's point of view.
 *
 * This is the single most dangerous ambiguity in the domain — "debit" means
 * opposite things to a bank and to its customer — so it is fixed here and the
 * provider adapters translate into their own vocabulary rather than passing the
 * word through.
 *
 * - `debit`  — we pull FROM the user's bank INTO CoinPay. Funding.
 * - `credit` — we push FROM CoinPay OUT to the user's bank. Payout.
 */
export type TransferDirection = 'debit' | 'credit';

/**
 * Our normalised lifecycle.
 *
 * Providers each have their own, longer, list. These are the distinctions that
 * change what we do:
 *
 * - `initiated` — accepted by the provider, not yet in the network.
 * - `pending`   — in the network, money not yet moved.
 * - `settled`   — money has moved, but is still returnable.
 * - `completed` — settled and past the point we are prepared to treat it as
 *                 final. This is our judgement, not the network's.
 * - `returned`  — the bank sent it back. Reachable from `settled` AND from
 *                 `completed`, which is what makes this domain hard.
 * - `failed`    — never made it into the network.
 * - `canceled`  — withdrawn before submission.
 */
export type TransferStatus =
  | 'initiated'
  | 'pending'
  | 'settled'
  | 'completed'
  | 'returned'
  | 'failed'
  | 'canceled';

/** Statuses from which no further movement is expected. */
export const TERMINAL_STATUSES: readonly TransferStatus[] = [
  'completed',
  'returned',
  'failed',
  'canceled',
];

/**
 * True when a status can still turn into `returned`.
 *
 * `completed` is included on purpose. An ACH debit can be returned for up to
 * sixty days on an administrative code, long after any sane hold has expired,
 * so "completed" is a decision to stop waiting rather than a guarantee. Code
 * that assumes completion is final will eventually be wrong about real money.
 */
export function canStillBeReturned(status: TransferStatus): boolean {
  return status === 'settled' || status === 'completed';
}

/** A request to move money between CoinPay and a user's bank. */
export interface BankTransferRequest {
  direction: TransferDirection;
  /**
   * Minor units — cents for USD. Integer only.
   *
   * Money never travels through a float in this codebase. A rounding error in a
   * quote is a wrong number on a page; here it is a wrong amount debited from
   * somebody's bank account.
   */
  amountMinor: number;
  /** ISO 4217, uppercase. */
  currency: string;
  /** The provider's identifier for the user's bank account. */
  counterpartyId: string;
  /**
   * Caller-supplied idempotency key, required rather than optional.
   *
   * A retried create that originates a second debit is the worst failure this
   * module can have, and network timeouts guarantee retries happen. Making the
   * key mandatory means a caller cannot omit it by accident.
   */
  idempotencyKey: string;
  /** Free-form reference shown on the bank statement, where the rail supports it. */
  description?: string;
}

/** A transfer as this codebase understands it, whoever originated it. */
export interface BankTransfer {
  /** The provider's id for this transfer. */
  id: string;
  provider: string;
  direction: TransferDirection;
  amountMinor: number;
  currency: string;
  status: TransferStatus;
  /** Provider's own status string, kept verbatim for support and debugging. */
  providerStatus: string;
  /** Populated once the bank has returned it; the raw return code, e.g. `R01`. */
  returnCode: string | null;
  createdAt: string;
  settledAt: string | null;
}

/**
 * What an originator has to be able to do.
 *
 * Deliberately small. Anything that can be decided from a normalised
 * {@link BankTransfer} — hold windows, whether to notify, what to show a user —
 * belongs in this codebase, not in an adapter, so no provider can quietly apply
 * a different policy from the others.
 */
export interface BankTransferProvider {
  readonly id: string;
  readonly label: string;
  /** Currencies and rails this originator can actually move. */
  readonly currencies: readonly string[];
  isConfigured(): boolean;
  createTransfer(request: BankTransferRequest, signal?: AbortSignal): Promise<BankTransfer>;
  getTransfer(id: string, signal?: AbortSignal): Promise<BankTransfer | null>;
}

/**
 * Reject a request before it reaches an originator.
 *
 * Returns a reason, or null when the request is fit to send. Validation lives
 * here rather than in each adapter so that a provider cannot be more permissive
 * than the others — a negative or fractional amount must fail identically
 * whoever is configured.
 */
export function validateTransferRequest(request: BankTransferRequest): string | null {
  if (!Number.isInteger(request.amountMinor)) {
    return 'amountMinor must be an integer number of minor units';
  }
  if (request.amountMinor <= 0) {
    return 'amountMinor must be greater than zero';
  }
  if (!/^[A-Z]{3}$/.test(request.currency)) {
    return 'currency must be a three-letter ISO 4217 code';
  }
  if (!request.counterpartyId) {
    return 'counterpartyId is required';
  }
  if (!request.idempotencyKey) {
    // Never defaulted. A generated key would be different on the retry, which
    // is precisely the case it exists to protect against.
    return 'idempotencyKey is required';
  }
  return null;
}
