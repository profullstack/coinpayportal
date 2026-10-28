import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';
import { legacyKeyMigrationEnabled } from '@/lib/crypto/legacy-migration';
import { recordAuditEvent } from '@/lib/audit/log';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/**
 * POST /api/reputation/did/key-export  { did }
 *
 * One-shot hand-back of a legacy auto-generated DID private key.
 *
 * Before 2026-10-28 `did/claim` generated an ed25519 key pair and stored the
 * private key in `merchant_dids.private_key_encrypted` in PLAINTEXT, and never
 * gave it to the merchant. CoinPay never uses it. Under unlock-on-use no server
 * may hold a user key, so this route returns it to its owner once and NULLs the
 * column in the same request. A second call finds nothing.
 *
 * Session auth only (not API keys). Closed when LEGACY_KEY_MIGRATION=off.
 */
export async function POST(request: NextRequest) {
  try {
    if (!legacyKeyMigrationEnabled()) {
      return NextResponse.json({ error: 'Legacy key export is closed' }, { status: 410 });
    }
    const supabase = getSupabase();
    const auth = await authenticateRequest(supabase, request.headers.get('authorization'));
    if (!auth.success || !auth.context) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isMerchantAuth(auth.context)) {
      return NextResponse.json(
        { error: 'This endpoint requires account (session) authentication, not an API key' },
        { status: 403 }
      );
    }
    const merchantId = auth.context.merchantId;

    let did: unknown;
    try {
      did = (await request.json())?.did;
    } catch {
      did = undefined;
    }
    if (typeof did !== 'string' || !did.startsWith('did:')) {
      return NextResponse.json({ error: 'did is required' }, { status: 400 });
    }

    const { data: row } = await supabase
      .from('merchant_dids')
      .select('id, private_key_encrypted')
      .eq('merchant_id', merchantId)
      .eq('did', did)
      .maybeSingle();

    const stored = (row as { id: string; private_key_encrypted: string | null } | null)?.private_key_encrypted ?? null;
    if (!row || !stored) {
      return NextResponse.json({ error: 'No stored private key for this DID' }, { status: 404 });
    }

    // Conditional on the value we read, so two concurrent calls cannot both
    // release it; the loser updates zero rows.
    const { data: cleared, error: clearError } = await supabase
      .from('merchant_dids')
      .update({ private_key_encrypted: null })
      .eq('id', (row as { id: string }).id)
      .eq('private_key_encrypted', stored)
      .select('id');
    if (clearError || !cleared || cleared.length !== 1) {
      return NextResponse.json({ error: 'Could not release the key; try again' }, { status: 409 });
    }

    await recordAuditEvent(supabase, {
      action: 'key.released',
      actorType: 'merchant',
      actorId: merchantId,
      subjectType: 'did',
      subjectId: did,
      detail: { reason: 'legacy-did-key-export' },
    });

    return NextResponse.json(
      {
        did,
        private_key: stored,
        private_key_notice:
          'Save this private key now. CoinPay has deleted its copy and cannot show it again.',
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('DID key export error:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
