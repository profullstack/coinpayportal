/**
 * Supabase Edge Function: Payment Monitor
 *
 * This function runs on a schedule (every minute via pg_cron) to:
 * 1. Check pending payments for incoming blockchain transactions
 * 2. Mark payments as confirmed when funds are detected
 * 3. Mark payments as expired/cancelled after 15 minutes
 * 4. Trigger forwarding for confirmed payments
 *
 * PAYMENT LIFECYCLE:
 * - pending (0-15 min): Waiting for customer payment
 * - confirmed: Payment detected, waiting for forwarding
 * - forwarding: Funds being split and sent
 * - forwarded: Complete - funds sent to merchant + platform
 * - expired: No payment received within 15 minutes
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// RPC endpoints for different blockchains
const RPC_ENDPOINTS: Record<string, string> = {
  BTC: Deno.env.get('BITCOIN_RPC_URL') || 'https://blockstream.info/api',
  BCH: Deno.env.get('BCH_RPC_URL') || 'https://rest.cryptoapis.io/blockchain-data/bitcoin-cash/mainnet',
  ETH: Deno.env.get('ETHEREUM_RPC_URL') || 'https://eth.llamarpc.com',
  POL: Deno.env.get('POLYGON_RPC_URL') || 'https://polygon-rpc.com',
  SOL: Deno.env.get('SOLANA_RPC_URL') || Deno.env.get('NEXT_PUBLIC_SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com',
};

const EVM_TOKENS = {
  USDC_ETH: { contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  USDC_POL: { contractAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
} as const;

const ERC20_BALANCE_OF_SELECTOR = '0x70a08231';

// API keys
const CRYPTO_APIS_KEY = Deno.env.get('CRYPTO_APIS_KEY') || '';

// Payment expiration time in minutes
const PAYMENT_EXPIRATION_MINUTES = 15;

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

interface PaymentAddress {
  id: string;
  payment_id: string;
  address: string;
  cryptocurrency: string;
  encrypted_private_key: string;
  merchant_wallet: string;
  commission_wallet: string;
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function deriveWebhookKey(masterKey: string, merchantId: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(masterKey),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(merchantId),
      iterations: 100000,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

async function resolveWebhookSecret(
  storedSecret: string,
  merchantId?: string | null
): Promise<string> {
  if (!storedSecret.includes(':')) return storedSecret;

  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey || !merchantId) return storedSecret;

  try {
    const [ivBase64, authTagBase64, encryptedBase64] = storedSecret.split(':');
    if (!ivBase64 || !authTagBase64 || !encryptedBase64) return storedSecret;

    const key = await deriveWebhookKey(encryptionKey, merchantId);
    const encrypted = base64ToBytes(encryptedBase64);
    const authTag = base64ToBytes(authTagBase64);
    const encryptedWithTag = new Uint8Array(encrypted.length + authTag.length);
    encryptedWithTag.set(encrypted);
    encryptedWithTag.set(authTag, encrypted.length);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(ivBase64), tagLength: 128 },
      key,
      encryptedWithTag
    );

    return new TextDecoder().decode(plaintext);
  } catch (error) {
    console.warn('Failed to decrypt webhook_secret, falling back to stored value:', error);
    return storedSecret;
  }
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
    // Balance is in satoshis, convert to BTC
    const balanceSatoshis = (data.chain_stats?.funded_txo_sum || 0) - (data.chain_stats?.spent_txo_sum || 0);
    return balanceSatoshis / 100_000_000;
  } catch (error) {
    console.error(`Error checking BTC balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check balance for a Bitcoin Cash address using Crypto APIs
 * API docs: https://developers.cryptoapis.io/technical-documentation/blockchain-data/unified-endpoints/get-address-details
 */
