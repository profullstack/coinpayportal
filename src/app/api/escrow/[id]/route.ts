/**
 * GET /api/escrow/:id — Get escrow status
 * Requires auth token via query param (release_token or beneficiary_token) or Authorization header
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getEscrow } from '@/lib/escrow';
import { authenticateRequest } from '@/lib/auth/middleware';
import { callerOwnsEscrow } from '@/lib/escrow/access';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = getSupabase();

    // Check for auth: query token, Authorization header, or API key
    const { searchParams } = new URL(request.url);
    const queryToken = searchParams.get('token') || searchParams.get('release_token') || searchParams.get('beneficiary_token');
    const authHeader = request.headers.get('authorization');
    const apiKeyHeader = request.headers.get('x-api-key');

    const hasAuth = queryToken || authHeader || apiKeyHeader;
    if (!hasAuth) {
      return NextResponse.json(
        { error: 'Authentication required. Provide token query parameter or Authorization header.' },
        { status: 401 }
      );
    }

    // If using bearer/api-key auth, validate it
    let authContext: Awaited<ReturnType<typeof authenticateRequest>>['context'] | undefined;
    if ((authHeader || apiKeyHeader) && !queryToken) {
      try {
        const authResult = await authenticateRequest(supabase, authHeader || apiKeyHeader);
        if (!authResult.success || !authResult.context) {
          return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
        }
        authContext = authResult.context;
      } catch {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
      }
    }

    const result = await getEscrow(supabase, id);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    // If using query token, verify it matches escrow tokens
    if (queryToken && result.escrow) {
      const escrow = result.escrow as any;
      const validToken = queryToken === escrow.release_token || queryToken === escrow.beneficiary_token;
      if (!validToken) {
        return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
      }
    }

    // Authenticating the caller established only that they hold *a* valid
    // credential — not that this escrow is theirs. Any merchant's API key could
    // read any escrow by UUID: counterparty emails, amounts, address hashes and
    // dispute reasons. The token path above is checked; this one was not.
    if (authContext && result.escrow) {
      const escrow = result.escrow as any;
      const allowed = await callerOwnsEscrow(supabase, authContext, escrow);
      if (!allowed) {
        return NextResponse.json({ error: 'Escrow not found' }, { status: 404 });
      }
    }

    return NextResponse.json(result.escrow);
  } catch (error) {
    console.error('Failed to get escrow:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
