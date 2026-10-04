import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { deleteRule } from '@/lib/finances/books';
import { financeError, financeErrorFromException, financeJson, isUuid } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/** DELETE /api/finances/books/rules/[id] — remove a rule. Rows it already categorised keep their values. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFinanceAccess(req, 'finance.write', { write: true });
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return financeError('not_found', 'Rule not found', 404);
  try {
    const removed = await deleteRule(guard.id, id);
    if (!removed) return financeError('not_found', 'Rule not found', 404);
    return financeJson({ success: true });
  } catch (err) {
    return financeErrorFromException(err, 'Could not delete the rule');
  }
}
