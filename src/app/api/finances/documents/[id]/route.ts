import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { deleteDocument } from '@/lib/finances/documents';
import { financeError, financeErrorFromException, financeJson, isUuid } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/** DELETE /api/finances/documents/[id] — remove an uploaded document (admin+). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFinanceAccess(req, 'finance.manage', { write: true });
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return financeError('invalid_request', 'Unknown document', 400);
  try {
    const ok = await deleteDocument(id, guard.id, guard.actorId);
    if (!ok) return financeError('not_found', 'Document not found', 404);
    return financeJson({ deleted: true });
  } catch (err) {
    return financeErrorFromException(err, 'Could not delete the document');
  }
}
