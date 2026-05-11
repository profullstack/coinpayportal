import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';
import { isValidDid, signCredential } from '@/lib/reputation/crypto';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

const ALLOWED_SCOPES = new Set([
  'reputation:read',
  'reputation:submit_receipt',
  'escrow:create',
  'escrow:settle',
  'invoice:create',
  'wallet:read',
  'wallet:transfer',
]);

/**
 * POST /api/reputation/did/delegate
 * Body: { agent_did, scope: string[], expires_at?: ISO8601, label?: string }
 *
 * Issues a DelegatedAuthorityCredential from the caller's principal DID to
 * the specified agent DID. The agent DID does not need to be registered —
 * the credential alone is sufficient proof of delegation.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const auth = await authenticateRequest(supabase, request.headers.get('authorization'));
    if (!auth.success || !auth.context) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const merchantId = isMerchantAuth(auth.context)
      ? auth.context.merchantId
      : auth.context.merchantId;

    const body = await request.json().catch(() => null) as {
      agent_did?: string;
      scope?: string[];
      expires_at?: string;
      label?: string;
    } | null;

    if (!body?.agent_did || !isValidDid(body.agent_did)) {
      return NextResponse.json({ error: 'agent_did is required and must be a valid DID' }, { status: 400 });
    }
    if (!Array.isArray(body.scope) || body.scope.length === 0) {
      return NextResponse.json({ error: 'scope[] is required' }, { status: 400 });
    }
    const invalid = body.scope.filter((s) => !ALLOWED_SCOPES.has(s));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Unknown scopes: ${invalid.join(', ')}`, allowed: Array.from(ALLOWED_SCOPES) },
        { status: 400 }
      );
    }

    let expiresAt: string | null = null;
    if (body.expires_at) {
      const t = Date.parse(body.expires_at);
      if (Number.isNaN(t)) {
        return NextResponse.json({ error: 'expires_at must be ISO8601' }, { status: 400 });
      }
      if (t <= Date.now()) {
        return NextResponse.json({ error: 'expires_at must be in the future' }, { status: 400 });
      }
      expiresAt = new Date(t).toISOString();
    }

    // Look up principal DID for caller
    const { data: principal } = await supabase
      .from('merchant_dids')
      .select('did')
      .eq('merchant_id', merchantId)
      .eq('did_kind', 'human')
      .single();

    if (!principal?.did) {
      return NextResponse.json(
        { error: 'You must claim a principal DID before delegating authority. Visit /reputation/did.' },
        { status: 409 }
      );
    }

    if (principal.did === body.agent_did) {
      return NextResponse.json({ error: 'Cannot delegate to yourself' }, { status: 400 });
    }

    const issuedAt = new Date().toISOString();
    const windowEnd = expiresAt ?? new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

    const data = {
      principal_did: principal.did,
      agent_did: body.agent_did,
      scope: body.scope,
      label: body.label ?? null,
      expires_at: expiresAt,
    };

    const signature = signCredential({
      agent_did: body.agent_did,
      credential_type: 'DelegatedAuthority',
      category: null,
      data,
      window_start: issuedAt,
      window_end: windowEnd,
      issued_at: issuedAt,
    });

    const { data: inserted, error } = await supabase
      .from('reputation_credentials')
      .insert({
        agent_did: body.agent_did,
        credential_type: 'DelegatedAuthority',
        category: null,
        data,
        window_start: issuedAt,
        window_end: windowEnd,
        issued_at: issuedAt,
        issuer_did: principal.did,
        signature,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error) {
      console.error('Delegation insert failed:', error);
      return NextResponse.json({ error: 'Failed to issue delegation' }, { status: 500 });
    }

    return NextResponse.json({ credential: inserted }, { status: 201 });
  } catch (err) {
    console.error('Delegation error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/reputation/did/delegate
 * Returns the caller's outstanding delegations (issued by their principal DID).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const auth = await authenticateRequest(supabase, request.headers.get('authorization'));
    if (!auth.success || !auth.context) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const merchantId = isMerchantAuth(auth.context)
      ? auth.context.merchantId
      : auth.context.merchantId;

    const { data: principal } = await supabase
      .from('merchant_dids')
      .select('did')
      .eq('merchant_id', merchantId)
      .eq('did_kind', 'human')
      .single();

    if (!principal?.did) {
      return NextResponse.json({ delegations: [] });
    }

    const { data: rows } = await supabase
      .from('reputation_credentials')
      .select('*')
      .eq('credential_type', 'DelegatedAuthority')
      .eq('issuer_did', principal.did)
      .order('issued_at', { ascending: false });

    return NextResponse.json({ delegations: rows ?? [] });
  } catch (err) {
    console.error('Delegation list error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/reputation/did/delegate?id=<credential_id>
 * Revokes a previously issued delegation.
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const auth = await authenticateRequest(supabase, request.headers.get('authorization'));
    if (!auth.success || !auth.context) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const merchantId = isMerchantAuth(auth.context)
      ? auth.context.merchantId
      : auth.context.merchantId;
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

    const { data: principal } = await supabase
      .from('merchant_dids')
      .select('did')
      .eq('merchant_id', merchantId)
      .eq('did_kind', 'human')
      .single();
    if (!principal?.did) {
      return NextResponse.json({ error: 'No principal DID' }, { status: 409 });
    }

    const { data: cred } = await supabase
      .from('reputation_credentials')
      .select('id, issuer_did')
      .eq('id', id)
      .single();
    if (!cred || cred.issuer_did !== principal.did) {
      return NextResponse.json({ error: 'Delegation not found' }, { status: 404 });
    }

    const { error } = await supabase
      .from('reputation_credentials')
      .update({ revoked: true, revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      return NextResponse.json({ error: 'Revoke failed' }, { status: 500 });
    }

    await supabase.from('reputation_revocations').insert({
      credential_id: id,
      reason: 'principal_revoked',
      revoked_by: principal.did,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Delegation revoke error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
