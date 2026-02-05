/**
 * POST /api/escrow/:id/release — Release funds to beneficiary
 * Auth: release_token (depositor only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { releaseEscrow } from '@/lib/escrow';

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

    if (!body.release_token) {
      return NextResponse.json(
        { error: 'release_token is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();
    const result = await releaseEscrow(supabase, id, body.release_token);

    if (!result.success) {
      const status = result.error?.includes('Unauthorized') ? 403 :
        result.error?.includes('not found') ? 404 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json(result.escrow);
  } catch (error) {
    console.error('Failed to release escrow:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
