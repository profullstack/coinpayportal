/**
 * Web Bot Auth key registry API
 *
 *   POST /api/web-bot-auth/keys  — register a public key against an identity
 *   GET  /api/web-bot-auth/keys  — list the caller's registered keys
 *
 * Registering a key is what turns an anonymous-but-verified signature into a
 * CoinPay identity with a DID and a reputation behind it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/auth/middleware';
import { registerAgentKey } from '@/lib/web-bot-auth/identity';
import { isEd25519Jwk, jwkThumbprint } from '@/lib/web-bot-auth';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

const jwkSchema = z.object({
  kty: z.literal('OKP'),
  crv: z.literal('Ed25519'),
  x: z.string().min(1),
  // Reject a private key outright rather than silently discarding `d`: an
  // operator who pastes one needs to know it was exposed, not have it ignored.
  d: z.never().optional(),
});

const registerSchema = z.object({
  jwk: jwkSchema,
  signature_agent: z.string().url().optional(),
  agent_did: z.string().startsWith('did:').optional(),
  label: z.string().max(200).optional(),
  /** Serve this key from CoinPay's own directory. */
  published: z.boolean().optional(),
});

/** Resolve the merchant behind either a JWT or an API key. */
async function resolveMerchantId(
  supabase: ReturnType<typeof getSupabase>,
  request: NextRequest
): Promise<string | null> {
  const auth = await authenticateRequest(
    supabase,
    request.headers.get('authorization')
  );
  if (!auth.success || !auth.context) return null;
  // Both contexts carry the owning merchant; a business key acts for its owner.
  return auth.context.merchantId;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();

    const merchantId = await resolveMerchantId(supabase, request);
    if (!merchantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ') },
        { status: 400 }
      );
    }

    const { jwk, signature_agent, agent_did, label, published } = parsed.data;
    if (!isEd25519Jwk(jwk)) {
      return NextResponse.json({ error: 'Not a valid Ed25519 public JWK' }, { status: 400 });
    }

    // A key published from CoinPay's directory must not also claim to live at
    // someone else's, or the two directories would disagree about who owns it.
    if (published && signature_agent) {
      return NextResponse.json(
        { error: 'A published key cannot also declare an external signature_agent' },
        { status: 400 }
      );
    }

    // Only bind a DID the caller actually controls.
    if (agent_did) {
      const { data: owned } = await supabase
        .from('merchant_dids')
        .select('did')
        .eq('did', agent_did)
        .eq('merchant_id', merchantId)
        .maybeSingle();

      if (!owned) {
        return NextResponse.json(
          { error: 'agent_did is not registered to this account' },
          { status: 403 }
        );
      }
    }

    const result = await registerAgentKey(supabase, {
      jwk,
      signatureAgent: signature_agent ?? null,
      agentDid: agent_did ?? null,
      merchantId,
      label: label ?? null,
      published: published ?? false,
    });

    if ('error' in result) {
      const conflict = result.error === 'Key already registered';
      return NextResponse.json({ error: result.error }, { status: conflict ? 409 : 500 });
    }

    return NextResponse.json(
      {
        keyid: result.keyid,
        // Echo the thumbprint the signer must put in Signature-Input.
        hint: 'Use this keyid in the Signature-Input keyid parameter',
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('web-bot-auth key registration error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabase();

    const merchantId = await resolveMerchantId(supabase, request);
    if (!merchantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('web_bot_auth_keys')
      .select('keyid, jwk, signature_agent, agent_did, label, published, active, created_at, revoked_at')
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: 'Could not list keys' }, { status: 500 });
    }

    return NextResponse.json({
      keys: (data ?? []).map((row) => ({
        ...row,
        // Recompute rather than trust the stored value, so a row edited out of
        // band cannot misreport which key it is.
        keyid_check: isEd25519Jwk(row.jwk) ? jwkThumbprint(row.jwk) : null,
      })),
    });
  } catch (err) {
    console.error('web-bot-auth key list error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
