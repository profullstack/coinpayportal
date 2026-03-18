/**
 * POST /api/escrow/multisig/:id/broadcast
 *
 * Broadcast an approved multisig proposal on-chain.
 * Requires the proposal to have reached threshold (2 signatures).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  broadcastTransaction,
  broadcastTransactionSchema,
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
    const parsed = broadcastTransactionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0].message },
        { status: 400 },
      );
    }

    const result = await broadcastTransaction(
      supabase,
      escrowId,
      parsed.data.proposal_id,
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      tx_hash: result.tx_hash,
      proposal: result.proposal,
<<<<<<< HEAD
      broadcasted: result.broadcasted === true,
      stage: result.stage!,
=======
>>>>>>> feat/multisig-escrow
    });
  } catch (error) {
    console.error('Failed to broadcast transaction:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
