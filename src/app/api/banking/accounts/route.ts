import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { bankTransfersEnabled } from '@/lib/banking/providers';
import { linkBankAccount, publicCounterparty } from '@/lib/banking/service';
import { bankingDeps, bankingErrorResponse, resolveBusinessId, NO_STORE } from '@/lib/banking/http';

export const dynamic = 'force-dynamic';

/** GET /api/banking/accounts?businessId= — the merchant's linked bank accounts. */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;

  const businessId = await resolveBusinessId(guard.id, req.nextUrl.searchParams.get('businessId') ?? undefined);
  if (businessId instanceof NextResponse) return businessId;

  try {
    const rows = await bankingDeps().store.listCounterparties(guard.id, businessId);
    return NextResponse.json({ accounts: rows.map(publicCounterparty) }, NO_STORE);
  } catch (err) {
    return bankingErrorResponse(err, 'banking/accounts');
  }
}

/**
 * POST /api/banking/accounts — link a US bank account.
 *
 * Body: `{ holderName, routingNumber, accountNumber, accountType, businessId? }`.
 * The account number is forwarded to the originator and not stored; the
 * response carries the last four digits and nothing that could be debited.
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

  const businessId = await resolveBusinessId(guard.id, body.businessId);
  if (businessId instanceof NextResponse) return businessId;

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const accountType = str(body.accountType) || 'checking';
  if (accountType !== 'checking' && accountType !== 'savings') {
    return NextResponse.json({ error: 'accountType must be checking or savings' }, { status: 400 });
  }

  try {
    const row = await linkBankAccount(
      {
        merchantId: guard.id,
        businessId,
        holderName: str(body.holderName),
        routingNumber: str(body.routingNumber),
        accountNumber: str(body.accountNumber),
        accountType,
      },
      bankingDeps(),
    );
    return NextResponse.json({ account: publicCounterparty(row) }, { status: 201, ...NO_STORE });
  } catch (err) {
    return bankingErrorResponse(err, 'banking/accounts');
  }
}
