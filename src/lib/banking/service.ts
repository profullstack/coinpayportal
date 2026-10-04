/**
 * Bank transfers: the caller the adapters were waiting for.
 *
 * Three operations, and one ordering rule that carries the money safety.
 *
 * **The row is written before the originator is called.** A transfer is
 * inserted as `initiated` with its idempotency key, and only then sent to the
 * provider. The unique index on that key therefore blocks a second origination
 * of the same request even when two requests race, which an application-level
 * check cannot promise. If the provider call fails the row is marked `failed`
 * with the reason; if the process dies between insert and provider call the
 * row is left with no provider id, and the sweep re-submits it under the SAME
 * key, which every originator here honours by returning the original transfer
 * rather than creating a second one.
 *
 * **`settled` is not `completed`.** The sweep marks a transfer settled when the
 * provider says the funds moved, starts a hold, and marks it completed when the
 * hold expires. Completed transfers are still re-checked daily for sixty days,
 * because an administrative return can land that late, and a return after
 * completion is recorded as exactly that.
 */

import { getBankProviders, getActiveBankProvider } from './providers';
import type { BankStore, BankCounterpartyRow, BankTransferRow, TransferKind, TransferPatch } from './store';
import { DuplicateIdempotencyKeyError } from './store';
import {
  BankAccountType,
  BankTransfer,
  BankTransferProvider,
  TransferDirection,
  validateCounterpartyRequest,
  validateTransferRequest,
} from './types';

/** Days after settlement before a transfer is treated as complete. */
export const DEFAULT_HOLD_DAYS = 5;
/** How long after settlement an ACH return can still arrive. */
export const RETURN_WINDOW_DAYS = 60;
/** A row with no provider id older than this is treated as an interrupted origination. */
export const ORPHAN_AFTER_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Configured hold, defaulting to five days: R01 and R02 typically land within
 * two to five business days. A bad value falls back to the default rather
 * than to no hold at all.
 */
export function holdDays(): number {
  const raw = process.env.BANK_TRANSFER_HOLD_DAYS;
  if (raw === undefined || raw === '') return DEFAULT_HOLD_DAYS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_HOLD_DAYS;
}

export class BankTransferError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BankTransferError';
  }
}

export interface BankingDeps {
  store: BankStore;
  /** Defaults to the active originator. Tests inject the stub. */
  provider?: BankTransferProvider | null;
  now?: () => Date;
}

function resolveProvider(deps: BankingDeps): BankTransferProvider {
  const provider = deps.provider === undefined ? getActiveBankProvider() : deps.provider;
  if (!provider) throw new BankTransferError('Bank transfers are not enabled', 404);
  return provider;
}

/** The originator a stored row went out on, configured or not. */
function providerFor(row: BankTransferRow, deps: BankingDeps): BankTransferProvider | null {
  if (deps.provider && deps.provider.id === row.provider) return deps.provider;
  return getBankProviders().find((p) => p.id === row.provider && p.isConfigured()) ?? null;
}

export interface LinkBankAccountInput {
  merchantId: string;
  businessId?: string | null;
  holderName: string;
  routingNumber: string;
  accountNumber: string;
  accountType: BankAccountType;
}

/** Register a bank account with the originator and keep only what is safe to keep. */
export async function linkBankAccount(
  input: LinkBankAccountInput,
  deps: BankingDeps,
): Promise<BankCounterpartyRow> {
  const provider = resolveProvider(deps);
  const request = {
    holderName: input.holderName,
    routingNumber: input.routingNumber.replace(/\s+/g, ''),
    accountNumber: input.accountNumber.replace(/\s+/g, ''),
    accountType: input.accountType,
  };
  const invalid = validateCounterpartyRequest(request);
  if (invalid) throw new BankTransferError(invalid, 400);

  const counterparty = await provider.createCounterparty(request);

  return deps.store.insertCounterparty({
    merchant_id: input.merchantId,
    business_id: input.businessId ?? null,
    provider: provider.id,
    provider_counterparty_id: counterparty.id,
    holder_name: counterparty.holderName,
    account_type: counterparty.accountType,
    routing_number: counterparty.routingNumber,
    account_last4: counterparty.accountLast4,
    role: 'merchant',
    payer_email: null,
  });
}

