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
const CRON_SECRET = process.env.CRON_SECRET || process.env.INTERNAL_API_KEY;

interface Payment {
  id: string;
  business_id: string;
  blockchain: string;
  crypto_amount: number;
  status: string;
  payment_address: string;
  created_at: string;
  expires_at: string;
  merchant_wallet_address: string;
}

/**
 * Check balance for a Bitcoin address using Blockstream API
 */
async function checkBitcoinBalance(address: string): Promise<number> {
  try {
    const response = await fetch(`https://blockstream.info/api/address/${address}`);
    if (!response.ok) {
      console.error(`Failed to fetch BTC balance for ${address}: ${response.status}`);
      return 0;
    }
    
    const data = await response.json();
    const balanceSatoshis = (data.chain_stats?.funded_txo_sum || 0) - (data.chain_stats?.spent_txo_sum || 0);
    return balanceSatoshis / 100_000_000;
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
 * Send webhook notification for payment status change
 */
async function sendWebhook(
  supabase: any,
  payment: Payment,
  event: string,
  additionalData?: Record<string, unknown>
): Promise<void> {
  try {
    const { data: business } = await supabase
      .from('businesses')
      .select('webhook_url, webhook_secret')
      .eq('id', payment.business_id)
      .single();
    
    if (!business?.webhook_url) {
      console.log(`No webhook URL configured for business ${payment.business_id}`);
      return;
    }
    
    const payload = {
      event,
      payment_id: payment.id,
      status: payment.status,
      blockchain: payment.blockchain,
      amount: payment.crypto_amount,
      payment_address: payment.payment_address,
      timestamp: new Date().toISOString(),
      ...additionalData,
    };
    
    // Create HMAC signature if webhook secret exists
    let signature = '';
    if (business.webhook_secret) {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(business.webhook_secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signatureBuffer = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(JSON.stringify(payload))
      );
      signature = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
    
    const response = await fetch(business.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CoinPay-Signature': signature,
        'X-CoinPay-Event': event,
      },
      body: JSON.stringify(payload),
    });
    
    // Log webhook delivery
    await supabase.from('webhook_logs').insert({
      business_id: payment.business_id,
      payment_id: payment.id,
      url: business.webhook_url,
      payload,
      response_status: response.status,
      response_body: await response.text().catch(() => ''),
      attempt: 1,
    });
    
    console.log(`Webhook sent for payment ${payment.id}: ${event} -> ${response.status}`);
  } catch (error) {
    console.error(`Failed to send webhook for payment ${payment.id}:`, error);
  }
}

/**
 * GET /api/cron/monitor-payments
 * Background job to monitor pending payments and check blockchain balances
 * 
 * This endpoint should be called by an external cron service every 15 seconds.
 * Configure in:
 * - Vercel: vercel.json with cron configuration
 * - Railway: railway.toml with cron
 * - External: cron-job.org or similar
 * 
 * Authentication: Requires CRON_SECRET or INTERNAL_API_KEY in Authorization header
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret for security
    const authHeader = request.headers.get('authorization');
    const cronSecret = authHeader?.replace('Bearer ', '');
    
    // Allow requests from Vercel Cron (they include a special header)
    const isVercelCron = request.headers.get('x-vercel-cron') === '1';
    
    if (!isVercelCron && cronSecret !== CRON_SECRET) {
      console.warn('Unauthorized cron request');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const now = new Date();
    const stats = {
      checked: 0,
      confirmed: 0,
      expired: 0,
      errors: 0,
    };
    
    // Get all pending payments
    const { data: pendingPayments, error: fetchError } = await supabase
      .from('payments')
      .select(`
        id,
        business_id,
        blockchain,
        crypto_amount,
        status,
        payment_address,
        created_at,
        expires_at,
        merchant_wallet_address
      `)
      .eq('status', 'pending')
      .limit(100);
    
    if (fetchError) {
      console.error('Failed to fetch pending payments:', fetchError);
      return NextResponse.json(
        { error: fetchError.message },
        { status: 500 }
      );
    }
    
    console.log(`Processing ${pendingPayments?.length || 0} pending payments`);
    
    // Process each pending payment
    for (const payment of pendingPayments || []) {
      stats.checked++;
      
      try {
        // Check if payment has expired (15 minutes)
        const expiresAt = new Date(payment.expires_at);
        if (now > expiresAt) {
          // Mark as expired
          await supabase
            .from('payments')
            .update({
              status: 'expired',
              updated_at: now.toISOString(),
            })
            .eq('id', payment.id);
          
          // Send webhook notification
          await sendWebhook(supabase, { ...payment, status: 'expired' } as Payment, 'payment.expired', {
            reason: 'Payment window expired (15 minutes)',
            expired_at: now.toISOString(),
          });
          
          stats.expired++;
          console.log(`Payment ${payment.id} expired`);
          continue;
        }
        
        // Check blockchain balance
        if (!payment.payment_address) {
          console.log(`Payment ${payment.id} has no payment address`);
          continue;
        }
        
        const balance = await checkBalance(payment.payment_address, payment.blockchain);
        console.log(`Payment ${payment.id}: balance=${balance}, expected=${payment.crypto_amount}`);
        
        // Check if sufficient funds received (allow 1% tolerance for network fees)
        const tolerance = payment.crypto_amount * 0.01;
        if (balance >= payment.crypto_amount - tolerance) {
          // Mark as confirmed
          await supabase
            .from('payments')
            .update({
              status: 'confirmed',
              updated_at: now.toISOString(),
            })
            .eq('id', payment.id);
          
          // Send webhook notification
          await sendWebhook(supabase, { ...payment, status: 'confirmed' } as Payment, 'payment.confirmed', {
            received_amount: balance,
            confirmed_at: now.toISOString(),
          });
          
          stats.confirmed++;
          console.log(`Payment ${payment.id} confirmed with balance ${balance}`);
          
          // Trigger forwarding
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
          const internalApiKey = process.env.INTERNAL_API_KEY;
          
          if (internalApiKey) {
            try {
              const forwardResponse = await fetch(`${appUrl}/api/payments/${payment.id}/forward`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${internalApiKey}`,
                },
              });
              
              if (!forwardResponse.ok) {
                const errorText = await forwardResponse.text();
                console.error(`Failed to trigger forwarding for ${payment.id}: ${forwardResponse.status} - ${errorText}`);
              } else {
                console.log(`Forwarding triggered for payment ${payment.id}`);
              }
            } catch (forwardError) {
              console.error(`Error triggering forwarding for ${payment.id}:`, forwardError);
            }
          }
        }
      } catch (paymentError) {
        console.error(`Error processing payment ${payment.id}:`, paymentError);
        stats.errors++;
      }
    }
    
    const response = {
      success: true,
      timestamp: now.toISOString(),
      stats,
    };
    
    console.log('Monitor complete:', response);
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Monitor error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Monitor failed' },
      { status: 500 }
    );
  }
}

// Also support POST for flexibility
export async function POST(request: NextRequest) {
  return GET(request);
}