/**
 * POST /api/escrow/:id/settle — Internal: forward escrow funds on-chain
 *
 * Called by the cron monitor after an escrow is released or refunded.
 * Auth: INTERNAL_API_KEY only (not user-facing)
 *
 * Uses the same secure forwarding infrastructure as payment forwarding.
 */

import { NextRequest, NextResponse } from 'next/server';
import { planSettlement, type SettlementPlan } from '@/lib/escrow/settlement-plan';
import { createClient } from '@supabase/supabase-js';
import { markEscrowSettled } from '@/lib/escrow';
import { isInternalApiKey } from '@/lib/auth/secret-compare';
import { OperatorKeysLockedError, openPaymentAddressKey, operatorAlert } from '@/lib/wallets/operator-keys';

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
    let action: 'release' | 'refund' = 'release';
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

    // Open the escrow address key: sealed to the operator vault (needs an
    // operator unlock), or a legacy ENCRYPTION_KEY row. Locked: 423, and the
    // claim is released so settlement can run after the next unlock.
    let privateKey: string;
    try {
      privateKey = await openPaymentAddressKey(addressData, (sealed) =>
        Promise.resolve(supabase.from('payment_addresses').update({ encrypted_private_key: sealed }).eq('id', addressData.id)),
      );
    } catch (keyError) {
      await releaseClaim();
      if (keyError instanceof OperatorKeysLockedError || (keyError as { code?: string })?.code === 'vault_locked') {
        operatorAlert(`escrow ${escrowId} settlement waiting: operator keys locked`);
        return NextResponse.json(
          { error: 'Settlement is paused: CoinPay operator keys are locked. It runs after the next operator unlock.', code: 'operator_locked' },
          { status: 423 }
        );
      }
      console.error(`Escrow ${escrowId} settlement blocked:`, keyError instanceof Error ? keyError.message : keyError);
      return NextResponse.json({ error: 'Escrow key unavailable' }, { status: 500 });
    }

    // Who gets what. Throws when the fees would leave the beneficiary nothing,
    // which the create path already refuses, so it means a corrupted row.
    let plan: SettlementPlan;
    try {
      plan = planSettlement(escrow, action, addressData.commission_wallet);
    } catch (planError) {
      await releaseClaim();
      return NextResponse.json(
        { error: planError instanceof Error ? planError.message : 'Invalid settlement amounts' },
        { status: 500 }
      );
    }
    const destinationAddress = plan.primary.address;
    const amountToSend = plan.primary.amount;
    const feeLegs = plan.legs.slice(1);

    // Use the same forwarding infrastructure as payments
    // Import dynamically to avoid circular deps
    const { getProvider, getRpcUrl } = await import('@/lib/blockchain/providers');

    const rpcUrl = getRpcUrl(escrow.chain);
    const provider = getProvider(escrow.chain, rpcUrl);

    let txHash: string | undefined;
    let feeTxHash: string | undefined;
    let marketplaceFeeTxHash: string | undefined;
    let feeForwardError: string | undefined;

    // USDC/USDT: the escrow holds the token, and the native-coin providers
    // below would send SOL/ETH/POL instead. Every leg goes as the token, in
    // one call: SPL on Solana (one transaction, recipient token accounts
    // created as needed, fee paid by the CoinPay fee payer), ERC-20 through
    // the gas relayer on EVM chains.
    const { isTokenTransferChain, sendTokenTransfers, ForwardNotStartedError, SolanaFeeShortfallError } =
      await import('@/lib/wallets/secure-forwarding');

    const tokenChain = isTokenTransferChain(escrow.chain);
    if (tokenChain) {
      // USDC and USDT have 6 decimals on every chain we settle. A primary leg
      // under one unit would send the fees and nothing to the beneficiary.
      if (Math.round(amountToSend * 1e6) < 1) {
        await releaseClaim();
        return NextResponse.json(
          { error: `Settlement amount ${amountToSend} is below one ${escrow.chain} token unit` },
          { status: 500 }
        );
      }
      let legHashes: Array<string | undefined>;
      try {
        legHashes = await sendTokenTransfers(
          escrow.chain,
          rpcUrl,
          privateKey,
          plan.legs.map((leg) => ({ address: leg.address, amount: leg.amount })),
        );
      } catch (tokenError) {
        const message = tokenError instanceof Error ? tokenError.message : String(tokenError);
        // Raised before anything was signed: hand the claim back so the
        // monitor retries once the relayer or fee payer is topped up.
        if (tokenError instanceof ForwardNotStartedError || tokenError instanceof SolanaFeeShortfallError) {
          await releaseClaim();
          operatorAlert(`escrow ${escrowId} ${escrow.chain} settlement waiting: ${message}`);
          return NextResponse.json({ error: message, code: 'gas_unavailable' }, { status: 503 });
        }
        // Anything else may have broadcast part of the settlement, so the
        // claim stays and the escrow waits for reconciliation.
        console.error(`[Settle] ${escrow.chain} escrow ${escrowId} ${action} needs reconciliation: ${message}`);
        operatorAlert(`escrow ${escrowId} ${escrow.chain} ${action} failed and may be partly sent: ${message}`);
        throw tokenError;
      }
      txHash = legHashes[0];
      plan.legs.forEach((leg, i) => {
        if (i === 0) return;
        if (leg.kind === 'platform_fee') feeTxHash = legHashes[i];
        else if (leg.kind === 'marketplace_fee') marketplaceFeeTxHash = legHashes[i];
      });
    } else if (!provider.sendTransaction) {
      await releaseClaim();
      return NextResponse.json(
        { error: `No transaction provider for chain ${escrow.chain}` },
        { status: 500 }
      );
    }

    // Use split transaction when releasing with fees — single atomic tx
    // This avoids rent/balance issues from sequential sends
    if (!tokenChain && feeLegs.length > 0 && provider.sendSplitTransaction) {
      try {
        const recipients = plan.legs.map((leg) => ({ address: leg.address, amount: String(leg.amount) }));
        console.log(`[Settle] Using split transaction for escrow ${escrowId}: ${JSON.stringify(recipients)}`);
        txHash = await provider.sendSplitTransaction(
          addressData.address,
          recipients,
          privateKey
        );
        // Every leg is in the same tx
        if (feeLegs.some((leg) => leg.kind === 'platform_fee')) feeTxHash = txHash;
        if (feeLegs.some((leg) => leg.kind === 'marketplace_fee')) marketplaceFeeTxHash = txHash;
      } catch (splitError) {
        console.error(`Split transaction failed for escrow ${escrowId}, falling back to sequential:`, splitError);
        // Fall back to sequential sends
        txHash = undefined;
      }
    }

    // Fallback: sequential sends (refunds, or if split failed, or no fee legs)
    if (!tokenChain && !txHash && provider.sendTransaction) {
      txHash = await provider.sendTransaction(
        addressData.address,
        destinationAddress,
        String(amountToSend),
        privateKey
      );

      for (const leg of feeLegs) {
        try {
          const legTxHash = await provider.sendTransaction(
            addressData.address,
            leg.address,
            String(leg.amount),
            privateKey
          );
          if (leg.kind === 'platform_fee') feeTxHash = legTxHash;
          else marketplaceFeeTxHash = legTxHash;
        } catch (feeError) {
          // Non-fatal for the beneficiary — their leg already landed, and
          // unwinding it would be worse. But this used to be the end of it:
          // the escrow was marked settled with fee_tx_hash NULL and nothing
          // recorded that the fee was still owed, so the loss was invisible
          // and unrecoverable. Write it to the escrow's event log, which is
          // the audit trail the rest of the flow already uses.
          const message = feeError instanceof Error ? feeError.message : String(feeError);
          feeForwardError = feeForwardError ? `${feeForwardError}; ${leg.kind}: ${message}` : `${leg.kind}: ${message}`;
          console.error(`Fee forwarding (${leg.kind}) failed for escrow ${escrowId}:`, feeError);

          await supabase.from('escrow_events').insert({
            escrow_id: escrowId,
            event_type: leg.kind === 'platform_fee' ? 'fee_forward_failed' : 'marketplace_fee_forward_failed',
            actor: 'system',
            details: {
              error: message,
              fee_amount: leg.amount,
              ...(leg.kind === 'platform_fee'
                ? { commission_wallet: leg.address }
                : { marketplace_fee_address: leg.address }),
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
        marketplace_fee_tx_hash: marketplaceFeeTxHash || null,
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
        ...(marketplaceFeeTxHash ? { marketplace_fee_tx_hash: marketplaceFeeTxHash } : {}),
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
        `[Escrow] ${escrowId} settled but a fee was NOT collected: ${feeForwardError}`
      );
    }

    return NextResponse.json({
      success: true,
      status: finalStatus,
      tx_hash: txHash,
      fee_tx_hash: feeTxHash,
      marketplace_fee_tx_hash: marketplaceFeeTxHash,
    });
  } catch (error) {
    console.error('Escrow settlement error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Settlement failed' },
      { status: 500 }
    );
  }
}
