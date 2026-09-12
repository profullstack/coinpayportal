import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { listPayloads, toPublicPayload } from '@/lib/finances/payloads';
import { financeErrorFromException, financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/** GET /api/finances/payloads?connection=&limit=&offset= — the raw provider response archive, newest first. */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const q = req.nextUrl.searchParams;
  try {
    const { payloads, total } = await listPayloads(guard.id, {
      connectionId: q.get('connection'),
      limit: Number.parseInt(q.get('limit') ?? '50', 10) || 50,
      offset: Number.parseInt(q.get('offset') ?? '0', 10) || 0,
    });
    return financeJson({ payloads: payloads.map(toPublicPayload), total });
  } catch (err) {
    return financeErrorFromException(err, 'Could not list payloads');
  }
}
