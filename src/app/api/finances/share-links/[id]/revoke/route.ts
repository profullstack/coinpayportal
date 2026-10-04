import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { revokeShareLink } from '@/lib/finances/share';
import { financeError, financeErrorFromException, financeJson, isUuid } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finances/share-links/[id]/revoke — stop an emailed link from
 * serving its report (admin+). The email itself cannot be unsent.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFinanceAccess(req, 'finance.manage', { write: true });
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return financeError('invalid_request', 'Unknown link', 400);
  try {
    const ok = await revokeShareLink(id, guard.id);
    if (!ok) return financeError('not_found', 'Link not found or already revoked', 404);
    return financeJson({ revoked: true });
  } catch (err) {
    return financeErrorFromException(err, 'Could not revoke the link');
  }
}
