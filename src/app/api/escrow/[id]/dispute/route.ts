/**
 * POST /api/escrow/:id/dispute — Open a dispute
 * Auth: release_token (depositor) OR beneficiary_token (beneficiary)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { disputeEscrow } from '@/lib/escrow';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const token = body.release_token || body.beneficiary_token || body.token;
    if (!token) {
      return NextResponse.json(
        { error: 'Authentication token is required (release_token or beneficiary_token)' },
        { status: 400 }
      );
    }

    if (!body.reason) {
      return NextResponse.json(
        { error: 'Dispute reason is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();
    const result = await disputeEscrow(supabase, id, token, body.reason);

    if (!result.success) {
      const status = result.error?.includes('Unauthorized') ? 403 :
        result.error?.includes('not found') ? 404 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json(result.escrow);
  } catch (error) {
    console.error('Failed to dispute escrow:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
