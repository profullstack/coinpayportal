/**
 * POST /api/escrow/:id/settle — Internal: forward escrow funds on-chain
 *
 * Called by the cron monitor after an escrow is released or refunded.
 * Auth: INTERNAL_API_KEY only (not user-facing)
 *
 * Uses the same secure forwarding infrastructure as payment forwarding.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { markEscrowSettled } from '@/lib/escrow';
import { decrypt } from '@/lib/crypto/encryption';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

function isInternalRequest(authHeader: string | null): boolean {
  const internalApiKey = process.env.INTERNAL_API_KEY;
  if (!internalApiKey) return false;
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.substring(7) === internalApiKey;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!isInternalRequest(authHeader)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: escrowId } = await params;
    const supabase = getSupabase();

    // Parse optional body (for refund action)
    let action = 'release';
    try {
      const body = await request.json();
      if (body?.action === 'refund') action = 'refund';
    } catch {
      // No body = default release
    }

    // Get escrow
    const { data: escrow, error } = await supabase
      .from('escrows')
      .select('*')
      .eq('id', escrowId)
      .single();

    if (error || !escrow) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 });
    }

    // Validate status
    const validStatuses = action === 'refund' ? ['refunded'] : ['released'];
    if (!validStatuses.includes(escrow.status)) {
      return NextResponse.json(
        { error: `Escrow status is ${escrow.status}, expected ${validStatuses.join(' or ')}` },
        { status: 400 }
      );
    }

    // Already settled?
    if (escrow.settlement_tx_hash) {
      return NextResponse.json(
        { error: 'Escrow already settled', tx_hash: escrow.settlement_tx_hash },
        { status: 409 }
      );
    }

    // Get the payment address record for the encrypted private key
    const { data: addressData, error: addrError } = await supabase
      .from('payment_addresses')
      .select('*')
      .eq('id', escrow.escrow_address_id)
      .single();

    if (addrError || !addressData) {
      return NextResponse.json(
        { error: 'Escrow address data not found' },
        { status: 500 }
      );
    }

    // Decrypt private key
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      return NextResponse.json(
        { error: 'Encryption key not configured' },
        { status: 500 }
      );
    }

    const privateKey = await decrypt(addressData.encrypted_private_key, encryptionKey);

    // Determine destination
    const destinationAddress = action === 'refund'
      ? escrow.depositor_address
      : escrow.beneficiary_address;

    const amountToSend = action === 'refund'
      ? (escrow.deposited_amount || escrow.amount) // Full refund (no fee on refunds)
      : (escrow.deposited_amount || escrow.amount) - (escrow.fee_amount || 0);

    // Use the same forwarding infrastructure as payments
    // Import dynamically to avoid circular deps
    const { getProvider, getRpcUrl } = await import('@/lib/blockchain/providers');

    const rpcUrl = getRpcUrl(escrow.chain);
    const provider = getProvider(escrow.chain, rpcUrl);

    let txHash: string | undefined;
    let feeTxHash: string | undefined;

    if (provider.sendTransaction) {
      // Forward to destination (beneficiary or depositor)
      // sendTransaction signature: (from, to, amount, privateKey) → string
      txHash = await provider.sendTransaction(
        addressData.address,
        destinationAddress,
        String(amountToSend),
        privateKey
      );

      // If release (not refund), also send platform fee to commission wallet
      if (action === 'release' && escrow.fee_amount > 0) {
        try {
          feeTxHash = await provider.sendTransaction(
            addressData.address,
            addressData.commission_wallet,
            String(escrow.fee_amount),
            privateKey
          );
        } catch (feeError) {
          console.error(`Fee forwarding failed for escrow ${escrowId}:`, feeError);
          // Non-fatal — main settlement still succeeded
        }
      }
    } else {
      return NextResponse.json(
        { error: `No transaction provider for chain ${escrow.chain}` },
        { status: 500 }
      );
    }

    // Mark as settled
    const finalStatus = action === 'refund' ? 'refunded' : 'settled';

    await supabase
      .from('escrows')
      .update({
        status: finalStatus,
        settled_at: new Date().toISOString(),
        settlement_tx_hash: txHash,
        fee_tx_hash: feeTxHash || null,
      })
      .eq('id', escrowId);

    await supabase.from('escrow_events').insert({
      escrow_id: escrowId,
      event_type: finalStatus === 'refunded' ? 'refunded' : 'settled',
      actor: 'system',
      details: {
        action,
        destination: destinationAddress,
        amount: amountToSend,
        tx_hash: txHash,
        fee_tx_hash: feeTxHash,
      },
    });

    // Mark the escrow address as used
    await supabase
      .from('payment_addresses')
      .update({ is_used: true })
      .eq('id', escrow.escrow_address_id);

    console.log(`Escrow ${escrowId} ${finalStatus}: tx=${txHash}`);

    return NextResponse.json({
      success: true,
      status: finalStatus,
      tx_hash: txHash,
      fee_tx_hash: feeTxHash,
    });
  } catch (error) {
    console.error('Escrow settlement error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Settlement failed' },
      { status: 500 }
    );
  }
}
