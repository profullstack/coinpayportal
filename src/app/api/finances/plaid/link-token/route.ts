import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { createLinkToken } from '@/lib/finances/plaid';
import { isPlaidEnabled } from '@/lib/finances/provider';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finances/plaid/link-token — mint a token for Plaid Link.
 *
 * The token is short-lived and scoped to this merchant. It is safe to hand to
 * the browser: it opens the connect UI and nothing else. The durable credential
 * only exists after the exchange, and never reaches the client.
 *
 * 404 when Plaid is not enabled here, so a deployment that has not opted into
 * the per-account billing does not advertise a button that cannot work.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;

  if (!isPlaidEnabled()) {
    return NextResponse.json({ error: 'Plaid connections are not enabled' }, { status: 404 });
  }

  try {
    const session = await createLinkToken({
      clientUserId: guard.id,
      webhookUrl: process.env.FINANCES_PLAID_WEBHOOK_URL,
    });

    return NextResponse.json(
      { linkToken: session.linkToken, expiresAt: session.expiresAt },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[finances/plaid/link-token] failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not start a Plaid link' },
      { status: 502 },
    );
  }
}
