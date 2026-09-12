import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant, requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { listConnections, createConnection } from '@/lib/finances/sync';
import { claimSetupToken, redactAccessUrl, ClaimError, decodeSetupToken, assertAllowedProviderUrl } from '@/lib/finances/simplefin';
import { isPlaidEnabled } from '@/lib/finances/provider';
import { requireEncryptionKey } from '@/lib/crypto/require-key';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { audit, findReceipt } from '@/lib/finances/audit';
import { idempotencyKeyFrom } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finances/connections — linked connections and their last sync
 * outcome. Never returns the access URL; there is no route that does.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;

  try {
    return NextResponse.json(
      {
        connections: await listConnections(guard.id),
        // Whether to offer the Plaid button at all. Sent with the connections
        // rather than from its own endpoint so the page cannot render a link
        // option in the moment before a second request answers.
        plaidEnabled: isPlaidEnabled(),
      },
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
 * Body: `{ setupToken: string, label?: string, protocolVersion?: 1 | 2 }`.
 *
 * The claim is single-use and irreversible: the bridge returns the access URL
 * exactly once and answers 403 to every repeat. So everything that can fail
 * for a local reason — authentication, the encryption key, the database, the
 * destination host, a repeated Idempotency-Key — is checked BEFORE the claim,
 * and the claim and the write are kept adjacent with nothing fallible
 * between them. When the outcome is genuinely unknown (a timeout mid-claim),
 * the response says so and tells the operator to disable the token at the
 * bridge rather than retry it.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;

  let body: { setupToken?: unknown; label?: unknown; protocolVersion?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const setupToken = typeof body.setupToken === 'string' ? body.setupToken.trim() : '';
  if (!setupToken) {
    return NextResponse.json({ error: 'A SimpleFIN setup token is required' }, { status: 400 });
  }
  const protocolVersion = body.protocolVersion === 2 ? 2 : body.protocolVersion === 1 || body.protocolVersion === undefined ? undefined : null;
  if (protocolVersion === null) {
    return NextResponse.json({ error: 'protocolVersion must be 1 or 2' }, { status: 400 });
  }
  const label = typeof body.label === 'string' ? body.label : null;

  // --- preflight: nothing here has spent the token ---------------------------
  try {
    requireEncryptionKey('finance connection storage');
  } catch {
    return NextResponse.json(
      { error: 'Encrypted storage is not configured; the token was not used', code: 'storage_error' },
      { status: 503 },
    );
  }
  try {
    assertAllowedProviderUrl(decodeSetupToken(setupToken), { purpose: 'claim' });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid setup token', code: 'claim_rejected' },
      { status: 400 },
    );
  }
  const supabase = getSupabaseAdmin();
  const { error: dbError } = await supabase.from('finance_connections').select('id', { head: true, count: 'exact' }).eq('merchant_id', guard.id);
  if (dbError) {
    return NextResponse.json({ error: 'Storage is unavailable; the token was not used', code: 'storage_error' }, { status: 503 });
  }
  const idempotencyKey = idempotencyKeyFrom(req);
  if (idempotencyKey) {
    const receipt = await findReceipt(guard.id, 'connection.claim', idempotencyKey);
    if (receipt?.object_id) {
      const existing = (await listConnections(guard.id)).find((c) => c.id === receipt.object_id);
      if (existing) return NextResponse.json({ connection: existing, replayed: true }, { status: 200 });
    }
  }

  // --- claim ----------------------------------------------------------------
  let accessUrl: string;
  try {
    accessUrl = await claimSetupToken(setupToken);
  } catch (err) {
    if (err instanceof ClaimError) {
      return NextResponse.json(
        {
          error: err.message,
          code: err.outcome === 'unknown' ? 'claim_outcome_unknown' : 'claim_rejected',
          tokenState: err.outcome,
        },
        { status: err.outcome === 'unknown' ? 502 : 400 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not claim the setup token', code: 'claim_rejected' },
      { status: 400 },
    );
  }

  try {
    const connection = await createConnection({
      merchantId: guard.id,
      accessUrl,
      label,
      protocolVersion,
    });
    await audit(guard.id, 'connection.claim', 'connection', connection.id, {
      provider: 'simplefin',
      protocolVersion: protocolVersion ?? 1,
      idempotencyKey: idempotencyKey ?? null,
    });
    return NextResponse.json({ connection }, { status: 201 });
  } catch (err) {
    console.error('[finances/connections] claimed but could not store', redactAccessUrl(String(err)));
    return NextResponse.json(
      {
        error:
          'The token was claimed but the credential could not be saved, and a setup token cannot be claimed twice. Disable this token at the bridge, generate a new one and try again.',
        code: 'claim_outcome_unknown',
        tokenState: 'claimed_not_stored',
      },
      { status: 500 },
    );
  }
}
