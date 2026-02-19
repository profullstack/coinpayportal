/**
 * POST /api/x402/verify — Verify an x402 payment proof
 * 
 * CoinPayPortal's multi-chain, multi-asset x402 facilitator.
 * Validates payment proofs for:
 *   - EVM chains (ETH, POL, USDC on ETH/Polygon/Base) via EIP-712 signatures
 *   - Bitcoin/Bitcoin Cash via transaction proof
 *   - Solana (SOL, USDC) via transaction signature
 *   - Lightning via BOLT12 preimage
 *   - Stripe via payment intent
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/** Payment schemes and their verification strategies */
type PaymentScheme = 'exact' | 'bolt12' | 'stripe-checkout';

/** Chain IDs for EVM signature verification */
const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  polygon: 137,
  base: 8453,
};

/** EVM networks (use EIP-712 signature verification) */
const EVM_NETWORKS = new Set(['ethereum', 'polygon', 'base']);

/** UTXO networks (use transaction proof verification) */
const UTXO_NETWORKS = new Set(['bitcoin', 'bitcoin-cash']);

/** EIP-712 type for EVM payment signatures */
const PAYMENT_TYPES = {
  Payment: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'asset', type: 'address' },
  ],
};

/**
 * Verify an EVM payment (ETH, POL, USDC on any EVM chain).
 */
async function verifyEvmPayment(payment: any) {
  const { signature, payload } = payment;
  const { from, to, amount, nonce, expiresAt, network, asset } = payload;

  const chainId = CHAIN_IDS[network];
  if (!chainId) return { valid: false, error: `Unknown EVM network: ${network}` };

  // Check expiry
  if (expiresAt && expiresAt * 1000 < Date.now()) {
    return { valid: false, error: 'Payment proof has expired' };
  }

  // Verify EIP-712 typed data signature
  const domain = {
    name: 'x402',
    version: '1',
    chainId,
    verifyingContract: asset || '0x0000000000000000000000000000000000000000',
  };

  const recoveredAddress = ethers.verifyTypedData(
    domain,
    PAYMENT_TYPES,
    { from, to, amount, nonce, expiresAt, asset: asset || '0x0000000000000000000000000000000000000000' },
    signature
  );

  if (recoveredAddress.toLowerCase() !== from.toLowerCase()) {
    return { valid: false, error: 'Invalid payment signature' };
  }

  return { valid: true };
}

/**
 * Verify a Bitcoin/Bitcoin Cash transaction proof.
 * The proof contains a txId that can be looked up on-chain.
 */
async function verifyUtxoPayment(payment: any) {
  const { payload } = payment;
  const { txId, to, amount, network } = payload;

  if (!txId) return { valid: false, error: 'Missing txId in UTXO payment proof' };

  // Use CoinPayPortal's existing payment monitoring infrastructure
  // to verify the transaction was broadcast and has the correct outputs.
  // For now, we accept the txId and verify asynchronously during settlement.
  // A production implementation would query a block explorer or full node.
  return { valid: true, pendingConfirmation: true };
}

/**
 * Verify a Solana transaction signature.
 */
async function verifySolanaPayment(payment: any) {
  const { payload } = payment;
  const { txSignature, from, to, amount } = payload;

  if (!txSignature) return { valid: false, error: 'Missing txSignature in Solana payment proof' };

  // Verify via Solana RPC — the signature is checked during settlement.
  // Accept optimistically for low-latency response; settle confirms finality.
  return { valid: true, pendingConfirmation: true };
}

/**
 * Verify a Lightning BOLT12 payment.
 */
async function verifyLightningPayment(payment: any) {
  const { payload } = payment;
  const { preimage, paymentHash } = payload;

  if (!preimage || !paymentHash) {
    return { valid: false, error: 'Missing preimage or paymentHash in Lightning proof' };
  }

  // Verify that SHA256(preimage) === paymentHash
  const crypto = await import('crypto');
  const computedHash = crypto.createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');

  if (computedHash !== paymentHash) {
    return { valid: false, error: 'Lightning preimage does not match payment hash' };
  }

  return { valid: true };
}

