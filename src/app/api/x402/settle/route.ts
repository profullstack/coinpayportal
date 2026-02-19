/**
 * POST /api/x402/settle — Settle an x402 payment on-chain
 * 
 * Claims the USDC payment and transfers it to the merchant's wallet.
 * CoinPayPortal acts as the x402 facilitator for settlement.
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

/** USDC contract addresses */
const USDC_CONTRACTS: Record<string, string> = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
};

/** Minimal ERC-20 transferFrom ABI */
const ERC20_ABI = [
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

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
        { error: 'Invalid payment data' },
        { status: 400 }
      );
    }

    const { from, to, amount, nonce, network } = payment.payload;

    // Verify this payment was previously verified
    const { data: verifiedPayment, error: vpError } = await supabase
      .from('x402_payments')
      .select('*')
      .eq('nonce', nonce)
      .eq('network', network)
      .eq('from_address', from.toLowerCase())
      .single();

    if (vpError || !verifiedPayment) {
      return NextResponse.json(
        { error: 'Payment not found or not verified. Call /api/x402/verify first.' },
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

    // Solana settlement not yet implemented
    if (network === 'solana') {
      return NextResponse.json(
        { error: 'Solana x402 settlement coming soon' },
        { status: 501 }
      );
    }

    const rpcUrl = RPC_URLS[network];
    if (!rpcUrl) {
      return NextResponse.json(
        { error: `No RPC configured for network: ${network}` },
        { status: 400 }
      );
    }

    // Settlement: execute the USDC transferFrom on-chain
    // The facilitator's private key is used to submit the transaction
    const facilitatorKey = process.env.X402_FACILITATOR_PRIVATE_KEY;
    if (!facilitatorKey) {
      // Update status to indicate settlement is pending manual processing
      await supabase
        .from('x402_payments')
        .update({ status: 'pending_settlement' })
        .eq('id', verifiedPayment.id);

      return NextResponse.json({
        settled: false,
        status: 'pending_settlement',
        message: 'Settlement queued — facilitator key not configured for automatic settlement',
      });
    }

    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const wallet = new ethers.Wallet(facilitatorKey, provider);
      const usdc = new ethers.Contract(USDC_CONTRACTS[network], ERC20_ABI, wallet);

      // Check allowance
      const allowance = await usdc.allowance(from, wallet.address);
      if (BigInt(allowance) < BigInt(amount)) {
        await supabase
          .from('x402_payments')
          .update({ status: 'insufficient_allowance' })
          .eq('id', verifiedPayment.id);

        return NextResponse.json(
          { error: 'Insufficient USDC allowance for settlement' },
          { status: 400 }
        );
      }

      // Execute transferFrom
      const tx = await usdc.transferFrom(from, to, amount);
      const receipt = await tx.wait();

      // Update payment record
      await supabase
        .from('x402_payments')
        .update({
          status: 'settled',
          tx_hash: receipt.hash,
          settled_at: new Date().toISOString(),
        })
        .eq('id', verifiedPayment.id);

      return NextResponse.json({
        settled: true,
        txHash: receipt.hash,
        network,
        from,
        to,
        amount,
      });
    } catch (txError: any) {
      await supabase
        .from('x402_payments')
        .update({ status: 'settlement_failed', error: txError.message })
        .eq('id', verifiedPayment.id);

      return NextResponse.json(
        { error: 'On-chain settlement failed', details: txError.message },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('x402 settle error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
