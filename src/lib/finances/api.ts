import { NextRequest, NextResponse } from 'next/server';
import { PeriodError } from './periods';
import { BudgetExhaustedError } from './budget';
import { JobConflictError } from './jobs';

/**
 * The error shape every new finance operation answers with:
 *
 *   { "error": { "code": "...", "message": "...", "retryable": false, "jobId"?: "..." } }
 *
 * Existing routes keep their flat `{ error: string }`; new ones use this so a
 * CLI can branch on `code` without parsing prose. Provider messages are
 * already credential-redacted before they reach here.
 */

export type FinanceErrorCode =
  | 'invalid_request'
  | 'invalid_period'
  | 'invalid_timezone'
  | 'timezone_required'
  | 'not_found'
  | 'identity_review_required'
  | 'claim_outcome_unknown'
  | 'claim_rejected'
  | 'provider_reconnect_required'
  | 'provider_payment_required'
  | 'provider_rate_limited'
  | 'provider_error'
  | 'local_budget_exhausted'
  | 'provider_coverage_partial'
  | 'provider_coverage_unknown'
  | 'export_count_mismatch'
  | 'export_incomplete'
  | 'document_quarantined'
  | 'document_rejected'
  | 'idempotency_conflict'
  | 'report_not_ready'
  | 'feature_disabled'
  | 'storage_error'
  | 'cross_site_request'
  | 'internal_error';

export interface FinanceErrorBody {
  error: {
    code: FinanceErrorCode;
    message: string;
    retryable: boolean;
    jobId?: string;
    reportId?: string;
    retryAfter?: string | null;
  };
}

const NO_STORE = { 'Cache-Control': 'no-store' };

export function financeError(
  code: FinanceErrorCode,
  message: string,
  status: number,
  extra: { retryable?: boolean; jobId?: string; reportId?: string; retryAfter?: string | null } = {},
): NextResponse<FinanceErrorBody> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        retryable: extra.retryable ?? false,
        ...(extra.jobId ? { jobId: extra.jobId } : {}),
        ...(extra.reportId ? { reportId: extra.reportId } : {}),
        ...(extra.retryAfter !== undefined ? { retryAfter: extra.retryAfter } : {}),
      },
    },
    { status, headers: NO_STORE },
  );
}

export function financeJson<T>(body: T, status = 200): NextResponse<T> {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Map a thrown error from the finance services to a response. */
export function financeErrorFromException(err: unknown, fallback = 'Request failed'): NextResponse<FinanceErrorBody> {
  if (err instanceof PeriodError) return financeError('invalid_period', err.message, 400);
  if (err instanceof BudgetExhaustedError) {
    return financeError('local_budget_exhausted', err.message, 429, { retryable: true, retryAfter: err.nextAvailableAt });
  }
  if (err instanceof JobConflictError) return financeError('idempotency_conflict', err.message, 409);
  const code = (err as { code?: string } | null)?.code;
  const message = err instanceof Error ? err.message : fallback;
  if (code === 'provider_reconnect_required') return financeError(code, message, 409);
  if (code === 'provider_payment_required') return financeError(code, message, 402);
  if (code === 'provider_rate_limited') return financeError(code, message, 429, { retryable: true });
  if (code === 'provider_error') return financeError(code, message, 502, { retryable: true });
  if (/not found/i.test(message)) return financeError('not_found', message, 404);
  if (/timezone/i.test(message)) return financeError('invalid_timezone', message, 400);
  console.error('[finances] unhandled', message);
  return financeError('internal_error', fallback, 500);
}

export async function readJsonBody<T extends Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    const body = await req.json();
    return (body && typeof body === 'object' ? body : {}) as T;
  } catch {
    return {} as T;
  }
}

export function idempotencyKeyFrom(req: NextRequest): string | null {
  const key = req.headers.get('idempotency-key');
  if (!key) return null;
  const trimmed = key.trim();
  return trimmed && trimmed.length <= 200 ? trimmed : null;
}

export function isFeatureEnabled(flag: 'FINANCES_REPORTS_ENABLED' | 'FINANCES_STATEMENT_IMPORTS_ENABLED'): boolean {
  // Default on: the flags exist to switch the surfaces OFF in an emergency
  // without a deploy, not to gate them on.
  return process.env[flag] !== 'false';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
