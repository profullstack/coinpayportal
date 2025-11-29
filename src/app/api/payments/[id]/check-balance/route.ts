import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// RPC endpoints for different blockchains
const RPC_ENDPOINTS: Record<string, string> = {
  BTC: process.env.BITCOIN_RPC_URL || 'https://blockstream.info/api',
  BCH: process.env.BCH_RPC_URL || 'https://rest.cryptoapis.io/blockchain-data/bitcoin-cash/mainnet',
  ETH: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  MATIC: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
  SOL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
};

// API keys
const CRYPTO_APIS_KEY = process.env.CRYPTO_APIS_KEY || '';

/**
 * Check balance for a Bitcoin address using Blockstream API
 */
async function checkBitcoinBalance(address: string): Promise<number> {
  try {
    console.log(`Checking BTC balance for ${address}`);
    const response = await fetch(`https://blockstream.info/api/address/${address}`);
    if (!response.ok) {
      console.error(`Failed to fetch BTC balance for ${address}: ${response.status}`);
      return 0;
    }
    
    const data = await response.json();
    // Balance is in satoshis, convert to BTC
    const balanceSatoshis = (data.chain_stats?.funded_txo_sum || 0) - (data.chain_stats?.spent_txo_sum || 0);
    const balanceBTC = balanceSatoshis / 100_000_000;
    console.log(`BTC balance for ${address}: ${balanceSatoshis} satoshis = ${balanceBTC} BTC`);
    return balanceBTC;
  } catch (error) {
    console.error(`Error checking BTC balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check balance for a Bitcoin Cash address using Crypto APIs
 */
async function checkBCHBalance(address: string): Promise<number> {
  try {
    if (!CRYPTO_APIS_KEY) {
      console.error('CRYPTO_APIS_KEY not configured for BCH balance check');
      return 0;
    }
    
    console.log(`Checking BCH balance for ${address}`);
    const url = `https://rest.cryptoapis.io/blockchain-data/bitcoin-cash/mainnet/addresses/${address}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': CRYPTO_APIS_KEY,
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to fetch BCH balance for ${address}: ${response.status} - ${errorText}`);
      return 0;
    }
    
    const data = await response.json();
    const confirmedBalance = parseFloat(data.data?.item?.confirmedBalance?.amount || '0');
    console.log(`BCH balance for ${address}: ${confirmedBalance} BCH`);
    return confirmedBalance;
  } catch (error) {
    console.error(`Error checking BCH balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check balance for an Ethereum/Polygon address using JSON-RPC
 */
async function checkEVMBalance(address: string, rpcUrl: string): Promise<number> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
        id: 1,
      }),
    });
    
    if (!response.ok) {
      console.error(`Failed to fetch EVM balance for ${address}: ${response.status}`);
      return 0;
    }
    
    const data = await response.json();
    if (data.error) {
      console.error(`RPC error for ${address}:`, data.error);
      return 0;
    }
    
    // Balance is in wei, convert to ETH
    const balanceWei = BigInt(data.result || '0x0');
    return Number(balanceWei) / 1e18;
  } catch (error) {
    console.error(`Error checking EVM balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check balance for a Solana address
 */
async function checkSolanaBalance(address: string, rpcUrl: string): Promise<number> {
  try {
    console.log(`Checking Solana balance for ${address} using ${rpcUrl}`);
    
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'getBalance',
        params: [address],
        id: 1,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to fetch Solana balance for ${address}: ${response.status} - ${errorText}`);
      return 0;
    }
    
    const data = await response.json();
    console.log(`Solana RPC response for ${address}:`, JSON.stringify(data));
    
    if (data.error) {
      console.error(`RPC error for ${address}:`, data.error);
      return 0;
    }
    
    // Balance is in lamports, convert to SOL
    const balanceLamports = data.result?.value || 0;
    const balanceSOL = balanceLamports / 1e9;
    console.log(`Solana balance for ${address}: ${balanceLamports} lamports = ${balanceSOL} SOL`);
    return balanceSOL;
  } catch (error) {
    console.error(`Error checking Solana balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check balance for any supported blockchain
 */
async function checkBalance(address: string, blockchain: string): Promise<number> {
  console.log(`Checking balance for ${blockchain} address: ${address}`);
  
  switch (blockchain) {
    case 'BTC':
      return checkBitcoinBalance(address);
    case 'BCH':
      return checkBCHBalance(address);
    case 'ETH':
    case 'USDC_ETH':
      return checkEVMBalance(address, RPC_ENDPOINTS.ETH);
    case 'MATIC':
    case 'USDC_MATIC':
      return checkEVMBalance(address, RPC_ENDPOINTS.MATIC);
    case 'SOL':
    case 'USDC_SOL':
      return checkSolanaBalance(address, RPC_ENDPOINTS.SOL);
    default:
      console.error(`Unsupported blockchain: ${blockchain}`);
      return 0;
  }
}

/**
 * POST /api/payments/[id]/check-balance
 * Check blockchain balance and update payment status if funds detected
 * 
 * This endpoint is called by the frontend during polling to actively check
 * for incoming payments, providing faster detection than the scheduled Edge Function.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: paymentId } = await params;
    
    // Create Supabase client with service role for admin access
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get the payment
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .single();
    
    if (paymentError || !payment) {
      return NextResponse.json(
        { success: false, error: 'Payment not found' },
        { status: 404 }
      );
    }
    
    // Only check pending payments
    if (payment.status !== 'pending') {
      return NextResponse.json({
        success: true,
        status: payment.status,
        message: `Payment is already ${payment.status}`,
      });
    }
    
    // Check if payment has expired
    if (payment.expires_at && new Date(payment.expires_at) < new Date()) {
      // Mark as expired
      await supabase
        .from('payments')
        .update({
          status: 'expired',
          updated_at: new Date().toISOString(),
        })
        .eq('id', paymentId);
      
      return NextResponse.json({
        success: true,
        status: 'expired',
        message: 'Payment has expired',
      });
    }
    
    // Check if we have a payment address
    if (!payment.payment_address) {
      return NextResponse.json({
        success: false,
        error: 'Payment has no address to check',
      });
    }
    
    // Check blockchain balance
    const balance = await checkBalance(payment.payment_address, payment.blockchain);
    console.log(`Payment ${paymentId}: blockchain=${payment.blockchain}, address=${payment.payment_address}, balance=${balance}, expected=${payment.crypto_amount}`);
    
    // Check if sufficient funds received (allow 1% tolerance for network fees)
    const expectedAmount = parseFloat(payment.crypto_amount);
    const tolerance = expectedAmount * 0.01;
    
    if (balance >= expectedAmount - tolerance) {
      const now = new Date().toISOString();
      
      // Mark as confirmed
      await supabase
        .from('payments')
        .update({
          status: 'confirmed',
          updated_at: now,
        })
        .eq('id', paymentId);
      
      console.log(`Payment ${paymentId} confirmed with balance ${balance}`);
      
      // Trigger forwarding
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
      const internalApiKey = process.env.INTERNAL_API_KEY;
      
      if (internalApiKey) {
        try {
          const forwardResponse = await fetch(`${appUrl}/api/payments/${paymentId}/forward`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${internalApiKey}`,
            },
          });
          
          if (!forwardResponse.ok) {
            const errorText = await forwardResponse.text();
            console.error(`Failed to trigger forwarding for ${paymentId}: ${forwardResponse.status} - ${errorText}`);
          } else {
            console.log(`Forwarding triggered for payment ${paymentId}`);
          }
        } catch (forwardError) {
          console.error(`Error triggering forwarding for ${paymentId}:`, forwardError);
        }
      } else {
        console.warn('INTERNAL_API_KEY not set, skipping automatic forwarding');
      }
      
      return NextResponse.json({
        success: true,
        status: 'confirmed',
        balance,
        message: 'Payment confirmed! Funds detected.',
      });
    }
    
    return NextResponse.json({
      success: true,
      status: 'pending',
      balance,
      expected: expectedAmount,
      message: balance > 0 
        ? `Partial payment detected: ${balance} / ${expectedAmount}` 
        : 'Waiting for payment...',
    });
  } catch (error) {
    console.error('Check balance error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check balance',
      },
      { status: 500 }
    );
  }
}