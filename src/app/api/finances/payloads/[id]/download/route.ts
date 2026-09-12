import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { getPayload, readPayloadBytes } from '@/lib/finances/payloads';
import { financeError, financeErrorFromException, isUuid } from '@/lib/finances/api';
import { audit } from '@/lib/finances/audit';

export const dynamic = 'force-dynamic';

/** GET /api/finances/payloads/[id]/download — the provider response exactly as received, as an attachment. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return financeError('not_found', 'Payload not found', 404);
  try {
    const payload = await getPayload(id, guard.id);
    if (!payload) return financeError('not_found', 'Payload not found', 404);
    const bytes = await readPayloadBytes(payload);
    await audit(guard.id, 'payload.download', 'payload', payload.id, { bytes: bytes.length });
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(bytes.length),
        'Content-Disposition': `attachment; filename="coinpay-${payload.provider}-payload-${payload.fetched_at.slice(0, 19).replace(/[:T]/g, '-')}.json"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Content-SHA256': payload.content_hash,
      },
    });
  } catch (err) {
    return financeErrorFromException(err, 'Could not download the payload');
  }
}
