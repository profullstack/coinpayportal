/**
 * Global USD accounts: a named US bank account for a user anywhere, paid out
 * to their own wallet as USDC.
 *
 * A node operator in Lagos, a merchant in Nairobi or a freelancer in Manila is
 * paid in dollars by a US client who can only send ACH or a wire. This module
 * gives that user a US routing and account number, held by a licensed partner
 * IN THE USER'S NAME. A deposit to it is converted by the partner to USDC and
 * delivered to a wallet address the user chose (for example their CoinPay
 * payout wallet). From there `src/lib/remittance` can pay it out into a local
 * rail if they want naira, shillings or pesos.
 *
 * ## The non-custodial rule (legal, not stylistic)
 *
 * **CoinPay never holds, pools or moves user funds in this module.**
 *
 * - The partner opens the account in the user's name and runs KYC on its own
 *   hosted pages. We never see documents, ID numbers or dates of birth.
 * - The partner receives the deposit, converts it and delivers it to the
 *   user's wallet. The money never touches a CoinPay account.
 * - CoinPay stores references only: the partner's ids, status words, the
 *   routing number, the last four digits of the account number and the
 *   destination wallet address. The full account number is fetched live from
 *   the partner when the user views it and is never persisted.
 * - Deposits are recorded as the partner REPORTS them by signed webhook. There
 *   is no balance, no ledger, no internal credit, no payout from a platform
 *   account and no "available to withdraw" figure anywhere in this module.
 *
 * Anything that would change one of those lines (a sweep to a CoinPay account,
 * a balance users can spend inside CoinPay, a platform-funded advance) makes
 * CoinPay a money transmitter and is out of scope until counsel says otherwise.
 *
 * ## Shape
 *
 * Same as `src/lib/banking`: our own vocabulary here, provider adapters that
 * translate, a registry that answers null when nothing is configured, a store
 * interface with an in-memory implementation for tests, and money in integer
 * minor units.
 */

/** ISO 3166-1 alpha-2, uppercase. */
export type CountryCode = string;

/**
 * Where the user stands with the partner's KYC.
 *
 * - `pending`      — submitted, partner is reviewing.
 * - `needs_action` — the user has to finish the partner's hosted onboarding.
 * - `verified`     — the partner will open an account for them.
 * - `rejected`     — the partner declined. Terminal for this provider.
 */
export type HolderStatus = 'pending' | 'needs_action' | 'verified' | 'rejected';

/**
 * Lifecycle of the US account itself.
 *
 * - `requested` — we have the user's request (and destination wallet) but the
 *                 partner has not been asked to open it yet, usually because
 *                 KYC is still running.
 * - `pending`   — the partner accepted the open request.
 * - `open`      — routing and account number are live; deposits can arrive.
 * - `closed`    — closed by the partner or the user.
 * - `failed`    — the partner refused to open it.
 */
export type UsdAccountStatus = 'requested' | 'pending' | 'open' | 'closed' | 'failed';

/** US rails a deposit can arrive on. */
export type DepositRail = 'ach' | 'wire' | 'rtp' | 'fednow' | 'book' | 'unknown';

/**
 * A deposit's lifecycle as the partner reports it. Every step happens at the
 * partner; we only record that it was reported.
 *
 * - `received`  — USD arrived in the user's account at the partner.
 * - `converted` — the partner converted it to USDC.
 * - `delivered` — the partner sent the USDC to the user's wallet (tx hash known).
 * - `returned`  — the deposit was sent back to the payer (e.g. an ACH return).
 */
export type DepositStatus = 'received' | 'converted' | 'delivered' | 'returned';

/** Chains a USDC delivery can go to. The partner decides which it supports. */
export type StablecoinChain = 'ethereum' | 'base' | 'polygon' | 'arbitrum' | 'optimism' | 'solana';

export const STABLECOIN_CHAINS: readonly StablecoinChain[] = [
  'ethereum',
  'base',
  'polygon',
  'arbitrum',
  'optimism',
  'solana',
];

/** The user's own wallet, where converted USDC is delivered. */
export interface StablecoinDestination {
  asset: 'USDC';
  chain: StablecoinChain;
  address: string;
}

export interface CreateAccountHolderRequest {
  /** Our reference for the holder; the adapter sends it as the partner's external id/metadata. */
  reference: string;
  email: string;
  country: CountryCode;
  firstName?: string;
  lastName?: string;
  /** Deterministic per (merchant, provider), so a retried request cannot create a second holder. */
  idempotencyKey: string;
}

export interface AccountHolder {
  /** The partner's id for the holder. */
  id: string;
  provider: string;
  status: HolderStatus;
  /** Partner's own status word, verbatim. */
  providerStatus: string;
  /**
   * The partner's hosted KYC/onboarding page, when the user has to go there.
   * Null when the partner did not return one (e.g. already verified).
   */
  onboardingUrl: string | null;
}

export interface OpenAccountRequest {
  /** The partner's holder id. */
  holderId: string;
  destination: StablecoinDestination;
  reference: string;
  idempotencyKey: string;
}

