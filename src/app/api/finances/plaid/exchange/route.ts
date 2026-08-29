import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { exchangePublicToken } from '@/lib/finances/plaid';
import { isPlaidEnabled } from '@/lib/finances/provider';
import { createPlaidConnection } from '@/lib/finances/sync';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finances/plaid/exchange — finish a Plaid link.
 *
 * Body: `{ publicToken: string, label?: string }`.
 *
 * Mirrors the SimpleFIN claim in `../../connections`: the exchange is one-way,
 * so it is kept adjacent to the write with nothing fallible in between. The
 * response carries the stored connection and never the access token — there is
 * no route that returns it.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;

  if (!isPlaidEnabled()) {
    return NextResponse.json({ error: 'Plaid connections are not enabled' }, { status: 404 });
  }

  let body: { publicToken?: unknown; label?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const publicToken = typeof body.publicToken === 'string' ? body.publicToken.trim() : '';
  if (!publicToken) {
    return NextResponse.json({ error: 'publicToken is required' }, { status: 400 });
  }

  try {
    const exchange = await exchangePublicToken(publicToken);
    const label =
      (typeof body.label === 'string' && body.label.trim()) || exchange.institutionName || null;

    const connection = await createPlaidConnection({
      merchantId: guard.id,
      accessToken: exchange.accessToken,
      label,
    });

    return NextResponse.json({ connection }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[finances/plaid/exchange] failed', err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Could not complete the Plaid link. The link may need to be started again.',
      },
      { status: 502 },
    );
  }
}
