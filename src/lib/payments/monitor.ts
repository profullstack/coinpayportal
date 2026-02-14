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
import { runWalletTxCycle } from '../web-wallet/tx-finalize';

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
  BNB: process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org',
  XRP: process.env.XRP_RPC_URL || 'https://s1.ripple.com:51234',
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
 * Check balance for an EVM address (ETH/POL)
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
 * Check balance for a Dogecoin address
 */
async function checkDOGEBalance(address: string): Promise<BalanceResult> {
  try {
    console.log(`[Monitor] Checking DOGE balance for ${address}`);
    // Try Blockcypher first
    const response = await fetch(`https://api.blockcypher.com/v1/doge/main/addrs/${address}/balance`);
    if (response.ok) {
      const data = await response.json();
      const balance = (data.balance || 0) / 1e8;
      console.log(`[Monitor] DOGE balance for ${address}: ${balance} DOGE`);
      return { balance };
    }
    // Fallback to dogechain
    const fallbackResponse = await fetch(`https://dogechain.info/api/v1/address/balance/${address}`);
    if (fallbackResponse.ok) {
      const data = await fallbackResponse.json();
      if (data.success === 1) {
        const balance = parseFloat(data.balance || '0');
        console.log(`[Monitor] DOGE balance for ${address}: ${balance} DOGE`);
        return { balance };
      }
    }
    return { balance: 0 };
  } catch (error) {
    console.error(`[Monitor] Error checking DOGE balance for ${address}:`, error);
    return { balance: 0 };
  }
}

/**
 * Check balance for a BNB (BSC) address
 */
async function checkBNBBalance(address: string): Promise<BalanceResult> {
  try {
    console.log(`[Monitor] Checking BNB balance for ${address}`);
    const response = await fetch(RPC_ENDPOINTS.BNB, {
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
      return { balance: 0 };
    }
    const data = await response.json();
    const balanceWei = BigInt(data.result || '0x0');
    const balance = Number(balanceWei) / 1e18;
    console.log(`[Monitor] BNB balance for ${address}: ${balance} BNB`);
    return { balance };
  } catch (error) {
    console.error(`[Monitor] Error checking BNB balance for ${address}:`, error);
    return { balance: 0 };
  }
}

/**
 * Check balance for an XRP address
 */
async function checkXRPBalance(address: string): Promise<BalanceResult> {
  try {
    console.log(`[Monitor] Checking XRP balance for ${address}`);
    const response = await fetch(RPC_ENDPOINTS.XRP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'account_info',
        params: [{ account: address, ledger_index: 'validated' }],
      }),
    });
    if (!response.ok) {
      return { balance: 0 };
    }
    const data = await response.json();
    if (data.result?.error === 'actNotFound') {
      return { balance: 0 }; // Account not activated
    }
    // XRP balance is in drops (1 XRP = 1,000,000 drops)
    const drops = BigInt(data.result?.account_data?.Balance || '0');
    const balance = Number(drops) / 1e6;
    console.log(`[Monitor] XRP balance for ${address}: ${balance} XRP`);
    return { balance };
  } catch (error) {
    console.error(`[Monitor] Error checking XRP balance for ${address}:`, error);
    return { balance: 0 };
  }
}

/**
 * Check balance for a Cardano (ADA) address
 */
