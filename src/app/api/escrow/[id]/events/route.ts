/**
 * GET /api/escrow/:id/events — Get escrow audit log (requires auth)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getEscrow, getEscrowEvents } from '@/lib/escrow';
import { authenticateRequest } from '@/lib/auth/middleware';

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

    // Check for auth
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
    if ((authHeader || apiKeyHeader) && !queryToken) {
      try {
        const authResult = await authenticateRequest(supabase, authHeader || apiKeyHeader);
        if (!authResult.success) {
          return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
        }
      } catch {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
      }
    }

    // If using query token, verify it matches the escrow
    if (queryToken) {
      const escrowResult = await getEscrow(supabase, id);
      if (!escrowResult.success) {
        return NextResponse.json({ error: 'Escrow not found' }, { status: 404 });
      }
      const escrow = escrowResult.escrow as any;
      const validToken = queryToken === escrow.release_token || queryToken === escrow.beneficiary_token;
      if (!validToken) {
        return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
      }
    }

    const result = await getEscrowEvents(supabase, id);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ events: result.events });
  } catch (error) {
    console.error('Failed to get escrow events:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
