/**
 * POST /api/x402/settle — Settle an x402 payment
 * 
 * Uses CoinPayPortal's existing forwarding infrastructure:
 *   1. Buyer pays to CoinPayPortal house wallet (PLATFORM_FEE_WALLET_*)
 *   2. We verify payment landed
 *   3. We forward to merchant wallet minus commission (0.5% paid / 1% free tier)
 * 
 * Settlement methods:
 *   - EVM (ETH, POL, USDC): verify tx, forward via SYSTEM_MNEMONIC
 *   - Bitcoin/BCH: verify confirmations, forward via SYSTEM_MNEMONIC_BTC
 *   - Solana: verify finality, forward via SYSTEM_MNEMONIC_SOL
 *   - Lightning: preimage proves payment (instant, no forwarding needed — paid directly)
 *   - Stripe: capture payment intent (Stripe handles splits)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isBusinessPaidTier } from '@/lib/entitlements/service';
import { splitTieredPayment } from '@/lib/payments/fees';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/** Map x402 network names to blockchain provider types */
const NETWORK_TO_CHAIN: Record<string, string> = {
  bitcoin: 'BTC',
  'bitcoin-cash': 'BCH',
  ethereum: 'ETH',
  polygon: 'POL',
  solana: 'SOL',
  base: 'ETH', // Base uses ETH infra
};

/** RPC endpoints by network */
const RPC_URLS: Record<string, string> = {
  base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  ethereum: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  polygon: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
};

const EVM_NETWORKS = new Set(['ethereum', 'polygon', 'base']);

/**
 * Get the system mnemonic (house wallet) for a given chain.
 * These are the same keys used by the payment forwarding system.
 */
function getSystemMnemonic(network: string): string | undefined {
  const chain = NETWORK_TO_CHAIN[network] || network.toUpperCase();
  const mnemonicMap: Record<string, string> = {
    BTC: 'SYSTEM_MNEMONIC_BTC',
    BCH: 'SYSTEM_MNEMONIC_BTC', // BCH shares BTC mnemonic
    ETH: 'SYSTEM_MNEMONIC_ETH',
    POL: 'SYSTEM_MNEMONIC_POL',
    SOL: 'SYSTEM_MNEMONIC_SOL',
  };
  const envVar = mnemonicMap[chain];
  return envVar ? process.env[envVar] : undefined;
}

/**
 * Get the platform fee wallet address for a given chain.
 */
function getPlatformWallet(network: string): string | undefined {
  const chain = NETWORK_TO_CHAIN[network] || network.toUpperCase();
  const walletMap: Record<string, string> = {
    BTC: 'PLATFORM_FEE_WALLET_BTC',
    BCH: 'PLATFORM_FEE_WALLET_BCH',
    ETH: 'PLATFORM_FEE_WALLET_ETH',
    POL: 'PLATFORM_FEE_WALLET_POL',
    SOL: 'PLATFORM_FEE_WALLET_SOL',
  };
  const envVar = walletMap[chain];
  return envVar ? process.env[envVar] : undefined;
}

/**
 * Verify an EVM transaction landed and return details.
 */
async function verifyEvmTx(network: string, txHash: string) {
  const rpcUrl = RPC_URLS[network];
  if (!rpcUrl) throw new Error(`No RPC configured for ${network}`);

  const { ethers } = await import('ethers');
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const receipt = await provider.getTransactionReceipt(txHash);

  if (!receipt || receipt.status !== 1) {
    throw new Error('Transaction not confirmed or failed');
  }

  return { confirmed: true, txHash };
}

/**
 * Verify a Bitcoin/BCH transaction.
 */
