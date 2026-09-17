import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { bankTransfersEnabled } from '@/lib/banking/providers';
import { originateTransfer, publicTransfer } from '@/lib/banking/service';
import { bankingDeps, bankingErrorResponse, resolveBusinessId, NO_STORE } from '@/lib/banking/http';

export const dynamic = 'force-dynamic';

/** GET /api/banking/transfers?businessId=&limit= — newest first. */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;

  const businessId = await resolveBusinessId(guard.id, req.nextUrl.searchParams.get('businessId') ?? undefined);
  if (businessId instanceof NextResponse) return businessId;

  const rawLimit = Number(req.nextUrl.searchParams.get('limit') ?? 50);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;

  try {
    const rows = await bankingDeps().store.listTransfers(guard.id, { businessId, limit });
    return NextResponse.json({ transfers: rows.map(publicTransfer) }, NO_STORE);
  } catch (err) {
    return bankingErrorResponse(err, 'banking/transfers');
  }
}

/**
 * POST /api/banking/transfers — originate a transfer.
 *
 * Body: `{ accountId, direction, amountMinor, currency?, description?, businessId?, idempotencyKey? }`.
 * The idempotency key may come as an `Idempotency-Key` header instead. It is
 * required either way: a retry that invents a new key is the double-debit
 * this rail exists to prevent, so the caller has to own it.
 *
 * Replaying a key returns the original transfer with 200; a new one is 201.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;

  if (!bankTransfersEnabled()) {
    return NextResponse.json({ error: 'Bank transfers are not enabled' }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const idempotencyKey =
    (typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()) ||
    req.headers.get('idempotency-key')?.trim() ||
    '';
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: 'idempotencyKey is required (body field or Idempotency-Key header)' },
      { status: 400 },
    );
  }

  const businessId = await resolveBusinessId(guard.id, body.businessId);
  if (businessId instanceof NextResponse) return businessId;

  const direction = body.direction === 'debit' || body.direction === 'credit' ? body.direction : null;
  if (!direction) {
    return NextResponse.json({ error: 'direction must be debit or credit' }, { status: 400 });
  }
  if (typeof body.accountId !== 'string' || !body.accountId) {
    return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
  }
  if (typeof body.amountMinor !== 'number') {
    return NextResponse.json({ error: 'amountMinor must be an integer number of cents' }, { status: 400 });
  }

  try {
    const deps = bankingDeps();
    const existing = await deps.store.findTransferByIdempotencyKey(idempotencyKey);
    const row = await originateTransfer(
      {
        merchantId: guard.id,
        businessId,
        bankCounterpartyId: body.accountId,
        direction,
        amountMinor: body.amountMinor,
        currency: typeof body.currency === 'string' && body.currency ? body.currency : 'USD',
        idempotencyKey,
        description: typeof body.description === 'string' ? body.description : null,
      },
      deps,
    );
    return NextResponse.json({ transfer: publicTransfer(row) }, { status: existing ? 200 : 201, ...NO_STORE });
  } catch (err) {
    return bankingErrorResponse(err, 'banking/transfers');
  }
}