export interface UsdAccount {
  /** The partner's id for the account. */
  id: string;
  provider: string;
  holderId: string | null;
  status: UsdAccountStatus;
  providerStatus: string;
  bankName: string | null;
  routingNumber: string | null;
  /**
   * The full account number, ONLY on a live read for display. Never written to
   * the database: the store has no column for it.
   */
  accountNumber: string | null;
  accountLast4: string | null;
  rails: DepositRail[];
  /**
   * Other partner ids that belong to this account (e.g. a USDC sub-account or
   * the wallet counterparty), so a webhook about any of them finds this row.
   */
  relatedIds: string[];
}

interface EventBase {
  /** The partner's unique id for this event/delivery. The dedupe key. */
  eventId: string;
  /** Partner's own topic/status, verbatim, for support. */
  providerType: string;
  occurredAt: string | null;
  /** The whole parsed payload, recorded for audit. */
  raw: unknown;
}

export interface HolderEvent extends EventBase {
  type: 'holder.verified' | 'holder.rejected';
  holderId: string;
  reason: string | null;
}

export interface AccountEvent extends EventBase {
  type: 'account.opened' | 'account.closed';
  accountId: string;
  holderId: string | null;
}

export interface DepositEvent extends EventBase {
  type: 'deposit.received' | 'deposit.converted' | 'deposit.delivered' | 'deposit.returned';
  accountId: string;
  /** The partner's id for the deposit; groups the events of one deposit. */
  depositId: string;
  /** USD cents. Integer. */
  amountMinor: number;
  currency: string;
  rail: DepositRail;
  /** USDC delivered, in the asset's smallest unit (USDC has 6 decimals). Null until converted. */
  deliveredAmountAtomic: string | null;
  deliveredAsset: string | null;
  deliveredChain: string | null;
  txHash: string | null;
  returnCode: string | null;
}

export type UsdAccountEvent = HolderEvent | AccountEvent | DepositEvent;

export const DEPOSIT_EVENT_TYPES = [
  'deposit.received',
  'deposit.converted',
  'deposit.delivered',
  'deposit.returned',
] as const;

/**
 * Result of verifying and parsing one webhook delivery.
 *
 * `ok: false` means the signature did not verify (or the body was not ours to
 * read) and NOTHING in it may be acted on. `events` may be empty for a topic
 * this module does not care about; that is a verified no-op, not an error.
 */
export type WebhookParseResult =
  | { ok: true; events: UsdAccountEvent[] }
  | { ok: false; reason: string };

/**
 * What a partner has to be able to do. Small on purpose: every decision that
 * can be made from the normalised shapes above lives in ./service.ts so no
 * adapter can apply a different policy.
 */
export interface UsdAccountProvider {
  readonly id: string;
  readonly label: string;
  /** Countries whose residents the partner will onboard. */
  readonly supportedCountries: readonly CountryCode[];
  /** Chains the partner will deliver USDC to. */
  readonly supportedChains: readonly StablecoinChain[];
  isConfigured(): boolean;
  createAccountHolder(request: CreateAccountHolderRequest, signal?: AbortSignal): Promise<AccountHolder>;
  getAccountHolder(id: string, signal?: AbortSignal): Promise<AccountHolder | null>;
  openAccount(request: OpenAccountRequest, signal?: AbortSignal): Promise<UsdAccount>;
  /** Live read, including the full account number for display. */
  getAccount(id: string, signal?: AbortSignal): Promise<UsdAccount | null>;
  /**
   * Verify the delivery's signature over the RAW body, then translate it.
   * Headers are passed lower-cased.
   */
  verifyAndParseWebhook(rawBody: string, headers: Record<string, string>): WebhookParseResult;
}

/** The master switch. Keys alone never turn this feature on. */
export function usdAccountsFlagOn(): boolean {
  return process.env.USD_ACCOUNTS_ENABLED === '1';
}

export function normalizeCountry(raw: unknown): CountryCode | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Reject a destination before it reaches a partner. A typo here sends real
 * money to an address nobody controls, and the partner cannot claw it back.
 */
export function validateDestination(destination: Partial<StablecoinDestination> | null | undefined): string | null {
  if (!destination) return 'destination is required';
  if (destination.asset !== 'USDC') return 'destination.asset must be USDC';
  if (!destination.chain || !STABLECOIN_CHAINS.includes(destination.chain)) {
    return `destination.chain must be one of ${STABLECOIN_CHAINS.join(', ')}`;
  }
  const address = (destination.address ?? '').trim();
  if (destination.chain === 'solana') {
    if (!SOLANA_ADDRESS.test(address)) return 'destination.address is not a Solana address';
  } else if (!EVM_ADDRESS.test(address)) {
    return 'destination.address is not an EVM address';
  }
  return null;
}

export function last4(accountNumber: string | null | undefined): string | null {
  if (!accountNumber) return null;
  const digits = accountNumber.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}