/**
 * What a merchant may pay out right now, in minor units.
 *
 * Payins and funding count once they have completed (settled and past the
 * hold), payouts count from the moment they are originated so two payouts
 * cannot both spend the same dollar, and a payin that was returned after it
 * completed counts against the balance because that money already went out.
 */
export function balanceFromLedger(rows: readonly BankTransferRow[]): number {
  let balance = 0;
  for (const row of rows) {
    if (row.kind === 'payout') {
      if (row.status !== 'failed' && row.status !== 'canceled') balance -= row.amount_minor;
      continue;
    }
    // payin or funding
    if (row.status === 'completed') balance += row.net_minor;
    if (row.status === 'returned' && row.completed_at) balance -= row.net_minor;
  }
  return balance;
}

export async function availableBalanceMinor(merchantId: string, store: BankStore): Promise<number> {
  return balanceFromLedger(await store.listLedger(merchantId));
}

export interface OriginateTransferInput {
  merchantId: string;
  businessId?: string | null;
  /** The bank_counterparties row, not the provider's id. */
  bankCounterpartyId: string;
  direction: TransferDirection;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  description?: string | null;
}

/**
 * Originate a transfer.
 *
 * Returns the existing row on a replayed idempotency key, which is what a
 * client retrying a timed-out request must see. A key reused by a different
 * merchant is refused rather than answered, since answering would disclose
 * another merchant's transfer.
 */
export async function originateTransfer(
  input: OriginateTransferInput,
  deps: BankingDeps,
): Promise<BankTransferRow> {
  const provider = resolveProvider(deps);
  const key = input.idempotencyKey.trim();
  if (!key) throw new BankTransferError('idempotencyKey is required', 400);
  if (key.length > 200) throw new BankTransferError('idempotencyKey is too long', 400);

  const replay = await deps.store.findTransferByIdempotencyKey(key);
  if (replay) {
    if (replay.merchant_id !== input.merchantId) {
      throw new BankTransferError('idempotencyKey is already in use', 409);
    }
    return replay;
  }

  const counterparty = await deps.store.getCounterparty(input.bankCounterpartyId, input.merchantId);
  if (!counterparty || counterparty.status !== 'active') {
    throw new BankTransferError('Unknown bank account', 404);
  }
  if (counterparty.provider !== provider.id) {
    throw new BankTransferError(
      `This bank account was linked through ${counterparty.provider}, which is no longer the active originator. Link it again.`,
      409,
    );
  }
  if (input.businessId && counterparty.business_id && counterparty.business_id !== input.businessId) {
    throw new BankTransferError('Bank account belongs to a different business', 403);
  }

  if (counterparty.role !== 'merchant') {
    // A payer's account is used once, to pay. It is never a payout destination.
    throw new BankTransferError('Unknown bank account', 404);
  }

  const currency = input.currency.toUpperCase();
  const request = {
    direction: input.direction,
    amountMinor: input.amountMinor,
    currency,
    counterpartyId: counterparty.provider_counterparty_id,
    idempotencyKey: key,
    description: input.description?.trim() || undefined,
  };
  const invalid = validateTransferRequest(request);
  if (invalid) throw new BankTransferError(invalid, 400);
  if (!provider.currencies.includes(currency)) {
    throw new BankTransferError(`${provider.label} cannot move ${currency}`, 400);
  }

  const kind: TransferKind = input.direction === 'credit' ? 'payout' : 'funding';
  if (kind === 'payout') {
    // A payout leaves the originating account, which holds every merchant's
    // money. Without this check a merchant could pay out what another merchant
    // was owed. Two concurrent payouts can still both pass it; the ledger then
    // goes negative and the next one is refused, which is the accepted bound
    // until a reservation exists.
    const available = await availableBalanceMinor(input.merchantId, deps.store);
    if (input.amountMinor > available) {
      throw new BankTransferError(
        `Insufficient balance: ${(available / 100).toFixed(2)} ${currency} available`,
        409,
      );
    }
  }

  let row: BankTransferRow;
  try {
    row = await deps.store.insertTransfer({
      merchant_id: input.merchantId,
      business_id: input.businessId ?? counterparty.business_id ?? null,
      provider: provider.id,
      direction: input.direction,
      kind,
      payment_id: null,
      invoice_id: null,
      payer_email: null,
      amount_minor: input.amountMinor,
      fee_minor: 0,
      net_minor: input.amountMinor,
      currency,
      counterparty_id: counterparty.provider_counterparty_id,
      bank_counterparty_id: counterparty.id,
      description: request.description ?? null,
      idempotency_key: key,
    });
  } catch (err) {
    if (err instanceof DuplicateIdempotencyKeyError) {
      // Lost the race to a concurrent request with the same key. That request
      // owns the origination; hand back whatever it recorded.
      const winner = await deps.store.findTransferByIdempotencyKey(key);
      if (winner && winner.merchant_id === input.merchantId) return winner;
      throw new BankTransferError('idempotencyKey is already in use', 409);
    }
    throw err;
  }

  return submitToProvider(row, provider, request, deps);
}

