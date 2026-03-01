/**
 * POST /api/escrow/multisig/:id/prepare
 *
 * Prepare a transaction (release or refund) for a multisig escrow.
 * Backward-compatible replacement for /propose naming.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  proposeTransaction,
  prepareTransactionSchema,
} from '@/lib/multisig';
import { requireMultisigAuth } from '../../auth';

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
    const auth = await requireMultisigAuth(request);
    if (!auth.ok) return auth.response;

    const { id: escrowId } = await params;
    const supabase = getSupabase();
    const body = await request.json();

    const parsed = prepareTransactionSchema.safeParse(body);
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
      stage: 'prepared',
      proposal: result.proposal,
      tx_data: result.tx_data,
    }, { status: 201 });
  } catch (error) {
    console.error('Failed to prepare transaction:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
