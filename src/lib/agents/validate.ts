/**
 * Validating what an operator sends when creating or changing an agent.
 *
 * Pure, so the rules are testable without a request. Every limit is optional
 * and every one of them is a number of dollars, so the interesting cases are
 * all about telling "absent" apart from "explicitly no limit", which are the
 * same value on the way in and very different in meaning.
 */

import type { AgentStatus } from './limits';

/** A limit as it arrives: a number, null for "no limit", or absent. */
export type LimitInput = number | null | undefined;

export interface AgentInput {
  name: string;
  address: string;
  perPaymentLimitUsd: number | null;
  dailyLimitUsd: number | null;
  totalLimitUsd: number | null;
  status: AgentStatus;
}

export interface ValidationResult<T> {
  ok: boolean;
  value: T | null;
  error: string | null;
}

const fail = <T>(error: string): ValidationResult<T> => ({ ok: false, value: null, error });
const pass = <T>(value: T): ValidationResult<T> => ({ ok: true, value, error: null });

/** The statuses an operator may set. `revoked` is deliberately included: it is final, and that is the point. */
export const AGENT_STATUSES: AgentStatus[] = ['active', 'paused', 'revoked'];

/** 0x plus 40 hex characters. Case is not checked because it is folded away. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * A dollar limit.
 *
 * Null means "no limit of this kind" and is a legitimate value. A limit of zero
 * is refused rather than treated as null: an agent that may spend exactly
 * nothing is what `paused` is for, and reading a 0 as "unlimited" is the kind
 * of quiet mistake that only shows up on the bill.
 */
export function validateLimit(value: LimitInput, field: string): ValidationResult<number | null> {
  if (value === undefined || value === null) return pass(null);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(`${field} must be a number of US dollars, or null for no limit.`);
  }
  if (value <= 0) {
    return fail(`${field} must be greater than zero. To stop an agent spending, pause it instead.`);
  }
  // numeric(12,2): twelve digits with two after the point.
  if (value > 9_999_999_999.99) return fail(`${field} is too large.`);
  if (Math.round(value * 100) !== value * 100) {
    return fail(`${field} cannot be finer than a cent.`);
  }
  return pass(value);
}

/**
 * Everything needed to create an agent.
 *
 * Limits are checked in the order they are reported, so an operator fixing one
 * complaint at a time gets them in a stable order rather than whichever the
 * object happened to enumerate first.
 */
export function validateAgentInput(body: unknown): ValidationResult<AgentInput> {
  if (!body || typeof body !== 'object') return fail('Expected a JSON object.');
  const input = body as Record<string, unknown>;

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return fail('name is required.');
  if (name.length > 120) return fail('name must be 120 characters or fewer.');

  const address = typeof input.address === 'string' ? input.address.trim() : '';
  if (!address) return fail('address is required.');
  if (!EVM_ADDRESS.test(address)) {
    return fail('address must be an EVM address: 0x followed by 40 hex characters.');
  }

  const perPayment = validateLimit(input.perPaymentLimitUsd as LimitInput, 'perPaymentLimitUsd');
  if (!perPayment.ok) return fail(perPayment.error!);
  const daily = validateLimit(input.dailyLimitUsd as LimitInput, 'dailyLimitUsd');
  if (!daily.ok) return fail(daily.error!);
  const total = validateLimit(input.totalLimitUsd as LimitInput, 'totalLimitUsd');
  if (!total.ok) return fail(total.error!);

  const status = (input.status as AgentStatus | undefined) ?? 'active';
  if (!AGENT_STATUSES.includes(status)) {
    return fail(`status must be one of: ${AGENT_STATUSES.join(', ')}.`);
  }

  // A per-payment ceiling above the daily one can never bind, and a daily one
  // above the lifetime cap is the same mistake a day later. Neither is unsafe,
  // but both mean the operator wrote a limit that does nothing, and silently
  // accepting that is how someone ends up believing they are protected.
  if (perPayment.value !== null && daily.value !== null && perPayment.value > daily.value) {
    return fail('perPaymentLimitUsd cannot be above dailyLimitUsd; it could never apply.');
  }
  if (daily.value !== null && total.value !== null && daily.value > total.value) {
    return fail('dailyLimitUsd cannot be above totalLimitUsd; it could never apply.');
  }

  return pass({
    name,
    address: address.toLowerCase(),
    perPaymentLimitUsd: perPayment.value,
    dailyLimitUsd: daily.value,
    totalLimitUsd: total.value,
    status,
  });
}

/** The fields a PATCH may carry, all optional. Absent means "leave alone". */
export interface AgentPatch {
  name?: string;
  status?: AgentStatus;
  perPaymentLimitUsd?: number | null;
  dailyLimitUsd?: number | null;
  totalLimitUsd?: number | null;
}

/**
 * A partial update.
 *
 * The distinction that matters here is between a key that is absent and a key
 * whose value is null. Absent leaves the limit as it was; null clears it. A
 * PATCH body cannot express "leave alone" any other way, so the check is on
 * key presence rather than on the value.
 */
export function validateAgentPatch(body: unknown): ValidationResult<AgentPatch> {
  if (!body || typeof body !== 'object') return fail('Expected a JSON object.');
  const input = body as Record<string, unknown>;
  const patch: AgentPatch = {};

  if ('name' in input) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) return fail('name cannot be empty.');
    if (name.length > 120) return fail('name must be 120 characters or fewer.');
    patch.name = name;
  }

  if ('status' in input) {
    const status = input.status as AgentStatus;
    if (!AGENT_STATUSES.includes(status)) {
      return fail(`status must be one of: ${AGENT_STATUSES.join(', ')}.`);
    }
    patch.status = status;
  }

  for (const field of ['perPaymentLimitUsd', 'dailyLimitUsd', 'totalLimitUsd'] as const) {
    if (!(field in input)) continue;
    const result = validateLimit(input[field] as LimitInput, field);
    if (!result.ok) return fail(result.error!);
    patch[field] = result.value;
  }

  if (Object.keys(patch).length === 0) {
    return fail('Nothing to update. Send at least one of: name, status, or a limit.');
  }

  return pass(patch);
}

/** The database column for each input field, so a patch maps in one place. */
export const COLUMN_FOR: Record<keyof AgentPatch, string> = {
  name: 'name',
  status: 'status',
  perPaymentLimitUsd: 'per_payment_limit_usd',
  dailyLimitUsd: 'daily_limit_usd',
  totalLimitUsd: 'total_limit_usd',
};

/** Turn a validated patch into the row update it describes. */
export function patchToRow(patch: AgentPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    row[COLUMN_FOR[key as keyof AgentPatch]] = value;
  }
  row.updated_at = new Date().toISOString();
  return row;
}
