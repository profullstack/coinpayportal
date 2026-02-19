/**
 * POST /api/x402/settle — Settle an x402 payment
 * 
 * Multi-chain, multi-asset settlement:
 *   - EVM (ETH, POL, USDC): on-chain transferFrom or native transfer
 *   - Bitcoin/Bitcoin Cash: verify tx confirmations
 *   - Solana: verify tx finality
 *   - Lightning: preimage already proves payment (no-op settle)
 *   - Stripe: capture payment intent
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

/** RPC endpoints by network */
const RPC_URLS: Record<string, string> = {
  base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  ethereum: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
  polygon: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
};

/** USDC contract addresses for ERC-20 transferFrom */
const USDC_CONTRACTS: Record<string, string> = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
};

const ERC20_ABI = [
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const EVM_NETWORKS = new Set(['ethereum', 'polygon', 'base']);

/**
 * Settle an EVM payment (native ETH/POL or ERC-20 USDC).
 */
async function settleEvmPayment(payment: any, facilitatorKey: string) {
  const { from, to, amount, network, asset } = payment.payload;
  const rpcUrl = RPC_URLS[network];
  if (!rpcUrl) throw new Error(`No RPC configured for ${network}`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(facilitatorKey, provider);

  // If asset is a contract address (USDC), use transferFrom
  const isToken = asset && asset.startsWith('0x') && asset !== '0x0000000000000000000000000000000000000000';

  if (isToken) {
    const token = new ethers.Contract(asset, ERC20_ABI, wallet);
    const allowance = await token.allowance(from, wallet.address);
    if (BigInt(allowance) < BigInt(amount)) {
      throw new Error('Insufficient token allowance for settlement');
    }
    const tx = await token.transferFrom(from, to, amount);
    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  }

  // Native transfer (ETH/POL) — the signed authorization permits the facilitator
  // to verify the payment was made. For native assets, the sender broadcasts the
  // tx themselves; we just confirm it landed.
  // In practice, native asset x402 works as: sender sends ETH/POL to merchant,
  // then provides the txHash as proof. We verify the tx here.
  const txHash = payment.payload.txHash || payment.payload.txId;
  if (txHash) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) {
      throw new Error('Transaction not confirmed or failed');
    }
    return { txHash };
  }

  throw new Error('No settlement path for native asset without txHash');
}

/**
 * Settle a Bitcoin/Bitcoin Cash payment — verify confirmations.
 */
async function settleUtxoPayment(payment: any) {
  const { txId, network } = payment.payload;
  if (!txId) throw new Error('Missing txId for UTXO settlement');

  // Query a block explorer for confirmation count.
  // Using mempool.space for BTC, or an equivalent for BCH.
  const explorerBase = network === 'bitcoin'
    ? 'https://mempool.space/api'
    : 'https://api.blockchair.com/bitcoin-cash';

  try {
    if (network === 'bitcoin') {
      const res = await fetch(`${explorerBase}/tx/${txId}`);
      const tx = await res.json();
      if (tx.status?.confirmed) {
        return { txHash: txId, confirmations: tx.status.block_height ? 1 : 0 };
      }
      return { txHash: txId, confirmations: 0, pending: true };
    } else {
      // BCH — accept with txId, confirm asynchronously
      return { txHash: txId, confirmations: 0, pending: true };
    }
  } catch {
    // Explorer unreachable — mark as pending
    return { txHash: txId, confirmations: 0, pending: true };
  }
}

/**
 * Settle a Solana payment — verify transaction finality.
 */
async function settleSolanaPayment(payment: any) {
  const { txSignature } = payment.payload;
  if (!txSignature) throw new Error('Missing txSignature for Solana settlement');

  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [txSignature, { encoding: 'json', commitment: 'confirmed' }],
    }),
  });

  const data = await res.json();
  if (data.result && !data.result.meta?.err) {
    return { txHash: txSignature };
  }

  if (data.result?.meta?.err) {
    throw new Error(`Solana transaction failed: ${JSON.stringify(data.result.meta.err)}`);
  }

  return { txHash: txSignature, pending: true };
}

/**
 * Settle a Lightning payment — preimage already proves payment.
 */