async function checkADABalance(address: string): Promise<BalanceResult> {
  try {
    console.log(`[Monitor] Checking ADA balance for ${address}`);
    const blockfrostKey = process.env.BLOCKFROST_API_KEY;
    if (!blockfrostKey) {
      console.error('[Monitor] BLOCKFROST_API_KEY not configured for ADA');
      return { balance: 0 };
    }
    const response = await fetch(`https://cardano-mainnet.blockfrost.io/api/v0/addresses/${address}`, {
      headers: { 'project_id': blockfrostKey },
    });
    if (response.status === 404) {
      return { balance: 0 }; // Address not used yet
    }
    if (!response.ok) {
      return { balance: 0 };
    }
    const data = await response.json();
    // ADA is in lovelace (1 ADA = 1,000,000 lovelace)
    // Find lovelace entry specifically (not native tokens)
    const lovelaceEntry = data.amount?.find((a: { unit: string }) => a.unit === 'lovelace');
    const lovelace = BigInt(lovelaceEntry?.quantity || '0');
    const balance = Number(lovelace) / 1e6;
    console.log(`[Monitor] ADA balance for ${address}: ${balance} ADA`);
    return { balance };
  } catch (error) {
    console.error(`[Monitor] Error checking ADA balance for ${address}:`, error);
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
    case 'USDT':
    case 'USDC':
    case 'USDC_ETH':
      return checkEVMBalance(address, RPC_ENDPOINTS.ETH, 'ETH');
    case 'POL':
    case 'USDC_POL':
      return checkEVMBalance(address, RPC_ENDPOINTS.POL, 'POL');
    case 'SOL':
    case 'USDC_SOL':
      return checkSolanaBalance(address, RPC_ENDPOINTS.SOL);
    case 'BNB':
      return checkBNBBalance(address);
    case 'DOGE':
      return checkDOGEBalance(address);
    case 'XRP':
      return checkXRPBalance(address);
    case 'ADA':
      return checkADABalance(address);
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

// ────────────────────────────────────────────────────────────
// Escrow Monitoring
// ────────────────────────────────────────────────────────────

interface EscrowStats {
  checked: number;
  funded: number;
  expired: number;
  settled: number;
  errors: number;
}

interface Escrow {
  id: string;
  escrow_address: string;
  escrow_address_id?: string;
  chain: string;
  amount: number;
  deposited_amount?: number;
  fee_amount?: number;
  status: string;
  expires_at: string;
  beneficiary_address?: string;
  depositor_address?: string;
  business_id?: string;
}

/**
 * Process escrow monitoring cycle
 */
async function runEscrowCycle(supabase: any, now: Date): Promise<EscrowStats> {
  const stats = { checked: 0, funded: 0, expired: 0, settled: 0, errors: 0 };
  
  try {
    // ── 1. Check pending escrows for deposits ──
    const { data: pendingEscrows, error: escrowFetchError } = await supabase
      .from('escrows')
      .select('id, escrow_address, chain, amount, status, expires_at')
      .eq('status', 'created')
      .limit(50);

    if (!escrowFetchError && pendingEscrows && pendingEscrows.length > 0) {
      console.log(`[Monitor] Processing ${pendingEscrows.length} pending escrows`);

      for (const escrow of pendingEscrows) {
        stats.checked++;
        try {
          // Check if expired
          if (new Date(escrow.expires_at) < now) {
            await supabase
              .from('escrows')
              .update({ status: 'expired' })
              .eq('id', escrow.id)
              .eq('status', 'created');
            await supabase.from('escrow_events').insert({
              escrow_id: escrow.id,
              event_type: 'expired',
              actor: 'system',
              details: {},
            });
            stats.expired++;
            console.log(`[Monitor] Escrow ${escrow.id} expired`);
            continue;
          }

          // Check balance on-chain using existing checkBalance function
          const balanceResult = await checkBalance(escrow.escrow_address, escrow.chain);
          const balance = balanceResult.balance;
          const tolerance = escrow.amount * 0.01;

          if (balance >= escrow.amount - tolerance) {
            // Mark as funded
            await supabase
              .from('escrows')
              .update({
                status: 'funded',
                funded_at: now.toISOString(),
                deposited_amount: balance,
              })
              .eq('id', escrow.id)
              .eq('status', 'created');
            await supabase.from('escrow_events').insert({
              escrow_id: escrow.id,
              event_type: 'funded',
              actor: 'system',
              details: { deposited_amount: balance },
            });
            stats.funded++;
            console.log(`[Monitor] Escrow ${escrow.id} funded with ${balance}`);
          }
        } catch (escrowError) {
          console.error(`[Monitor] Error processing escrow ${escrow.id}:`, escrowError);
          stats.errors++;
        }
      }
    }

    // ── 1b. Check funded escrows for expiration (auto-refund) ──
    const { data: fundedEscrows } = await supabase
      .from('escrows')
      .select('id, escrow_address, escrow_address_id, chain, deposited_amount, depositor_address, expires_at')
      .eq('status', 'funded')
      .lt('expires_at', now.toISOString())
      .limit(50);

    if (fundedEscrows && fundedEscrows.length > 0) {
      console.log(`[Monitor] ${fundedEscrows.length} funded escrows expired — auto-refunding`);
      for (const escrow of fundedEscrows) {
        try {
          // Mark as refunded so step 3 picks it up for settlement
          await supabase
            .from('escrows')
            .update({ status: 'refunded' })
            .eq('id', escrow.id)
            .eq('status', 'funded');
          await supabase.from('escrow_events').insert({
            escrow_id: escrow.id,
            event_type: 'expired_refund',
            actor: 'system',
            details: { reason: 'Funded escrow expired without release' },
          });
          stats.expired++;
          console.log(`[Monitor] Funded escrow ${escrow.id} expired — marked for refund`);
        } catch (err) {
          console.error(`[Monitor] Error expiring funded escrow ${escrow.id}:`, err);
          stats.errors++;
        }
      }
    }

    // ── 2. Process released escrows (trigger settlement/forwarding) ──
    const { data: releasedEscrows } = await supabase
      .from('escrows')
      .select('id, escrow_address, escrow_address_id, chain, amount, deposited_amount, fee_amount, beneficiary_address, business_id')
      .eq('status', 'released')
      .limit(20);

    if (releasedEscrows && releasedEscrows.length > 0) {
      console.log(`[Monitor] Processing ${releasedEscrows.length} released escrows for settlement`);
      const settleStats = await processEscrowSettlement(releasedEscrows, 'release');
      stats.settled += settleStats.settled;
      stats.errors += settleStats.errors;
    }

    // ── 3. Process refunded escrows (return funds to depositor) ──
    const { data: refundedEscrows } = await supabase
      .from('escrows')
      .select('id, escrow_address, escrow_address_id, chain, deposited_amount, depositor_address')
      .eq('status', 'refunded')
      .is('settlement_tx_hash', null)
      .limit(20);

    if (refundedEscrows && refundedEscrows.length > 0) {
      console.log(`[Monitor] Processing ${refundedEscrows.length} refunded escrows`);
      const refundStats = await processEscrowSettlement(refundedEscrows, 'refund');
      stats.settled += refundStats.settled;
      stats.errors += refundStats.errors;
    }

    if (stats.checked > 0) {
      console.log(`[Monitor] Escrow cycle: checked=${stats.checked}, funded=${stats.funded}, expired=${stats.expired}, settled=${stats.settled}, errors=${stats.errors}`);
    }
  } catch (escrowMonitorError) {
    console.error('[Monitor] Escrow monitor error:', escrowMonitorError);
    stats.errors++;
  }
  
  return stats;
}

/**
 * Process escrow settlement via internal API calls
 */
async function processEscrowSettlement(escrows: Escrow[], action: 'release' | 'refund'): Promise<{ settled: number; errors: number }> {
  const stats = { settled: 0, errors: 0 };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
  const internalApiKey = process.env.INTERNAL_API_KEY;

  if (!internalApiKey) {
    console.error('[Monitor] INTERNAL_API_KEY not configured - cannot process escrow settlements');
    stats.errors += escrows.length;
    return stats;
  }

  for (const escrow of escrows) {
    try {
      const body = action === 'refund' ? JSON.stringify({ action: 'refund' }) : undefined;
      const settleResponse = await fetch(`${appUrl}/api/escrow/${escrow.id}/settle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${internalApiKey}`,
        },
        ...(body && { body }),
      });

      if (settleResponse.ok) {
        console.log(`[Monitor] Settlement triggered for escrow ${escrow.id} (${action})`);
        stats.settled++;
      } else {
        const errorText = await settleResponse.text();
        console.error(`[Monitor] Settlement failed for escrow ${escrow.id}: ${settleResponse.status} - ${errorText}`);
        stats.errors++;
      }
    } catch (settleError) {
      console.error(`[Monitor] Error settling escrow ${escrow.id}:`, settleError);
      stats.errors++;
    }
  }

  return stats;
}

