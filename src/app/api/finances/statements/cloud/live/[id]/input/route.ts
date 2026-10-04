import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { parseLiveInput, sendLiveInput } from '@/lib/finances/cloud-browser';
import { cloudError } from '@/lib/finances/cloud-api';
import { financeError, financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finances/statements/cloud/live/:id/input — one click, scroll, key
 * or piece of text for the cloud browser, in page coordinates (1280x860).
 * Typed text is replayed and never stored or logged.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFinanceAccess(req, 'finance.write', { write: true });
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return financeError('invalid_request', 'Expected a JSON body', 400);
  }
  try {
    await sendLiveInput(id, guard.id, parseLiveInput(body));
    return financeJson({ ok: true });
  } catch (err) {
    return cloudError(err, 'Could not send that to the browser');
  }
}
