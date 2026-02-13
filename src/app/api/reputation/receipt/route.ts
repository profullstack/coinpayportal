/**
 * POST /api/reputation/receipt — Submit an immutable task receipt
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateReceipt, verifyReceiptSignatures, verifyEscrowTx, storeReceipt } from '@/lib/reputation/receipt-service';
import type { TaskReceipt } from '@/lib/reputation/receipt-service';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Partial<TaskReceipt>;

    // 1. Validate schema
    const validation = validateReceipt(body);
    if (!validation.valid) {
      return NextResponse.json({ error: 'Validation failed', details: validation.errors }, { status: 400 });
    }

    const receipt = body as TaskReceipt;

    // 2. Verify signatures
    const sigResult = verifyReceiptSignatures(receipt);
    if (!sigResult.valid) {
      return NextResponse.json({ error: 'No valid signatures' }, { status: 400 });
    }

    const supabase = getSupabase();

    // 3. Verify escrow tx if provided
    if (receipt.escrow_tx) {
      const escrowValid = await verifyEscrowTx(supabase, receipt.escrow_tx);
      if (!escrowValid) {
        return NextResponse.json({ error: 'Invalid escrow transaction' }, { status: 400 });
      }
    }

    // 4. Store
    const result = await storeReceipt(supabase, receipt);
    if (!result.success) {
      const status = result.error === 'Duplicate receipt_id' ? 409 : 500;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ id: result.id, verified_signatures: sigResult.verified }, { status: 201 });
  } catch (error) {
    console.error('Receipt submission error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