async function checkBCHBalance(address: string): Promise<number> {
  try {
    if (!CRYPTO_APIS_KEY) {
      console.error('CRYPTO_APIS_KEY not configured for BCH balance check');
      return 0;
    }
    
    // Crypto APIs endpoint for BCH address details
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
    
    // Crypto APIs returns balance in the data.item.confirmedBalance field
    // The balance is already in BCH (not satoshis)
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
    
    // Balance is in wei, convert to ETH
    const balanceWei = BigInt(data.result || '0x0');
    return Number(balanceWei) / 1e18;
  } catch (error) {
    console.error(`Error checking EVM balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check ERC-20 token balance for an EVM address using eth_call balanceOf(address)
 */
async function checkEVMTokenBalance(
  address: string,
  rpcUrl: string,
  contractAddress: string,
  decimals = 6
): Promise<number> {
  try {
    const paddedAddress = address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const callData = `${ERC20_BALANCE_OF_SELECTOR}${paddedAddress}`;

    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: contractAddress, data: callData }, 'latest'],
        id: 1,
      }),
    });
    
    if (!response.ok) {
      console.error(`Failed to fetch EVM token balance for ${address}: ${response.status}`);
      return 0;
    }

    const data = await response.json();
    if (data.error) {
      console.error(`RPC error for token balance ${address}:`, data.error);
      return 0;
    }

    const balanceRaw = BigInt(data.result || '0x0');
    return Number(balanceRaw) / 10 ** decimals;
  } catch (error) {
    console.error(`Error checking EVM token balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Check balance for a Solana address
 */
async function checkSolanaBalance(address: string, rpcUrl: string): Promise<number> {
  try {
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
      console.error(`Failed to fetch Solana balance for ${address}: ${response.status}`);
      return 0;
    }
    
    const data = await response.json();
    if (data.error) {
      console.error(`RPC error for ${address}:`, data.error);
      return 0;
    }
    
    // Balance is in lamports, convert to SOL
    const balanceLamports = data.result?.value || 0;
    return balanceLamports / 1e9;
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
      return checkEVMBalance(address, RPC_ENDPOINTS.ETH);
    case 'USDC_ETH':
      return checkEVMTokenBalance(address, RPC_ENDPOINTS.ETH, EVM_TOKENS.USDC_ETH.contractAddress, EVM_TOKENS.USDC_ETH.decimals);
    case 'POL':
      return checkEVMBalance(address, RPC_ENDPOINTS.POL);
    case 'USDC_POL':
      return checkEVMTokenBalance(address, RPC_ENDPOINTS.POL, EVM_TOKENS.USDC_POL.contractAddress, EVM_TOKENS.USDC_POL.decimals);
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
 * Uses SDK-compliant payload format: { id, type, data, created_at, business_id }
 * Signature format: t=timestamp,v1=signature (matching SDK expectations)
 */
async function sendWebhook(
  supabase: ReturnType<typeof createClient>,
  payment: Payment,
  event: string,
  additionalData?: Record<string, unknown>
): Promise<void> {
  try {
    // Get business webhook URL
    const { data: business } = await supabase
      .from('businesses')
      .select('webhook_url, webhook_secret, merchant_id')
      .eq('id', payment.business_id)
      .single();
    
    if (!business?.webhook_url) {
      console.log(`No webhook URL configured for business ${payment.business_id}`);
      return;
    }
    
    const now = new Date();
    const timestamp = Math.floor(now.getTime() / 1000);
    
    // SDK-compliant payload format (matches WebhookPayload interface)
    const payload = {
      id: `evt_${payment.id}_${timestamp}`,
      type: event,
      data: {
        payment_id: payment.id,
        status: payment.status,
        blockchain: payment.blockchain,
        amount_crypto: String(payment.crypto_amount),
        payment_address: payment.payment_address,
        ...additionalData,
      },
      created_at: now.toISOString(),
      business_id: payment.business_id,
    };
    
    const payloadString = JSON.stringify(payload);
    
    // Create HMAC signature in SDK format: t=timestamp,v1=signature
    let signature = '';
    if (business.webhook_secret) {
      const plaintextSecret = await resolveWebhookSecret(
        business.webhook_secret,
        business.merchant_id
      );
      const encoder = new TextEncoder();
      const signedPayload = `${timestamp}.${payloadString}`;
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(plaintextSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signatureBuffer = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(signedPayload)
      );
      const signatureHex = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      signature = `t=${timestamp},v1=${signatureHex}`;
    }
    
    // Send webhook
    const response = await fetch(business.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CoinPay-Signature': signature,
        'User-Agent': 'CoinPay-Webhook/1.0',
      },
      body: payloadString,
    });
    
    // Log webhook delivery
    await supabase.from('webhook_logs').insert({
      business_id: payment.business_id,
      payment_id: payment.id,
      event,
      webhook_url: business.webhook_url,
      success: response.ok,
      status_code: response.status,
      error_message: response.ok ? null : `HTTP ${response.status}`,
      attempt_number: 1,
      response_time_ms: 0,
      created_at: now.toISOString(),
    });
    
    console.log(`Webhook sent for payment ${payment.id}: ${event} -> ${response.status}`);
  } catch (error) {
    console.error(`Failed to send webhook for payment ${payment.id}:`, error);
  }
}

/**
 * Main handler for the edge function
 */
Deno.serve(async (req) => {
  try {
    // Verify request is from Supabase (cron job) or has valid auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const now = new Date();
    const stats = {
      checked: 0,
      confirmed: 0,
      expired: 0,
      errors: 0,
    };
    
    // 1. Get all pending payments
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
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    console.log(`Processing ${pendingPayments?.length || 0} pending payments`);
    
    // 2. Process each pending payment
    for (const payment of pendingPayments || []) {
      stats.checked++;
      
      try {
        // Check if payment has expired (15 minutes)
        const expiresAt = new Date(payment.expires_at);
        if (now > expiresAt) {
          // Mark as expired/cancelled
          await supabase
            .from('payments')
            .update({
              status: 'expired',
              updated_at: now.toISOString(),
            })
            .eq('id', payment.id);
          
          // Send webhook notification
          await sendWebhook(supabase, { ...payment, status: 'expired' }, 'payment.expired', {
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
          await sendWebhook(supabase, { ...payment, status: 'confirmed' }, 'payment.confirmed', {
            received_amount: balance,
            confirmed_at: now.toISOString(),
          });
          
          stats.confirmed++;
          console.log(`Payment ${payment.id} confirmed with balance ${balance}`);
          
          // Trigger forwarding via the forward-payment function
          const appUrl = Deno.env.get('APP_URL') || 'http://localhost:3000';
          const internalApiKey = Deno.env.get('INTERNAL_API_KEY');
          
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
                console.error(`Failed to trigger forwarding for ${payment.id}: ${forwardResponse.status}`);
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
    
    // 3. Return processing stats
    const response = {
      success: true,
      timestamp: now.toISOString(),
      stats,
    };
    
    console.log('Monitor complete:', response);
    
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Monitor error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