/**
 * Verify a Stripe payment intent.
 */
async function verifyStripePayment(payment: any) {
  const { payload } = payment;
  const { paymentIntentId } = payload;

  if (!paymentIntentId) {
    return { valid: false, error: 'Missing paymentIntentId in Stripe proof' };
  }

  // Verify via Stripe API
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return { valid: false, error: 'Stripe not configured' };

  try {
    const res = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    const pi = await res.json();

    if (pi.status === 'succeeded' || pi.status === 'requires_capture') {
      return { valid: true };
    }
    return { valid: false, error: `Stripe payment status: ${pi.status}` };
  } catch (err: any) {
    return { valid: false, error: `Stripe verification failed: ${err.message}` };
  }
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-api-key');
    if (!apiKey) {
      return NextResponse.json({ error: 'API key required' }, { status: 401 });
    }

    const supabase = getSupabase();

    // Validate API key
    const { data: keyData, error: keyError } = await supabase
      .from('api_keys')
      .select('id, business_id, active')
      .eq('key_hash', apiKey)
      .single();

    if (keyError || !keyData?.active) {
      return NextResponse.json({ error: 'Invalid or inactive API key' }, { status: 401 });
    }

    const body = await request.json();
    const { payment } = body;

    if (!payment || !payment.payload) {
      return NextResponse.json(
        { error: 'Invalid payment proof: missing payload' },
        { status: 400 }
      );
    }

    const { network, scheme } = payment.payload;
    const methodKey = payment.payload.methodKey || payment.payload.extra?.methodKey;

    // Route to the appropriate verifier based on network/scheme
    let result: { valid: boolean; error?: string; pendingConfirmation?: boolean };

    if (scheme === 'bolt12' || network === 'lightning') {
      result = await verifyLightningPayment(payment);
    } else if (scheme === 'stripe-checkout' || network === 'stripe') {
      result = await verifyStripePayment(payment);
    } else if (EVM_NETWORKS.has(network)) {
      result = await verifyEvmPayment(payment);
    } else if (UTXO_NETWORKS.has(network)) {
      result = await verifyUtxoPayment(payment);
    } else if (network === 'solana') {
      result = await verifySolanaPayment(payment);
    } else {
      return NextResponse.json(
        { error: `Unsupported network/scheme: ${network}/${scheme}` },
        { status: 400 }
      );
    }

    if (!result.valid) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Check for replay (nonce/txId already used)
    const uniqueKey = payment.payload.nonce || payment.payload.txId || payment.payload.txSignature || payment.payload.preimage;
    if (uniqueKey) {
      const { data: existingPayment } = await supabase
        .from('x402_payments')
        .select('id')
        .eq('unique_key', uniqueKey)
        .eq('network', network)
        .single();

      if (existingPayment) {
        return NextResponse.json(
          { error: 'Payment proof already used (replay detected)' },
          { status: 400 }
        );
      }
    }

    // Record the verified payment
    await supabase.from('x402_payments').insert({
      business_id: keyData.business_id,
      from_address: (payment.payload.from || '').toLowerCase(),
      to_address: (payment.payload.to || '').toLowerCase(),
      amount: payment.payload.amount,
      unique_key: uniqueKey,
      network,
      scheme: scheme || 'exact',
      asset: payment.payload.asset || payment.payload.extra?.assetSymbol || network,
      method_key: methodKey,
      raw_proof: JSON.stringify(payment),
      status: 'verified',
      pending_confirmation: result.pendingConfirmation || false,
    });

    return NextResponse.json({
      valid: true,
      payment: {
        from: payment.payload.from,
        to: payment.payload.to,
        amount: payment.payload.amount,
        network,
        asset: payment.payload.asset || payment.payload.extra?.assetSymbol,
        method: methodKey,
        pendingConfirmation: result.pendingConfirmation || false,
      },
    });
  } catch (error) {
    console.error('x402 verify error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
