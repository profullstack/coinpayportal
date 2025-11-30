/**
 * Background Payment Monitor
 * 
 * This module provides a self-starting background monitor that checks
 * pending payments for blockchain balances and updates their status.
 * 
 * It runs independently of user sessions, ensuring payments are detected
 * even if users close the payment page after sending funds.
 */

import { createClient } from '@supabase/supabase-js';

// Configuration
const MONITOR_INTERVAL_MS = parseInt(process.env.MONITOR_INTERVAL_MS || '15000', 10); // 15 seconds default
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// RPC endpoints for different blockchains
const RPC_ENDPOINTS: Record<string, string> = {
  BTC: process.env.BITCOIN_RPC_URL || 'https://blockstream.info/api',
  BCH: process.env.BCH_RPC_URL || 'https://rest.cryptoapis.io/blockchain-data/bitcoin-cash/mainnet',
  ETH: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  POL: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
  SOL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
};

const CRYPTO_APIS_KEY = process.env.CRYPTO_APIS_KEY || '';

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

// Track if monitor is running
let isMonitorRunning = false;
let monitorInterval: NodeJS.Timeout | null = null;

interface BalanceResult {
  balance: number;
  txHash?: string;
}

/**
 * Check balance for a Bitcoin address
 */
async function checkBitcoinBalance(address: string): Promise<BalanceResult> {
  try {
    console.log(`[Monitor] Checking BTC balance for ${address}`);
    const response = await fetch(`https://blockstream.info/api/address/${address}`);
    if (!response.ok) {
      console.error(`[Monitor] Failed to fetch BTC balance for ${address}: ${response.status}`);
      return { balance: 0 };
    }
    
    const data = await response.json();
    const balanceSatoshis = (data.chain_stats?.funded_txo_sum || 0) - (data.chain_stats?.spent_txo_sum || 0);
    const balance = balanceSatoshis / 100_000_000;
    console.log(`[Monitor] BTC balance for ${address}: ${balance} BTC`);
    
    // Get the latest transaction hash if there's a balance
    let txHash: string | undefined;
    if (balance > 0) {
      try {
        const txResponse = await fetch(`https://blockstream.info/api/address/${address}/txs`);
        if (txResponse.ok) {
          const txs = await txResponse.json();
          if (txs && txs.length > 0) {
            txHash = txs[0].txid;
            console.log(`[Monitor] BTC tx hash for ${address}: ${txHash}`);
          }
        }
      } catch (txError) {
        console.error(`[Monitor] Error fetching BTC transactions for ${address}:`, txError);
      }
    }
    
    return { balance, txHash };
  } catch (error) {
    console.error(`[Monitor] Error checking BTC balance for ${address}:`, error);
    return { balance: 0 };
  }
}

/**
 * Check balance for a Bitcoin Cash address
 */
async function checkBCHBalance(address: string): Promise<BalanceResult> {
  try {
    if (!CRYPTO_APIS_KEY) {
      console.error('[Monitor] CRYPTO_APIS_KEY not configured for BCH');
      return { balance: 0 };
    }
    
    console.log(`[Monitor] Checking BCH balance for ${address}`);
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
      console.error(`[Monitor] Failed to fetch BCH balance for ${address}: ${response.status} - ${errorText}`);
      return { balance: 0 };
    }
    
    const data = await response.json();
    const balance = parseFloat(data.data?.item?.confirmedBalance?.amount || '0');
    console.log(`[Monitor] BCH balance for ${address}: ${balance} BCH`);
    
    // Get the latest transaction hash if there's a balance
    let txHash: string | undefined;
    if (balance > 0) {
      try {
        const txUrl = `https://rest.cryptoapis.io/blockchain-data/bitcoin-cash/mainnet/addresses/${address}/transactions`;
        const txResponse = await fetch(txUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': CRYPTO_APIS_KEY,
          },
        });
        if (txResponse.ok) {
          const txData = await txResponse.json();
          if (txData.data?.items && txData.data.items.length > 0) {
            txHash = txData.data.items[0].transactionId;
            console.log(`[Monitor] BCH tx hash for ${address}: ${txHash}`);
          }
        }
      } catch (txError) {
        console.error(`[Monitor] Error fetching BCH transactions for ${address}:`, txError);
      }
    }
    
    return { balance, txHash };
  } catch (error) {
    console.error(`[Monitor] Error checking BCH balance for ${address}:`, error);
    return { balance: 0 };
  }
}

/**
 * Check balance for an EVM address (ETH/MATIC)
 */