// ────────────────────────────────────────────────────────────
// Recurring Escrow Series
// ────────────────────────────────────────────────────────────

interface RecurringStats {
  processed: number;
  created: number;
  completed: number;
  errors: number;
}

function calculateNextChargeAt(current: Date, interval: string): Date {
  const next = new Date(current);
  switch (interval) {
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'biweekly':
      next.setDate(next.getDate() + 14);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
  }
  return next;
}

async function runRecurringEscrowCycle(supabase: any, now: Date): Promise<RecurringStats> {
  const stats: RecurringStats = { processed: 0, created: 0, completed: 0, errors: 0 };

  try {
    const { data: dueSeries, error: fetchError } = await supabase
      .from('escrow_series')
      .select('*')
      .eq('status', 'active')
      .lte('next_charge_at', now.toISOString())
      .limit(50);

    if (fetchError || !dueSeries || dueSeries.length === 0) {
      return stats;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
    const internalApiKey = process.env.INTERNAL_API_KEY;

    if (!internalApiKey) {
      console.error('[Monitor] INTERNAL_API_KEY not configured - cannot process recurring escrows');
      stats.errors += dueSeries.length;
      return stats;
    }

    console.log(`[Monitor] Processing ${dueSeries.length} due recurring escrow series`);

    for (const series of dueSeries) {
      stats.processed++;
      try {
        let childCreated = false;

        if (series.payment_method === 'crypto') {
          // Create crypto escrow via internal API
          const res = await fetch(`${appUrl}/api/escrow`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${internalApiKey}`,
            },
            body: JSON.stringify({
              business_id: series.merchant_id,
              chain: series.coin,
              amount: series.amount,
              currency: series.currency,
              depositor_address: series.depositor_address,
              beneficiary_address: series.beneficiary_address,
              description: series.description,
              series_id: series.id,
            }),
          });

          if (res.ok) {
            const escrow = await res.json();
            // Link series_id
            await supabase
              .from('escrows')
              .update({ series_id: series.id })
              .eq('id', escrow.id);
            childCreated = true;
            console.log(`[Monitor] Created crypto escrow ${escrow.id} for series ${series.id}`);
          } else {
            const errText = await res.text();
            console.error(`[Monitor] Failed to create crypto escrow for series ${series.id}: ${errText}`);
            stats.errors++;
            continue;
          }
        } else if (series.payment_method === 'card') {
          // Create Stripe escrow via internal API
          const res = await fetch(`${appUrl}/api/stripe/payments/create`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${internalApiKey}`,
            },
            body: JSON.stringify({
              businessId: series.merchant_id,
              amount: Number(series.amount),
              currency: series.currency?.toLowerCase() || 'usd',
              description: series.description,
              mode: 'escrow',
              series_id: series.id,
            }),
          });

          if (res.ok) {
            const result = await res.json();
            // Link series_id if we got an escrow id back
            if (result.escrow_id) {
              await supabase
                .from('stripe_escrows')
                .update({ series_id: series.id })
                .eq('id', result.escrow_id);
            }
            childCreated = true;
            console.log(`[Monitor] Created card escrow for series ${series.id}`);
          } else {
            const errText = await res.text();
            console.error(`[Monitor] Failed to create card escrow for series ${series.id}: ${errText}`);
            stats.errors++;
            continue;
          }
        }

        if (childCreated) {
          stats.created++;
          const newPeriodsCompleted = series.periods_completed + 1;
          const nextChargeAt = calculateNextChargeAt(now, series.interval);
          const isCompleted = series.max_periods && newPeriodsCompleted >= series.max_periods;

          await supabase
            .from('escrow_series')
            .update({
              periods_completed: newPeriodsCompleted,
              next_charge_at: nextChargeAt.toISOString(),
              status: isCompleted ? 'completed' : 'active',
              updated_at: now.toISOString(),
            })
            .eq('id', series.id);

          if (isCompleted) {
            stats.completed++;
            console.log(`[Monitor] Series ${series.id} completed (${newPeriodsCompleted}/${series.max_periods})`);
          }
        }
      } catch (seriesError) {
        console.error(`[Monitor] Error processing series ${series.id}:`, seriesError);
        stats.errors++;
      }
    }

    if (stats.processed > 0) {
      console.log(`[Monitor] Recurring cycle: processed=${stats.processed}, created=${stats.created}, completed=${stats.completed}, errors=${stats.errors}`);
    }
  } catch (error) {
    console.error('[Monitor] Recurring escrow monitor error:', error);
    stats.errors++;
  }

  return stats;
}

