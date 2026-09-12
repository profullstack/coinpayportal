import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant, requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { getStatement, deleteStatement, toPublicStatement } from '@/lib/finances/statements';
import { listReconciliations, toPublicReconciliation } from '@/lib/finances/reconciliation';
import { financeError, financeErrorFromException, financeJson, isUuid } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/** GET /api/finances/statements/[id] — metadata, inspection and reconciliation state. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return financeError('not_found', 'Statement not found', 404);
  try {
    const statement = await getStatement(id, guard.id);
    if (!statement) return financeError('not_found', 'Statement not found', 404);
    const reconciliations = await listReconciliations(statement.id, guard.id);
    const active = reconciliations.find((r) => r.state !== 'invalidated') ?? null;
    return financeJson({
      statement: toPublicStatement(statement, active ? toPublicReconciliation(active) : null),
      reconciliations: reconciliations.map(toPublicReconciliation),
    });
  } catch (err) {
    return financeErrorFromException(err, 'Could not read the statement');
  }
}

/**
 * DELETE /api/finances/statements/[id] — remove the stored bytes and retire
 * the record. Reconciliation evidence built on it becomes unavailable;
 * synced transactions are not touched.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return financeError('not_found', 'Statement not found', 404);
  try {
    const removed = await deleteStatement(id, guard.id);
    if (!removed) return financeError('not_found', 'Statement not found', 404);
    return financeJson({ success: true, note: 'The document was deleted. Bank activity was not.' });
  } catch (err) {
    return financeErrorFromException(err, 'Could not delete the statement');
  }
}
