/**
 * POST /api/reputation/did/override
 *
 * Network apps (d0rz, c0mpute, etc.) are the source of truth for their
 * users' DIDs. When a user connects their CoinPay account from an app, the
 * app calls this endpoint to declare "the user identified by `merchant_id`
 * now uses `did`." CoinPay upserts merchant_dids so its own userinfo + any
 * other OIDC client reading from us converges on the same DID. This is the
 * keystone of the cross-app portable-reputation story.
 *
 * Auth: Bearer token matching a registered reputation_issuers API key.
 * Body: { merchant_id, did, public_key? }
 *
 * Upsert semantics: if a human DID row already exists for the merchant, its
 * `did` and `public_key` are replaced. Otherwise a new row is inserted.
 *
 * NOTE: this is intentionally a write-by-platform-trust endpoint — the
 * platform's OAuth handshake with the user already proves user consent to
 * link, and the platform's issuer key proves it's the platform we expect.
 */

import { NextRequest, NextResponse } from 'next/server';
import { platformMayManageMerchant } from '@/lib/p2p/platform-ownership';
import { recordAuditEvent } from '@/lib/audit/log';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

const overrideSchema = z.object({
  merchant_id: z.string().uuid('merchant_id must be a UUID'),
  did: z.string().startsWith('did:', 'Must be a valid DID'),
  public_key: z.string().optional(),
});

async function authenticatePlatform(
  supabase: ReturnType<typeof getSupabase>,
  request: NextRequest,
): Promise<{ did: string; name: string } | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const apiKey = authHeader.slice(7);

  const { data } = await supabase
    .from('reputation_issuers')
    .select('did, name')
    .eq('api_key', apiKey)
    .eq('active', true)
    .single();

  return data;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const platform = await authenticatePlatform(supabase, request);
    if (!platform) {
      return NextResponse.json(
        { error: 'Invalid or missing API key' },
        { status: 401 },
      );
    }

    const body = await request.json();
    const parsed = overrideSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(', ') },
        { status: 400 },
      );
    }

    const { merchant_id, did, public_key } = parsed.data;

    // A platform may only override the DID of an account it provisioned. This
    // took any `merchant_id` and rebound that merchant's human DID, marked
    // `verified: true`, on nothing but a valid issuer key — and a DID is the
    // identity the reputation graph and delegated-authority credentials hang
    // off, so it let one platform repoint another merchant's identity at a key
    // it controlled.
    const owns = await platformMayManageMerchant(supabase, platform.name, merchant_id);
    if (!owns.ok) {
      return NextResponse.json({ error: owns.error }, { status: owns.status });
    }

    const { data: existing } = await supabase
      .from('merchant_dids')
      .select('id')
      .eq('merchant_id', merchant_id)
      .eq('did_kind', 'human')
      .maybeSingle();

    if (existing) {
      const { error: updateError } = await supabase
        .from('merchant_dids')
        .update({
          did,
          public_key: public_key ?? '',
          platform: platform.name,
          verified: true,
        })
        .eq('id', existing.id);
      if (updateError) {
        console.error('[DID Override] update error:', updateError);
        return NextResponse.json(
          { error: 'failed to update DID' },
          { status: 500 },
        );
      }
      await recordAuditEvent(supabase, {
        action: 'did.rebound',
        actorType: 'platform',
        actorId: platform.name,
        subjectType: 'merchant',
        subjectId: merchant_id,
        merchantId: merchant_id,
        detail: { did, previous_record_id: existing.id },
      });

      return NextResponse.json({ did, merchant_id, action: 'updated' });
    }

    const { error: insertError } = await supabase
      .from('merchant_dids')
      .insert({
        merchant_id,
        did,
        public_key: public_key ?? '',
        did_kind: 'human',
        platform: platform.name,
        verified: true,
      });
    if (insertError) {
      console.error('[DID Override] insert error:', insertError);
      return NextResponse.json(
        { error: 'failed to register DID' },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { did, merchant_id, action: 'inserted' },
      { status: 201 },
    );
  } catch (error) {
    console.error('[DID Override] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