// ────────────────────────────────────────────────────────────
// Main Monitor Cycle
// ────────────────────────────────────────────────────────────

/**
 * Run one monitoring cycle — payments + wallet transactions + escrows
 */
async function runMonitorCycle(): Promise<{ checked: number; confirmed: number; expired: number; errors: number }> {
  const stats = { checked: 0, confirmed: 0, expired: 0, errors: 0 };
  
  try {
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[Monitor] Supabase credentials not configured');
      return stats;
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const now = new Date();
    
    // ── 1. Payment gateway monitoring ──
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
    } else if (pendingPayments && pendingPayments.length > 0) {
      console.log(`[Monitor] Processing ${pendingPayments.length} pending payments`);
      
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
    }
    
    // ── 2. Web-wallet transaction finalization ──
    const walletStats = await runWalletTxCycle(supabase);
    stats.checked += walletStats.checked;
    stats.confirmed += walletStats.confirmed;
    stats.errors += walletStats.errors;
    
    // ── 3. Escrow monitoring ──
    const escrowStats = await runEscrowCycle(supabase, now);
    stats.checked += escrowStats.checked;
    stats.confirmed += escrowStats.funded + escrowStats.settled;
    stats.expired += escrowStats.expired;
    stats.errors += escrowStats.errors;
    
    // ── 4. Recurring escrow series ──
    const recurringStats = await runRecurringEscrowCycle(supabase, now);
    stats.checked += recurringStats.processed;
    stats.confirmed += recurringStats.created;
    stats.errors += recurringStats.errors;

    if (stats.checked > 0) {
      console.log(`[Monitor] Cycle complete: checked=${stats.checked}, confirmed=${stats.confirmed}, expired=${stats.expired}, errors=${stats.errors}`);
    }
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