async function checkEVMBalance(address: string, rpcUrl: string, chain: string): Promise<BalanceResult> {
  try {
    console.log(`[Monitor] Checking ${chain} balance for ${address}`);
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
      console.error(`[Monitor] Failed to fetch ${chain} balance for ${address}: ${response.status}`);
      return { balance: 0 };
    }
    
    const data = await response.json();
    if (data.error) {
      console.error(`[Monitor] RPC error for ${address}:`, data.error);
      return { balance: 0 };
    }
    
    const balanceWei = BigInt(data.result || '0x0');
    const balance = Number(balanceWei) / 1e18;
    console.log(`[Monitor] ${chain} balance for ${address}: ${balance}`);
    
    // For EVM chains, we need to use an explorer API to get tx hash
    // This is a simplified version - in production you'd use Etherscan/Polygonscan API
    let txHash: string | undefined;
    if (balance > 0) {
      // Try to get the latest transaction using eth_getBlockByNumber and filtering
      // For now, we'll leave this as undefined and let the forwarding process set it
      // A proper implementation would use Etherscan/Polygonscan API
      console.log(`[Monitor] ${chain} tx hash lookup not implemented - will be set during forwarding`);
    }
    
    return { balance, txHash };
  } catch (error) {
    console.error(`[Monitor] Error checking ${chain} balance for ${address}:`, error);
    return { balance: 0 };
  }
}

/**
 * Check balance for a Solana address
 */
async function checkSolanaBalance(address: string, rpcUrl: string): Promise<BalanceResult> {
  try {
    console.log(`[Monitor] Checking SOL balance for ${address}`);
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
      console.error(`[Monitor] Failed to fetch SOL balance for ${address}: ${response.status} - ${errorText}`);
      return { balance: 0 };
    }
    
    const data = await response.json();
    if (data.error) {
      console.error(`[Monitor] RPC error for ${address}:`, data.error);
      return { balance: 0 };
    }
    
    const balanceLamports = data.result?.value || 0;
    const balance = balanceLamports / 1e9;
    console.log(`[Monitor] SOL balance for ${address}: ${balance} SOL`);
    
    // Get the latest transaction signature if there's a balance
    let txHash: string | undefined;
    if (balance > 0) {
      try {
        const sigResponse = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'getSignaturesForAddress',
            params: [address, { limit: 1 }],
            id: 1,
          }),
        });
        
        if (sigResponse.ok) {
          const sigData = await sigResponse.json();
          if (sigData.result && sigData.result.length > 0) {
            txHash = sigData.result[0].signature;
            console.log(`[Monitor] SOL tx hash for ${address}: ${txHash}`);
          }
        }
      } catch (txError) {
        console.error(`[Monitor] Error fetching SOL transactions for ${address}:`, txError);
      }
    }
    
    return { balance, txHash };
  } catch (error) {
    console.error(`[Monitor] Error checking SOL balance for ${address}:`, error);
    return { balance: 0 };
  }
}

/**
 * Check balance for any supported blockchain
 */
async function checkBalance(address: string, blockchain: string): Promise<BalanceResult> {
  switch (blockchain) {
    case 'BTC':
      return checkBitcoinBalance(address);
    case 'BCH':
      return checkBCHBalance(address);
    case 'ETH':
    case 'USDC_ETH':
      return checkEVMBalance(address, RPC_ENDPOINTS.ETH, 'ETH');
    case 'POL':
    case 'USDC_POL':
      return checkEVMBalance(address, RPC_ENDPOINTS.POL, 'POL');
    case 'SOL':
    case 'USDC_SOL':
      return checkSolanaBalance(address, RPC_ENDPOINTS.SOL);
    default:
      console.error(`[Monitor] Unsupported blockchain: ${blockchain}`);
      return { balance: 0 };
  }
}

/**
 * Process a single payment - check balance and update status
 */