async function settleLightningPayment(payment: any) {
  // Lightning payments are instant and final once the preimage is revealed.
  // The verify step already confirmed SHA256(preimage) === paymentHash.
  return { txHash: payment.payload.paymentHash, instant: true };
}

/**
 * Settle a Stripe payment — capture the payment intent.
 */
async function settleStripePayment(payment: any) {
  const { paymentIntentId } = payment.payload;
  if (!paymentIntentId) throw new Error('Missing paymentIntentId');

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) throw new Error('Stripe not configured');

  const res = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeKey}` },
  });

  const pi = await res.json();
  if (pi.status === 'succeeded') {
    return { txHash: paymentIntentId };
  }

  throw new Error(`Stripe capture failed: ${pi.status} — ${pi.last_payment_error?.message || ''}`);
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

    if (!payment?.payload) {
      return NextResponse.json({ error: 'Invalid payment data' }, { status: 400 });
    }

    const { network, scheme } = payment.payload;
    const uniqueKey = payment.payload.nonce || payment.payload.txId || payment.payload.txSignature || payment.payload.preimage;

    // Find the verified payment record
    const query = supabase
      .from('x402_payments')
      .select('*')
      .eq('network', network)
      .eq('business_id', keyData.business_id);

    if (uniqueKey) {
      query.eq('unique_key', uniqueKey);
    }

    const { data: verifiedPayment, error: vpError } = await query.single();

    if (vpError || !verifiedPayment) {
      return NextResponse.json(
        { error: 'Payment not found. Call /api/x402/verify first.' },
        { status: 400 }
      );
    }

    if (verifiedPayment.status === 'settled') {
      return NextResponse.json(
        { error: 'Payment already settled', txHash: verifiedPayment.tx_hash },
        { status: 409 }
      );
    }

    if (verifiedPayment.status !== 'verified') {
      return NextResponse.json(
        { error: `Cannot settle payment in status: ${verifiedPayment.status}` },
        { status: 400 }
      );
    }

    // Route to the appropriate settler
    let result: { txHash: string; pending?: boolean; confirmations?: number; instant?: boolean };
    try {
      if (scheme === 'bolt12' || network === 'lightning') {
        result = await settleLightningPayment(payment);
      } else if (scheme === 'stripe-checkout' || network === 'stripe') {
        result = await settleStripePayment(payment);
      } else if (EVM_NETWORKS.has(network)) {
        const facilitatorKey = process.env.X402_FACILITATOR_PRIVATE_KEY;
        if (!facilitatorKey) {
          await supabase
            .from('x402_payments')
            .update({ status: 'pending_settlement' })
            .eq('id', verifiedPayment.id);

          return NextResponse.json({
            settled: false,
            status: 'pending_settlement',
            message: 'Settlement queued — facilitator key not configured',
          });
        }
        result = await settleEvmPayment(payment, facilitatorKey);
      } else if (network === 'bitcoin' || network === 'bitcoin-cash') {
        result = await settleUtxoPayment(payment);
      } else if (network === 'solana') {
        result = await settleSolanaPayment(payment);
      } else {
        return NextResponse.json(
          { error: `Unsupported network for settlement: ${network}` },
          { status: 400 }
        );
      }
    } catch (txError: any) {
      await supabase
        .from('x402_payments')
        .update({ status: 'settlement_failed', error: txError.message })
        .eq('id', verifiedPayment.id);

      return NextResponse.json(
        { error: 'Settlement failed', details: txError.message },
        { status: 500 }
      );
    }

    // Update payment record
    const finalStatus = result.pending ? 'pending_confirmation' : 'settled';
    await supabase
      .from('x402_payments')
      .update({
        status: finalStatus,
        tx_hash: result.txHash,
        settled_at: result.pending ? null : new Date().toISOString(),
      })
      .eq('id', verifiedPayment.id);

    return NextResponse.json({
      settled: !result.pending,
      status: finalStatus,
      txHash: result.txHash,
      network,
      asset: payment.payload.asset || payment.payload.extra?.assetSymbol,
      method: payment.payload.methodKey || payment.payload.extra?.methodKey,
    });
  } catch (error) {
    console.error('x402 settle error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
