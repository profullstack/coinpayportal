/**
 * Column — the ACH originator, implemented against a live sandbox.
 *
 * Everything here is verified by real API responses rather than read off a
 * documentation page. That distinction earned its keep: two of the shapes the
 * docs implied turned out to be wrong, and both would have failed only once a
 * real credential was in place.
 *
 * ## What probing the sandbox corrected
 *
 * **The two enums use opposite casing in the same API.** A counterparty's
 * `account_type` must be lowercase (`checking`), and an ACH transfer's `type`
 * must be uppercase (`CREDIT`). Sending `CHECKING` returns
 * `{"invalid_enum":"CHECKING"}`; sending `credit` returns "invalid ACH transfer
 * type". Assuming either convention applies to both breaks half the calls.
 *
 * **NACHA field lengths are enforced per Standard Entry Class code.** On `WEB`,
 * `receiver_name` is capped at 22 characters and `receiver_id` at 15. A payee
 * whose name is merely normal-length is rejected outright, so both are
 * truncated here rather than passed through to fail at the network.
 */

import { createHash } from 'node:crypto';

import {
  BankTransfer,
  BankTransferProvider,
  BankTransferRequest,
  TransferDirection,
  validateTransferRequest,
} from './types';
import { normalizeColumnStatus, toColumnType, fromColumnType } from './column';

const COLUMN_API_URL = 'https://api.column.com';

/**
 * NACHA limits on the `WEB` Standard Entry Class code, confirmed by the API
 * rejecting anything longer.
 *
 * These are not advisory. Column returns `invalid_field_value` with
 * `{"maximum_length": "22 characters"}` and the transfer never reaches the
 * network.
 */
export const WEB_RECEIVER_NAME_MAX = 22;
export const WEB_RECEIVER_ID_MAX = 15;

/**
 * Truncate to a NACHA field limit.
 *
 * Silently shortening a payee name is unpleasant, and it is still better than
 * the alternative: Column rejects the whole transfer, so the choice is a
 * slightly clipped name on a bank statement or no payment at all.
 */
export function fitNachaField(value: string, max: number): string {
  return value.trim().slice(0, max);
}

/**
 * A stable `receiver_id` derived from the counterparty.
 *
 * The field is capped at 15 characters, which most real identifiers exceed, so
 * a hash prefix is used rather than a truncated id — truncating two different
 * counterparty ids to 15 characters can collide, and a collision here means one
 * payee's identifier appearing on another's ACH entry.
 */
export function receiverIdFor(counterpartyId: string): string {
  return createHash('sha256').update(counterpartyId).digest('hex').slice(0, WEB_RECEIVER_ID_MAX);
}

interface ColumnTransferResponse {
  id?: string;
  status?: string;
  type?: string;
  is_incoming?: boolean;
  amount?: number;
  currency_code?: string;
  settled_at?: string | null;
  created_at?: string;
  returned_at?: string | null;
  return_details?: { return_code?: string } | null;
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

/** Column's error envelope, which names the offending field. */
function describeError(body: ColumnTransferResponse, status: number): string {
  if (!body?.code) return `Column API error ${status}`;

  const detail = body.details ? ` ${JSON.stringify(body.details)}` : '';
  return `Column ${body.code}: ${body.message ?? ''}${detail}`.trim();
}

function toBankTransfer(body: ColumnTransferResponse, fallback: TransferDirection): BankTransfer {
  return {
    id: body.id ?? '',
    provider: 'column',
    // Read from `type` together with `is_incoming`: a DEBIT we originate pulls
    // money in, while a DEBIT originated against us pushes it out, and the two
    // are opposite events for our balance.
    direction:
      body.type !== undefined
        ? fromColumnType(body.type, body.is_incoming === true)
        : fallback,
    amountMinor: typeof body.amount === 'number' ? body.amount : 0,
    currency: (body.currency_code ?? 'USD').toUpperCase(),
    status: normalizeColumnStatus(body.status),
    providerStatus: body.status ?? '',
    returnCode: body.return_details?.return_code ?? null,
    createdAt: body.created_at ?? new Date().toISOString(),
    settledAt: body.settled_at ?? null,
  };
}

export class ColumnProvider implements BankTransferProvider {
  readonly id = 'column';
  readonly label = 'Column';
  readonly currencies = ['USD'] as const;

  private get apiKey(): string {
    return process.env.COLUMN_API_KEY || '';
  }

  /** The account transfers originate from. */
  private get bankAccountId(): string {
    return process.env.COLUMN_BANK_ACCOUNT_ID || '';
  }

  /**
   * Both are required.
   *
   * A key without an originating account authenticates happily and then fails
   * every transfer with `Either bank_account_id or account_number_id must be
   * provided`, which reads as our bug rather than as missing configuration.
   */
  isConfigured(): boolean {
    return this.apiKey.length > 0 && this.bankAccountId.length > 0;
  }

  /**
   * HTTP Basic with an EMPTY username and the key as the password.
   *
   * Not a bearer token, and not the key as the username. `curl -u ":$KEY"`.
   */
  private authHeader(): string {
    return `Basic ${Buffer.from(`:${this.apiKey}`).toString('base64')}`;
  }

  async createTransfer(request: BankTransferRequest, signal?: AbortSignal): Promise<BankTransfer> {
    const invalid = validateTransferRequest(request);
    if (invalid) throw new Error(`Invalid transfer request: ${invalid}`);

    const body = {
      currency_code: request.currency,
      amount: request.amountMinor,
      type: toColumnType(request.direction),
      // WEB is the code for a debit authorised by a consumer over the
      // internet, which is what every user-initiated transfer here is.
      entry_class_code: 'WEB',
      counterparty_id: request.counterpartyId,
      bank_account_id: this.bankAccountId,
      receiver_name: fitNachaField(request.description ?? 'CoinPay payout', WEB_RECEIVER_NAME_MAX),
      receiver_id: receiverIdFor(request.counterpartyId),
    };

    const response = await fetch(`${COLUMN_API_URL}/transfers/ach`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json',
        // Column echoes this back on the transfer, so a retried create returns
        // the original rather than originating a second debit.
        'Idempotency-Key': request.idempotencyKey,
      },
      body: JSON.stringify(body),
      signal,
    });

    const parsed = (await response.json().catch(() => ({}))) as ColumnTransferResponse;
    if (!response.ok) throw new Error(describeError(parsed, response.status));

    return toBankTransfer(parsed, request.direction);
  }

  async getTransfer(id: string, signal?: AbortSignal): Promise<BankTransfer | null> {
    const response = await fetch(`${COLUMN_API_URL}/transfers/ach/${id}`, {
      headers: { Authorization: this.authHeader() },
      signal,
    });

    if (response.status === 404) return null;

    const parsed = (await response.json().catch(() => ({}))) as ColumnTransferResponse;
    if (!response.ok) throw new Error(describeError(parsed, response.status));

    return toBankTransfer(parsed, 'credit');
  }
}
