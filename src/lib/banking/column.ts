/**
 * Column — the intended ACH originator.
 *
 * Column is a nationally chartered bank that exposes ACH primitives directly,
 * which is why it was chosen over a processor sitting on top of a sponsor bank:
 * there is no intermediary whose risk appetite can withdraw the rail
 * underneath us. That is not a theoretical concern here — this module exists
 * because exactly that happened on the card rail.
 *
 * ## What is verified, and what is not
 *
 * VERIFIED from Column's published ACH transfer object: the field names, the
 * `CREDIT`/`DEBIT` type, `amount` in cents, `currency_code`, `effective_on`,
 * `entry_class_code` (PPD, CCD, WEB), the `counterparty_id` /
 * `bank_account_id` references, and the status lifecycle mapped below.
 *
 * NOW VERIFIED against a live sandbox (2026-09-07): authentication is HTTP
 * Basic with an EMPTY username and the key as password; the base URL is
 * https://api.column.com for both environments; and the request shapes are
 * implemented in ./column-provider.ts. Two things the documentation implied
 * were wrong — `account_type` is lowercase while transfer `type` is uppercase,
 * and NACHA caps receiver_name/receiver_id at 22/15 characters on WEB. Three adapters in this codebase
 * were written blind against documentation and two had real defects — Yellow
 * Card could never have authenticated at all. Repeating that on a rail that
 * moves money out of customers' bank accounts, rather than one that returns a
 * price, is not a trade worth making. It goes in when there is a sandbox key
 * to check it against.
 *
 * What is here is the part that can be known now and is worth not losing: the
 * status mapping, which is where the money-safety judgement actually lives.
 */

import { TransferStatus } from './types';

/**
 * Column's ACH statuses, mapped onto ours.
 *
 * Two mappings carry the weight:
 *
 * `SETTLED` becomes `settled` and not `completed`. Column means the funds have
 * moved; it does not mean they cannot come back. Treating settlement as final
 * is the mistake that pays out against a debit which later returns.
 *
 * `MANUAL_REVIEW` becomes `pending`. It is not a failure — the transfer may yet
 * go through — and calling it one would tell a user their transfer had died
 * while Column was still deciding.
 */
const STATUS_MAP: Record<string, TransferStatus> = {
  INITIATED: 'initiated',
  SCHEDULED: 'initiated',
  PENDING_SUBMISSION: 'pending',
  SUBMITTED: 'pending',
  MANUAL_REVIEW: 'pending',
  // Column's own risk hold, before submission. Distinct from our post-
  // settlement hold, and mapping it to `pending` keeps that distinction.
  HOLD: 'pending',
  SETTLED: 'settled',
  COMPLETED: 'completed',
  RETURNED: 'returned',
  CANCELED: 'canceled',
};

/**
 * Normalise a Column status.
 *
 * An unrecognised status maps to `pending`, never to a terminal state. Column
 * can add statuses without asking us, and the safe reading of a status we do
 * not know is "still moving" — guessing `completed` would release funds on a
 * transfer whose real state we cannot read, and guessing `failed` would tell a
 * user their money had bounced when it had not.
 */
export function normalizeColumnStatus(status: string | null | undefined): TransferStatus {
  if (!status) return 'pending';
  return STATUS_MAP[status.toUpperCase()] ?? 'pending';
}

/** Our direction, in Column's vocabulary. */
export function toColumnType(direction: 'debit' | 'credit'): 'DEBIT' | 'CREDIT' {
  return direction === 'debit' ? 'DEBIT' : 'CREDIT';
}

/**
 * Column's direction, in ours.
 *
 * Read from `type` together with `is_incoming` rather than from `type` alone.
 * A `DEBIT` we originate pulls money in, but a `DEBIT` originated against us
 * pushes money out, and the two are opposite events for our balance. Column
 * distinguishes them with `is_incoming`; dropping it would book incoming
 * returns and reversals with the wrong sign.
 */
export function fromColumnType(type: string, isIncoming: boolean): 'debit' | 'credit' {
  const originatedDebit = type.toUpperCase() === 'DEBIT';
  return originatedDebit === !isIncoming ? 'debit' : 'credit';
}

/**
 * The Standard Entry Class code for a transfer.
 *
 * `WEB` is required for a debit authorised by a consumer over the internet,
 * which is what every user-initiated funding transfer here is. `CCD` covers
 * business-to-business. Sending the wrong code is a NACHA rules violation, not
 * a preference, so this is derived rather than left to the caller.
 */
export function entryClassCode(counterpartyIsBusiness: boolean): 'CCD' | 'WEB' {
  return counterpartyIsBusiness ? 'CCD' : 'WEB';
}
