/**
 * POST /api/escrow/multisig/:id/propose
 *
 * Propose a transaction (release or refund) for a multisig escrow.
 * Returns transaction data that signers need to sign.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  proposeTransaction,
  proposeTransactionSchema,
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
    const parsed = proposeTransactionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0].message },
        { status: 400 },
      );
    }

    const result = await proposeTransaction(
      supabase,
      escrowId,
      parsed.data.proposal_type,
      parsed.data.to_address,
      parsed.data.signer_pubkey,
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      proposal: result.proposal,
      tx_data: result.tx_data,
    }, { status: 201 });
  } catch (error) {
    console.error('Failed to propose transaction:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
