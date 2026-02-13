/**
 * POST /api/escrow/:id/auth — Authenticate escrow access
 * Auth: token (release_token or beneficiary_token)
 * Returns: escrow data + role (depositor/beneficiary/arbiter)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getEscrow } from '@/lib/escrow/service';
import type { Escrow } from '@/lib/escrow/types';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/**
 * Authenticate an escrow action.
 * Returns the role of the caller: 'depositor', 'beneficiary', 'arbiter', or null.
 */
function authenticateEscrowAction(
  escrow: Escrow,
  token: string
): 'depositor' | 'beneficiary' | 'arbiter' | null {
  if (token === escrow.release_token) return 'depositor';
  if (token === escrow.beneficiary_token) return 'beneficiary';
  // Arbiter auth would be signature-based in v2
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!body.token) {
      return NextResponse.json(
        { error: 'Authentication token is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();
    
    // Get escrow with tokens for authentication
    const { data, error } = await supabase
      .from('escrows')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Escrow not found' },
        { status: 404 }
      );
    }

    const escrow = data as Escrow;

    // Authenticate the token
    const role = authenticateEscrowAction(escrow, body.token);
    if (!role) {
      return NextResponse.json(
        { error: 'Invalid authentication token' },
        { status: 403 }
      );
    }

    // Get the public escrow data
    const publicResult = await getEscrow(supabase, id);
    if (!publicResult.success || !publicResult.escrow) {
      return NextResponse.json(
        { error: 'Failed to fetch escrow data' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      escrow: publicResult.escrow,
      role,
    });
  } catch (error) {
    console.error('Failed to authenticate escrow access:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}