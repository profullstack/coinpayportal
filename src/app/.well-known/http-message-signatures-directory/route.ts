/**
 * GET /.well-known/http-message-signatures-directory
 *
 * CoinPay's Web Bot Auth key directory: the JWKS that verifiers fetch to check
 * signatures from agents CoinPay hosts. Publishing it is what makes those
 * agents verifiable by anyone who speaks Web Bot Auth — Cloudflare included —
 * rather than only by CoinPay.
 *
 * Public and unauthenticated by design. It contains public keys only.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DIRECTORY_CONTENT_TYPE, isEd25519Jwk } from '@/lib/web-bot-auth';

export const dynamic = 'force-dynamic';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

export async function GET() {
  try {
    const supabase = getSupabase();
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from('web_bot_auth_keys')
      .select('jwk, not_before, expires_at')
      .eq('published', true)
      .eq('active', true)
      .is('revoked_at', null);

    if (error) {
      console.error('web-bot-auth directory query failed', error);
      return NextResponse.json({ error: 'Directory unavailable' }, { status: 503 });
    }

    const keys = (data ?? [])
      .filter((row) => {
        // Serving a key outside its stated window would invite verifiers to
        // accept signatures the operator considers retired.
        if (row.not_before && row.not_before > nowIso) return false;
        if (row.expires_at && row.expires_at <= nowIso) return false;
        return true;
      })
      .map((row) => row.jwk)
      .filter(isEd25519Jwk);

    return new NextResponse(JSON.stringify({ keys }), {
      status: 200,
      headers: {
        'content-type': DIRECTORY_CONTENT_TYPE,
        // Short cache: verifiers re-read this to pick up rotations and
        // revocations, and a long TTL keeps a revoked key alive downstream.
        'cache-control': 'public, max-age=300, must-revalidate',
      },
    });
  } catch (err) {
    console.error('web-bot-auth directory error', err);
    return NextResponse.json({ error: 'Directory unavailable' }, { status: 503 });
  }
}
