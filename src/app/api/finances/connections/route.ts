import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { listConnections, createConnection } from '@/lib/finances/sync';
import { claimSetupToken, redactAccessUrl } from '@/lib/finances/simplefin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finances/connections — linked SimpleFIN connections and their last
 * sync outcome. Never returns the access URL; there is no route that does.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;

  try {
    return NextResponse.json(
      { connections: await listConnections(guard.id) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[finances/connections] failed', err);
    return NextResponse.json({ error: 'Failed to load connections' }, { status: 500 });
  }
}

/**
 * POST /api/finances/connections — claim a SimpleFIN setup token.
 *
 * Body: `{ setupToken: string, label?: string }`.
 *
 * The claim is single-use and irreversible: the bridge returns the access URL
 * exactly once and answers 403 to every repeat. So the claim and the write are
 * kept adjacent with nothing fallible between them, and if the write somehow
 * fails the response says plainly that the token is spent — the alternative is
 * an operator retrying a token that can never work again.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;

  let body: { setupToken?: unknown; label?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const setupToken = typeof body.setupToken === 'string' ? body.setupToken.trim() : '';
  if (!setupToken) {
    return NextResponse.json({ error: 'A SimpleFIN setup token is required' }, { status: 400 });
  }

  let accessUrl: string;
  try {
    accessUrl = await claimSetupToken(setupToken);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not claim the setup token' },
      { status: 400 },
    );
  }

  try {
    const connection = await createConnection({
      merchantId: guard.id,
      accessUrl,
      label: typeof body.label === 'string' ? body.label : null,
    });
    return NextResponse.json({ connection }, { status: 201 });
  } catch (err) {
    console.error('[finances/connections] claimed but could not store', redactAccessUrl(String(err)));
    return NextResponse.json(
      {
        error:
          'The token was claimed but the credential could not be saved, and a setup token cannot be claimed twice. Generate a new token and try again.',
      },
      { status: 500 },
    );
  }
}