async function processPayment(supabase: any, payment: Payment): Promise<{ confirmed: boolean; expired: boolean }> {
  const now = new Date();
  
  // Check if payment has expired
  const expiresAt = new Date(payment.expires_at);
  if (now > expiresAt) {
    console.log(`[Monitor] Payment ${payment.id} expired`);
    await supabase
      .from('payments')
      .update({
        status: 'expired',
        updated_at: now.toISOString(),
      })
      .eq('id', payment.id);
    return { confirmed: false, expired: true };
  }
  
  // Check if we have a payment address
  if (!payment.payment_address) {
    console.log(`[Monitor] Payment ${payment.id} has no address`);
    return { confirmed: false, expired: false };
  }
  
  // Check blockchain balance
  const balanceResult = await checkBalance(payment.payment_address, payment.blockchain);
  console.log(`[Monitor] Payment ${payment.id}: balance=${balanceResult.balance}, expected=${payment.crypto_amount}, txHash=${balanceResult.txHash || 'none'}`);
  
  // Check if sufficient funds received (1% tolerance)
  const tolerance = payment.crypto_amount * 0.01;
  if (balanceResult.balance >= payment.crypto_amount - tolerance) {
    console.log(`[Monitor] Payment ${payment.id} CONFIRMED with balance ${balanceResult.balance}`);
    
    // Mark as confirmed and store tx_hash if available
    const updateData: Record<string, any> = {
      status: 'confirmed',
      updated_at: now.toISOString(),
      confirmed_at: now.toISOString(),
    };
    
    if (balanceResult.txHash) {
      updateData.tx_hash = balanceResult.txHash;
    }
    
    await supabase
      .from('payments')
      .update(updateData)
      .eq('id', payment.id);
    
    // Trigger forwarding
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
    const internalApiKey = process.env.INTERNAL_API_KEY;
    
    if (internalApiKey) {
      try {
        console.log(`[Monitor] Triggering forwarding for payment ${payment.id}`);
        const forwardResponse = await fetch(`${appUrl}/api/payments/${payment.id}/forward`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${internalApiKey}`,
          },
        });
        
        if (!forwardResponse.ok) {
          const errorText = await forwardResponse.text();
          console.error(`[Monitor] Failed to trigger forwarding for ${payment.id}: ${forwardResponse.status} - ${errorText}`);
        } else {
          const forwardResult = await forwardResponse.json();
          console.log(`[Monitor] Forwarding completed for payment ${payment.id}:`, JSON.stringify(forwardResult));
        }
      } catch (forwardError) {
        console.error(`[Monitor] Error triggering forwarding for ${payment.id}:`, forwardError);
      }
    } else {
      console.warn(`[Monitor] INTERNAL_API_KEY not configured - cannot trigger forwarding for ${payment.id}`);
    }
    
    return { confirmed: true, expired: false };
  }
  
  return { confirmed: false, expired: false };
}

/**
 * Run one monitoring cycle
 */
async function runMonitorCycle(): Promise<{ checked: number; confirmed: number; expired: number; errors: number }> {
  const stats = { checked: 0, confirmed: 0, expired: 0, errors: 0 };
  
  try {
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[Monitor] Supabase credentials not configured');
      return stats;
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
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
      console.error('[Monitor] Failed to fetch pending payments:', fetchError);
      return stats;
    }
    
    if (!pendingPayments || pendingPayments.length === 0) {
      console.log('[Monitor] No pending payments to process');
      return stats;
    }
    
    console.log(`[Monitor] Processing ${pendingPayments.length} pending payments`);
    
    // Process each payment
    for (const payment of pendingPayments) {
      stats.checked++;
      try {
        const result = await processPayment(supabase, payment as Payment);
        if (result.confirmed) stats.confirmed++;
        if (result.expired) stats.expired++;
      } catch (error) {
        console.error(`[Monitor] Error processing payment ${payment.id}:`, error);
        stats.errors++;
      }
    }
    
    console.log(`[Monitor] Cycle complete: checked=${stats.checked}, confirmed=${stats.confirmed}, expired=${stats.expired}, errors=${stats.errors}`);
  } catch (error) {
    console.error('[Monitor] Error in monitor cycle:', error);
  }
  
  return stats;
}

/**
 * Start the background monitor
 */
export function startMonitor(): void {
  if (isMonitorRunning) {
    console.log('[Monitor] Already running');
    return;
  }
  
  // Only run on server side
  if (typeof window !== 'undefined') {
    console.log('[Monitor] Cannot run in browser');
    return;
  }
  
  console.log(`[Monitor] Starting background payment monitor (interval: ${MONITOR_INTERVAL_MS}ms)`);
  isMonitorRunning = true;
  
  // Run immediately
  runMonitorCycle();
  
  // Then run on interval
  monitorInterval = setInterval(() => {
    runMonitorCycle();
  }, MONITOR_INTERVAL_MS);
}

/**
 * Stop the background monitor
 */
export function stopMonitor(): void {
  if (!isMonitorRunning) {
    console.log('[Monitor] Not running');
    return;
  }
  
  console.log('[Monitor] Stopping background payment monitor');
  isMonitorRunning = false;
  
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

/**
 * Check if monitor is running
 */
export function isMonitorActive(): boolean {
  return isMonitorRunning;
}

/**
 * Run a single monitor cycle (for testing or manual trigger)
 */
export async function runOnce(): Promise<{ checked: number; confirmed: number; expired: number; errors: number }> {
  return runMonitorCycle();
}