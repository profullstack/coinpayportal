/**
 * POST /api/web-bot-auth/verify
 *
 * Verify a Web Bot Auth signature and, when the key is registered, return the
 * CoinPay identity and trust tier behind it.
 *
 * This is the identity half of what Cloudflare resolves at its edge: who is
 * calling, whether that claim is cryptographic, and what their track record
 * is — answered for any origin, not only ones behind a particular CDN.
 *
 * Body: { method, url, headers: { signature, signature-input, signature-agent } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { verifyWebBotAuth } from '@/lib/web-bot-auth';
import { resolveAgentIdentity } from '@/lib/web-bot-auth/identity';
import { computeTrustVector } from '@/lib/reputation/trust-engine';
import { computeTrustTier } from '@/lib/reputation/trust-tiers';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

const verifySchema = z.object({
  method: z.string().min(1),
  url: z.string().url(),
  headers: z.record(z.string()),
});

export async function POST(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-api-key');
    if (!apiKey) {
      return NextResponse.json({ error: 'API key required' }, { status: 401 });
    }

    const supabase = getSupabase();

    const { data: keyData, error: keyError } = await supabase
      .from('api_keys')
      .select('id, business_id, active')
      .eq('key_hash', apiKey)
      .single();

    if (keyError || !keyData?.active) {
      return NextResponse.json({ error: 'Invalid or inactive API key' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ') },
        { status: 400 }
      );
    }

    const result = await verifyWebBotAuth(parsed.data);

    if (!result.verified) {
      // Not an error: most callers are unsigned, and the merchant decides what
      // to do about that. 200 with verified:false keeps that distinction.
      return NextResponse.json({
        verified: false,
        reason: result.reason,
        detail: result.detail ?? null,
      });
    }

    const identity = await resolveAgentIdentity(supabase, result);

    // Trust is only meaningful for a key bound to a DID with a history.
    let trust = null;
    if (identity.did) {
      try {
        const profile = await computeTrustVector(supabase, identity.did);
        const tier = computeTrustTier(profile.trust_vector);
        trust = {
          tier: tier.tier,
          score: tier.score,
          label: tier.label,
          risk_level: tier.risk_level,
        };
      } catch (err) {
        // A reputation failure must not turn a good signature into a bad one.
        console.error('web-bot-auth trust lookup failed', err);
      }
    }

    return NextResponse.json({
      verified: true,
      keyid: result.keyid,
      signature_agent: result.signatureAgent,
      agent_origin: result.agentOrigin,
      covered_components: result.coveredComponents,
      expires_at: result.expiresAt,
      identity: {
        // known:false means unregistered, which is not the same as untrusted —
        // any agent that has never registered here looks exactly like this.
        known: identity.known,
        did: identity.did,
        label: identity.label,
      },
      trust,
    });
  } catch (err) {
    console.error('web-bot-auth verify error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
