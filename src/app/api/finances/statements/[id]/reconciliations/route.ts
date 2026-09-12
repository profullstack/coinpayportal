import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant, requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { reconcileStatement, listReconciliations, toPublicReconciliation } from '@/lib/finances/reconciliation';
import { ReportError } from '@/lib/finances/reports';
import { financeError, financeErrorFromException, financeJson, isUuid, readJsonBody } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finances/statements/[id]/reconciliations — enter the statement's
 * balances and check them against one immutable report revision.
 *
 * Body: `{ reportId, opening, closing, credits?, debits?, currency,
 * signConvention?: "as_stated"|"liability_positive", acknowledge?: boolean }`.
 * The result is `matched`, `mismatch`, or — with `acknowledge` on a match —
 * `user_reconciled`. Never `bank_verified`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return financeError('not_found', 'Statement not found', 404);

  const body = await readJsonBody<{
    reportId?: unknown; opening?: unknown; closing?: unknown; credits?: unknown; debits?: unknown;
    currency?: unknown; signConvention?: unknown; acknowledge?: unknown;
  }>(req);
  if (!isUuid(body.reportId)) return financeError('invalid_request', 'reportId must be the uuid of a ready report', 400);
  if (body.signConvention !== undefined && body.signConvention !== 'as_stated' && body.signConvention !== 'liability_positive') {
    return financeError('invalid_request', 'signConvention must be as_stated or liability_positive', 400);
  }

  try {
    const row = await reconcileStatement({
      merchantId: guard.id,
      statementId: id,
      reportId: body.reportId,
      opening: body.opening,
      closing: body.closing,
      credits: body.credits,
      debits: body.debits,
      currency: body.currency,
      signConvention: body.signConvention as 'as_stated' | 'liability_positive' | undefined,
      acknowledge: body.acknowledge === true,
    });
    return financeJson({ reconciliation: toPublicReconciliation(row) }, 201);
  } catch (err) {
    if (err instanceof ReportError) return financeError(err.code as never, err.message, err.status);
    return financeErrorFromException(err, 'Could not reconcile the statement');
  }
}

/** GET — every reconciliation attempt for this statement, newest first. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return financeError('not_found', 'Statement not found', 404);
  try {
    const rows = await listReconciliations(id, guard.id);
    return financeJson({ reconciliations: rows.map(toPublicReconciliation) });
  } catch (err) {
    return financeErrorFromException(err, 'Could not list reconciliations');
  }
}