export interface OriginatePayinInput {
  /** Exactly one of paymentId or invoiceId. */
  paymentId?: string | null;
  invoiceId?: string | null;
  merchantId: string;
  businessId: string;
  amountMinor: number;
  currency: string;
  /** Platform fee in minor units, already computed at the merchant's tier. */
  feeMinor: number;
  description?: string | null;
  payer: {
    holderName: string;
    routingNumber: string;
    accountNumber: string;
    accountType: BankAccountType;
    email?: string | null;
  };
}

/**
 * A buyer pays a payment or an invoice from their bank account.
 *
 * The payer's account becomes a counterparty with role 'payer': never listed
 * on the merchant's page and never a payout destination. The debit is a
 * transfer of kind 'payin' tied to the payment or invoice. One attempt may be
 * in flight per payment; a failed attempt may be followed by another, which
 * is what the attempt number in the idempotency key allows.
 *
 * Nothing here touches the payment or invoice row. That happens in ./payin.ts
 * when the sweep reports the transfer complete, because a submitted ACH debit
 * is not a paid invoice.
 */
export async function originatePayin(input: OriginatePayinInput, deps: BankingDeps): Promise<BankTransferRow> {
  const provider = resolveProvider(deps);
  const ref = input.paymentId ? { paymentId: input.paymentId } : { invoiceId: input.invoiceId };
  if (!ref.paymentId && !ref.invoiceId) throw new BankTransferError('paymentId or invoiceId is required', 400);

  const previous = await deps.store.listPayinsFor(ref);
  const live = previous.find((row) => row.status !== 'failed' && row.status !== 'canceled');
  if (live) return live; // already paying by bank; the page polls this row

  const currency = input.currency.toUpperCase();
  if (!provider.currencies.includes(currency)) {
    throw new BankTransferError(`${provider.label} cannot move ${currency}`, 400);
  }
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new BankTransferError('amountMinor must be a positive integer', 400);
  }
  if (!Number.isInteger(input.feeMinor) || input.feeMinor < 0 || input.feeMinor >= input.amountMinor) {
    throw new BankTransferError('feeMinor is out of range', 400);
  }

  const payerRequest = {
    holderName: input.payer.holderName,
    routingNumber: input.payer.routingNumber.replace(/\s+/g, ''),
    accountNumber: input.payer.accountNumber.replace(/\s+/g, ''),
    accountType: input.payer.accountType,
  };
  const invalid = validateCounterpartyRequest(payerRequest);
  if (invalid) throw new BankTransferError(invalid, 400);

  const counterparty = await provider.createCounterparty(payerRequest);
  const stored = await deps.store.insertCounterparty({
    merchant_id: input.merchantId,
    business_id: input.businessId,
    provider: provider.id,
    provider_counterparty_id: counterparty.id,
    holder_name: counterparty.holderName,
    account_type: counterparty.accountType,
    routing_number: counterparty.routingNumber,
    account_last4: counterparty.accountLast4,
    role: 'payer',
    payer_email: input.payer.email?.trim() || null,
  });

  const attempt = previous.length + 1;
  const key = `payin:${ref.paymentId ? 'payment' : 'invoice'}:${ref.paymentId ?? ref.invoiceId}:${attempt}`;
  const request = {
    direction: 'debit' as const,
    amountMinor: input.amountMinor,
    currency,
    counterpartyId: counterparty.id,
    idempotencyKey: key,
    description: input.description?.trim() || undefined,
  };

  let row: BankTransferRow;
  try {
    row = await deps.store.insertTransfer({
      merchant_id: input.merchantId,
      business_id: input.businessId,
      provider: provider.id,
      direction: 'debit',
      kind: 'payin',
      payment_id: ref.paymentId ?? null,
      invoice_id: ref.invoiceId ?? null,
      payer_email: input.payer.email?.trim() || null,
      amount_minor: input.amountMinor,
      fee_minor: input.feeMinor,
      net_minor: input.amountMinor - input.feeMinor,
      currency,
      counterparty_id: counterparty.id,
      bank_counterparty_id: stored.id,
      description: request.description ?? null,
      idempotency_key: key,
    });
  } catch (err) {
    if (err instanceof DuplicateIdempotencyKeyError) {
      // Two submissions of the same form raced. The first owns the debit.
      const winner = await deps.store.findTransferByIdempotencyKey(key);
      if (winner) return winner;
    }
    throw err;
  }

  return submitToProvider(row, provider, request, deps);
}

