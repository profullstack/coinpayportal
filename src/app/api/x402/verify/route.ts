/**
 * POST /api/x402/verify — Verify an x402 payment proof
 * 
 * CoinPayPortal acts as an x402 facilitator, validating payment
 * signatures on behalf of merchants.
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

/** USDC contract addresses by network */
const USDC_CONTRACTS: Record<string, string> = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
};

/** EIP-712 domain for x402 payment signatures */
function getEIP712Domain(network: string, chainId: number) {
  return {
    name: 'x402',
    version: '1',
    chainId,
    verifyingContract: USDC_CONTRACTS[network],
  };
}

const CHAIN_IDS: Record<string, number> = {
  base: 8453,
  ethereum: 1,
  polygon: 137,
};

const PAYMENT_TYPES = {
  Payment: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' },
  ],
};

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

    if (!payment || !payment.signature || !payment.payload) {
      return NextResponse.json(
        { error: 'Invalid payment proof: missing signature or payload' },
        { status: 400 }
      );
    }

    const { signature, payload } = payment;
    const { from, to, amount, nonce, expiresAt, network } = payload;

    // Validate required fields
    if (!from || !to || !amount || !nonce || !network) {
      return NextResponse.json(
        { error: 'Missing required payment fields' },
        { status: 400 }
      );
    }

    // Check network support
    const chainId = CHAIN_IDS[network];
    if (!chainId) {
      // Solana verification would use a different path
      if (network === 'solana') {
        // TODO: Implement Solana signature verification (ed25519)
        return NextResponse.json(
          { error: 'Solana x402 verification coming soon' },
          { status: 501 }
        );
      }
      return NextResponse.json(
        { error: `Unsupported network: ${network}` },
        { status: 400 }
      );
    }

    // Check expiry
    const expiresAtDate = new Date(expiresAt * 1000);
    if (expiresAtDate < new Date()) {
      return NextResponse.json(
        { error: 'Payment proof has expired' },
        { status: 400 }
      );
    }

    // Verify EIP-712 signature
    const domain = getEIP712Domain(network, chainId);
    const recoveredAddress = ethers.verifyTypedData(
      domain,
      PAYMENT_TYPES,
      { from, to, amount, nonce, expiresAt },
      signature
    );

    if (recoveredAddress.toLowerCase() !== from.toLowerCase()) {
      return NextResponse.json(
        { error: 'Invalid payment signature' },
        { status: 400 }
      );
    }

    // Check for replay (nonce already used)
    const { data: existingPayment } = await supabase
      .from('x402_payments')
      .select('id')
      .eq('nonce', nonce)
      .eq('network', network)
      .eq('from_address', from.toLowerCase())
      .single();

    if (existingPayment) {
      return NextResponse.json(
        { error: 'Payment nonce already used (replay detected)' },
        { status: 400 }
      );
    }

    // Record the verified payment
    await supabase.from('x402_payments').insert({
      business_id: keyData.business_id,
      from_address: from.toLowerCase(),
      to_address: to.toLowerCase(),
      amount,
      nonce,
      network,
      signature,
      expires_at: expiresAtDate.toISOString(),
      status: 'verified',
    });

    return NextResponse.json({
      valid: true,
      payment: {
        from,
        to,
        amount,
        network,
        nonce,
        expiresAt,
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
