/**
 * POST /api/escrow/multisig/:id/dispute
 *
 * Open a dispute on a funded multisig escrow.
 * Either depositor or beneficiary can open a dispute.
 * Once disputed, the arbiter can propose resolution.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  disputeMultisigEscrow,
  disputeSchema,
} from '@/lib/multisig';
<<<<<<< HEAD
import { requireMultisigAuth } from '../../auth';
=======
>>>>>>> feat/multisig-escrow

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
<<<<<<< HEAD
    const auth = await requireMultisigAuth(request);
    if (!auth.ok) return auth.response;

=======
>>>>>>> feat/multisig-escrow
    const { id: escrowId } = await params;
    const supabase = getSupabase();
    const body = await request.json();

    // Validate input
    const parsed = disputeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0].message },
        { status: 400 },
      );
    }

    const result = await disputeMultisigEscrow(
      supabase,
      escrowId,
      parsed.data.signer_pubkey,
      parsed.data.reason,
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.escrow);
  } catch (error) {
    console.error('Failed to open dispute:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