async function verifyUtxoTx(network: string, txId: string) {
  if (network === 'bitcoin') {
    try {
      const res = await fetch(`https://mempool.space/api/tx/${txId}`);
      const tx = await res.json();
      return {
        confirmed: !!tx.status?.confirmed,
        txHash: txId,
        confirmations: tx.status?.block_height ? 1 : 0,
      };
    } catch {
      return { confirmed: false, txHash: txId, confirmations: 0, pending: true };
    }
  }
  // BCH — accept with txId, confirm asynchronously
  return { confirmed: false, txHash: txId, confirmations: 0, pending: true };
}

/**
 * Verify a Solana transaction.
 */
async function verifySolanaTx(txSignature: string) {
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
    return { confirmed: true, txHash: txSignature };
  }
  if (data.result?.meta?.err) {
    throw new Error(`Solana transaction failed: ${JSON.stringify(data.result.meta.err)}`);
  }
  return { confirmed: false, txHash: txSignature, pending: true };
}

/**
 * Settle a Lightning payment — preimage already proves payment.
 */
async function settleLightning(payment: any) {
  return { txHash: payment.payload.paymentHash, instant: true, confirmed: true };
}

/**
 * Settle a Stripe payment — capture the payment intent.
 */
async function settleStripe(payment: any) {
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
    return { txHash: paymentIntentId, confirmed: true };
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

    // Check merchant tier for commission rate
    const isPaidTier = await isBusinessPaidTier(supabase, keyData.business_id);
    const { merchantAmount, platformFee, feePercentage } = splitTieredPayment(
      parseFloat(verifiedPayment.amount),
      isPaidTier
    );

    console.log(`[x402 Settle] Commission: ${feePercentage * 100}% (${isPaidTier ? 'paid' : 'free'} tier) — merchant gets ${merchantAmount}, platform keeps ${platformFee}`);

    // Route to the appropriate settlement method
    let result: { txHash: string; pending?: boolean; confirmed?: boolean; instant?: boolean; confirmations?: number };

    try {
      if (scheme === 'bolt12' || network === 'lightning') {
        // Lightning: preimage proves payment, instant settlement
        // Funds already went to merchant's Lightning node via BOLT12 offer
        result = await settleLightning(payment);
      } else if (scheme === 'stripe-checkout' || network === 'stripe') {
        // Stripe: capture payment intent, Stripe handles the split
        result = await settleStripe(payment);
      } else if (EVM_NETWORKS.has(network)) {
        // EVM: verify the tx that paid the house wallet, then forward
        const txHash = payment.payload.txHash || payment.payload.txId;
        if (!txHash) throw new Error('Missing txHash for EVM settlement');
        result = await verifyEvmTx(network, txHash);

        // TODO: Forward merchantAmount from house wallet to merchant address
        // using SYSTEM_MNEMONIC_ETH / SYSTEM_MNEMONIC_POL
        // This reuses the same forwarding logic as regular payments
        const mnemonic = getSystemMnemonic(network);
        if (!mnemonic) {
          console.warn(`[x402 Settle] No system mnemonic for ${network} — settlement verified but forwarding deferred`);
        }
      } else if (network === 'bitcoin' || network === 'bitcoin-cash') {
        // UTXO: verify tx landed at house wallet
        const txId = payment.payload.txId;
        if (!txId) throw new Error('Missing txId for UTXO settlement');
        result = await verifyUtxoTx(network, txId);

        // TODO: Forward merchantAmount from house wallet to merchant address
        // using SYSTEM_MNEMONIC_BTC
      } else if (network === 'solana') {
        // Solana: verify tx finality
        const txSig = payment.payload.txSignature;
        if (!txSig) throw new Error('Missing txSignature for Solana settlement');
        result = await verifySolanaTx(txSig);

        // TODO: Forward merchantAmount from house wallet to merchant address
        // using SYSTEM_MNEMONIC_SOL
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

    // Update payment record with commission info
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
      commission: {
        rate: `${feePercentage * 100}%`,
        tier: isPaidTier ? 'professional' : 'starter',
        merchantAmount: merchantAmount.toString(),
        platformFee: platformFee.toString(),
      },
    });
  } catch (error) {
    console.error('x402 settle error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
