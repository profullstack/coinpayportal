/**
 * POST /api/escrow/multisig/:id/sign
 *
 * Add a signature to a multisig proposal.
 * Each participant can sign once. When threshold (2) is reached,
 * the proposal is marked as approved and ready for broadcast.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  signProposal,
  signProposalSchema,
} from '@/lib/multisig';

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
    const { id: escrowId } = await params;
    const supabase = getSupabase();
    const body = await request.json();

    // Validate input
    const parsed = signProposalSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0].message },
        { status: 400 },
      );
    }

    const result = await signProposal(
      supabase,
      escrowId,
      parsed.data.proposal_id,
      parsed.data.signer_pubkey,
      parsed.data.signature,
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      signature: result.signature,
      signatures_collected: result.signatures_collected,
      threshold_met: result.threshold_met,
    });
  } catch (error) {
    console.error('Failed to sign proposal:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