async function submitToProvider(
  row: BankTransferRow,
  provider: BankTransferProvider,
  request: Parameters<BankTransferProvider['createTransfer']>[0],
  deps: BankingDeps,
): Promise<BankTransferRow> {
  let remote: BankTransfer;
  try {
    remote = await provider.createTransfer(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[banking] origination failed', { transferId: row.id, provider: provider.id, message });
    return deps.store.updateTransfer(row.id, {
      status: 'failed',
      provider_status: null,
      last_error: message.slice(0, 500),
    });
  }

  const now = (deps.now ?? (() => new Date()))();
  return deps.store.updateTransfer(row.id, {
    provider_transfer_id: remote.id,
    last_polled_at: now.toISOString(),
    last_error: null,
    ...transitionFor(row, remote, now),
  });
}

/**
 * What a provider's view of a transfer means for our row. Pure, so the hold
 * arithmetic is tested without a store or a provider.
 */
export function transitionFor(row: BankTransferRow, remote: BankTransfer, now: Date): TransferPatch {
  const patch: TransferPatch = { provider_status: remote.providerStatus };
  const nowIso = now.toISOString();

  switch (remote.status) {
    case 'returned':
      // Reachable from anywhere, including from completed. The return code is
      // the only thing the bank tells us about why.
      patch.status = 'returned';
      patch.return_code = remote.returnCode ?? row.return_code ?? null;
      patch.returned_at = row.returned_at ?? nowIso;
      return patch;

    case 'failed':
    case 'canceled':
      if (row.status === 'settled' || row.status === 'completed') {
        // Money that has moved does not un-move on a status word. Leave our
        // state alone and keep the provider's word for support to read.
        return patch;
      }
      patch.status = remote.status;
      return patch;

    case 'settled':
    case 'completed': {
      // The provider's "completed" is the network's opinion; ours waits for
      // the hold. Both mean the funds have moved.
      if (row.status === 'returned') return patch;
      const settledAt = row.settled_at ?? remote.settledAt ?? nowIso;
      const holdUntil = row.hold_until ?? new Date(new Date(settledAt).getTime() + holdDays() * DAY_MS).toISOString();
      patch.settled_at = settledAt;
      patch.hold_until = holdUntil;
      if (row.status === 'completed') return patch;
      if (holdUntil <= nowIso) {
        patch.status = 'completed';
        patch.completed_at = row.completed_at ?? nowIso;
      } else {
        patch.status = 'settled';
      }
      return patch;
    }

    case 'initiated':
    case 'pending':
      if (row.status === 'initiated' || row.status === 'pending') patch.status = remote.status;
      return patch;
  }
  return patch;
}

export interface SweepStats {
  checked: number;
  resubmitted: number;
  settled: number;
  completed: number;
  returned: number;
  failed: number;
  errors: number;
}

export interface SweepOptions {
  limit?: number;
  /** Called after any status change, for notification. */
  onTransition?: (before: BankTransferRow, after: BankTransferRow) => Promise<void> | void;
}

/**
 * Advance every in-flight transfer, and re-check recently completed ones.
 *
 * Runs from the payments cron. Each row is handled independently: one
 * provider outage or one bad row is counted, logged, and does not stop the
 * rest of the sweep.
 */
export async function sweepBankTransfers(
  deps: BankingDeps,
  now: Date = new Date(),
  options: SweepOptions = {},
): Promise<SweepStats> {
  const stats: SweepStats = { checked: 0, resubmitted: 0, settled: 0, completed: 0, returned: 0, failed: 0, errors: 0 };
  const limit = options.limit ?? 200;
  const nowIso = now.toISOString();

  const inFlight = await deps.store.listInFlight(limit);
  const returnable = await deps.store.listReturnable(
    new Date(now.getTime() - RETURN_WINDOW_DAYS * DAY_MS).toISOString(),
    new Date(now.getTime() - DAY_MS).toISOString(),
    limit,
  );

  for (const row of [...inFlight, ...returnable]) {
    stats.checked += 1;
    try {
      const provider = providerFor(row, deps);
      if (!provider) {
        throw new Error(`originator ${row.provider} is not configured`);
      }

      let after: BankTransferRow;
      if (!row.provider_transfer_id) {
        // Interrupted between insert and origination. Young rows are still
        // being originated by their request; older ones are ours to finish,
        // under the same key so a provider that did receive it returns the
        // original rather than a second debit.
        if (now.getTime() - new Date(row.created_at).getTime() < ORPHAN_AFTER_MS) continue;
        if (!row.counterparty_id) throw new Error('orphan row has no counterparty');
        after = await submitToProvider(
          row,
          provider,
          {
            direction: row.direction,
            amountMinor: row.amount_minor,
            currency: row.currency,
            counterpartyId: row.counterparty_id,
            idempotencyKey: row.idempotency_key,
            description: row.description ?? undefined,
          },
          { ...deps, now: () => now },
        );
        stats.resubmitted += 1;
      } else {
        const remote = await provider.getTransfer(row.provider_transfer_id);
        if (!remote) throw new Error(`provider has no transfer ${row.provider_transfer_id}`);
        after = await deps.store.updateTransfer(row.id, {
          ...transitionFor(row, remote, now),
          last_polled_at: nowIso,
          last_error: null,
        });
      }

      if (after.status !== row.status) {
        if (after.status === 'settled') stats.settled += 1;
        if (after.status === 'completed') stats.completed += 1;
        if (after.status === 'returned') stats.returned += 1;
        if (after.status === 'failed') stats.failed += 1;
        if (options.onTransition) await options.onTransition(row, after);
      }
    } catch (err) {
      stats.errors += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error('[banking] sweep failed for transfer', { transferId: row.id, message });
      try {
        await deps.store.updateTransfer(row.id, { last_polled_at: nowIso, last_error: message.slice(0, 500) });
      } catch {
        // Already counted; nothing more to do for this row.
      }
    }
  }

  return stats;
}

/** What a merchant may see of a counterparty. Nothing here can be debited. */
export function publicCounterparty(row: BankCounterpartyRow) {
  return {
    id: row.id,
    businessId: row.business_id,
    provider: row.provider,
    holderName: row.holder_name,
    accountType: row.account_type,
    routingNumber: row.routing_number,
    accountLast4: row.account_last4,
    createdAt: row.created_at,
  };
}

/** What a merchant may see of a transfer. Provider ids stay internal. */
export function publicTransfer(row: BankTransferRow) {
  return {
    id: row.id,
    businessId: row.business_id,
    bankCounterpartyId: row.bank_counterparty_id,
    provider: row.provider,
    direction: row.direction,
    kind: row.kind,
    paymentId: row.payment_id,
    invoiceId: row.invoice_id,
    amountMinor: row.amount_minor,
    feeMinor: row.fee_minor,
    netMinor: row.net_minor,
    currency: row.currency,
    status: row.status,
    providerStatus: row.provider_status,
    returnCode: row.return_code,
    description: row.description,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    settledAt: row.settled_at,
    holdUntil: row.hold_until,
    completedAt: row.completed_at,
    returnedAt: row.returned_at,
    error: row.status === 'failed' ? row.last_error : null,
  };
}

/** What a buyer may see of their own pay-in: status and timing, nothing of anyone else's. */
export function payerTransferView(row: BankTransferRow) {
  return {
    id: row.id,
    status: row.status,
    amountMinor: row.amount_minor,
    currency: row.currency,
    createdAt: row.created_at,
    settledAt: row.settled_at,
    holdUntil: row.hold_until,
    completedAt: row.completed_at,
    returnedAt: row.returned_at,
    returnCode: row.return_code,
    error: row.status === 'failed' ? row.last_error : null,
  };
}
