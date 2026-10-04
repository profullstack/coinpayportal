import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { finishLiveSession, liveStatus } from '@/lib/finances/cloud-browser';
import { cloudError } from '@/lib/finances/cloud-api';
import { financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/** GET /api/finances/statements/cloud/live/:id — the sign-in session's status (the CLI polls this). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFinanceAccess(req, 'finance.read');
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  try {
    return financeJson({ live: liveStatus(id, guard.id) });
  } catch (err) {
    return cloudError(err, 'Could not read the sign-in session');
  }
}

/** DELETE /api/finances/statements/cloud/live/:id — close the cloud browser without saving. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFinanceAccess(req, 'finance.write', { write: true });
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  try {
    return financeJson(await finishLiveSession(id, guard, false));
  } catch (err) {
    return cloudError(err, 'Could not close the sign-in session');
  }
}
