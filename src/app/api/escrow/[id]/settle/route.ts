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
import { isInternalApiKey } from '@/lib/auth/secret-compare';
import { requireEncryptionKey } from '@/lib/crypto/require-key';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

function isInternalRequest(authHeader: string | null): boolean {
  if (!authHeader?.startsWith('Bearer ')) return false;
  return isInternalApiKey(authHeader.substring(7).trim());
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

    // Claim the escrow before any on-chain work.
    //
    // The settlement_tx_hash check above is a read, and the write that records
    // the hash happens only after the transaction is broadcast. Two concurrent
    // settles therefore both read a null hash and both broadcast; where the
    // address holds any residual balance the second send moves the leftover
    // and custody reconciliation no longer adds up. This compare-and-swap
    // stakes the claim atomically: only the request that flips
    // settlement_started_at from NULL proceeds.
    const claimedAt = new Date().toISOString();
    const { data: claimedRows, error: claimErr } = await supabase
      .from('escrows')
      .update({ settlement_started_at: claimedAt })
      .eq('id', escrowId)
      .is('settlement_started_at', null)
      .is('settlement_tx_hash', null)
      .select('id');

    if (claimErr) {
      console.error(`Failed to claim escrow ${escrowId} for settlement:`, claimErr);
      return NextResponse.json({ error: 'Could not start settlement' }, { status: 500 });
    }

    if (!claimedRows || claimedRows.length === 0) {
      return NextResponse.json(
        { error: 'Settlement already in progress or completed' },
        { status: 409 }
      );
    }

    /**
     * Hand the claim back when settlement aborts before anything was
     * broadcast, so a transient failure does not wedge the escrow forever.
     * Guarded on the exact timestamp we wrote, so it can never clear a claim
     * taken by a later attempt.
     */
    const releaseClaim = async () => {
      await supabase
        .from('escrows')
        .update({ settlement_started_at: null })
        .eq('id', escrowId)
        .eq('settlement_started_at', claimedAt)
        .is('settlement_tx_hash', null);
    };

    // Get the payment address record for the encrypted private key
    const { data: addressData, error: addrError } = await supabase
      .from('payment_addresses')
      .select('*')
      .eq('id', escrow.escrow_address_id)
      .single();

    if (addrError || !addressData) {
      await releaseClaim();
      return NextResponse.json(
        { error: 'Escrow address data not found' },
        { status: 500 }
      );
    }

    // Decrypt private key. requireEncryptionKey throws on a missing, malformed
    // or known-weak key rather than letting settlement proceed under one.
    let encryptionKey: string;
    try {
      encryptionKey = requireEncryptionKey('escrow settlement');
    } catch (keyError) {
      await releaseClaim();
      console.error(`Escrow ${escrowId} settlement blocked:`, keyError);
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
    let feeForwardError: string | undefined;

    if (!provider.sendTransaction) {
      await releaseClaim();
      return NextResponse.json(
        { error: `No transaction provider for chain ${escrow.chain}` },
        { status: 500 }
      );
    }

    // Use split transaction when releasing with fee — single atomic tx
    // This avoids rent/balance issues from sequential sends
    if (action === 'release' && escrow.fee_amount > 0 && provider.sendSplitTransaction && addressData.commission_wallet) {
      try {
        const recipients = [
          { address: destinationAddress, amount: String(amountToSend) },
          { address: addressData.commission_wallet, amount: String(escrow.fee_amount) },
        ];
        console.log(`[Settle] Using split transaction for escrow ${escrowId}: ${JSON.stringify(recipients)}`);
        txHash = await provider.sendSplitTransaction(
          addressData.address,
          recipients,
          privateKey
        );
        // Both beneficiary and fee are in the same tx
        feeTxHash = txHash;
      } catch (splitError) {
        console.error(`Split transaction failed for escrow ${escrowId}, falling back to sequential:`, splitError);
        // Fall back to sequential sends
        txHash = undefined;
      }
    }

    // Fallback: sequential sends (refunds, or if split failed, or no commission)
    if (!txHash) {
      txHash = await provider.sendTransaction(
        addressData.address,
        destinationAddress,
        String(amountToSend),
        privateKey
      );

      // If release (not refund), also send platform fee to commission wallet
      if (action === 'release' && escrow.fee_amount > 0 && addressData.commission_wallet) {
        try {
          feeTxHash = await provider.sendTransaction(
            addressData.address,
            addressData.commission_wallet,
            String(escrow.fee_amount),
            privateKey
          );
        } catch (feeError) {
          // Non-fatal for the beneficiary — their leg already landed, and
          // unwinding it would be worse. But this used to be the end of it:
          // the escrow was marked settled with fee_tx_hash NULL and nothing
          // recorded that the platform was still owed its fee, so the loss was
          // invisible and unrecoverable. Write it to the escrow's event log,
          // which is the audit trail the rest of the flow already uses.
          feeForwardError = feeError instanceof Error ? feeError.message : String(feeError);
          console.error(`Fee forwarding failed for escrow ${escrowId}:`, feeError);

          await supabase.from('escrow_events').insert({
            escrow_id: escrowId,
            event_type: 'fee_forward_failed',
            actor: 'system',
            details: {
              error: feeForwardError,
              fee_amount: escrow.fee_amount,
              commission_wallet: addressData.commission_wallet,
              chain: escrow.chain,
              settlement_tx_hash: txHash,
              failed_at: new Date().toISOString(),
            },
          });
        }
      }
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

    // Record in wallet_transactions so it appears in wallet history
    if (txHash) {
      const { data: walletAddr } = await supabase
        .from('wallet_addresses')
        .select('wallet_id')
        .eq('address', addressData.address)
        .single();

      if (walletAddr?.wallet_id) {
        await supabase.from('wallet_transactions').insert({
          wallet_id: walletAddr.wallet_id,
          chain: escrow.chain,
          tx_hash: txHash,
          direction: 'outgoing',
          amount: String(amountToSend),
          from_address: addressData.address,
          to_address: destinationAddress,
          status: 'confirmed',
        });
      }
    }

    // Mark the escrow address as used
    await supabase
      .from('payment_addresses')
      .update({ is_used: true })
      .eq('id', escrow.escrow_address_id);

    console.log(`Escrow ${escrowId} ${finalStatus}: tx=${txHash}`);

    if (feeForwardError) {
      console.error(
        `[Escrow] ${escrowId} settled but the platform fee was NOT collected: ${feeForwardError}`
      );
    }

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
