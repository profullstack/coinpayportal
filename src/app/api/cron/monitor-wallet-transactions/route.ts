import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const CRON_SECRET = process.env.CRON_SECRET || process.env.INTERNAL_API_KEY;

// Required confirmations per chain before marking confirmed
const REQUIRED_CONFIRMATIONS: Record<string, number> = {
  BTC: 3,
  BCH: 6,
  ETH: 12,
  POL: 128,
  SOL: 32,
  USDC_ETH: 12,
  USDC_POL: 128,
  USDC_SOL: 32,
};

// ──────────────────────────────────────────────
// RPC Endpoints
// ──────────────────────────────────────────────

function getRpcEndpoints(): Record<string, string> {
  return {
    BTC: process.env.BITCOIN_RPC_URL || 'https://blockstream.info/api',
    ETH: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    POL: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    SOL:
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
      process.env.SOLANA_RPC_URL ||
      'https://api.mainnet-beta.solana.com',
  };
}

// ──────────────────────────────────────────────
// Transaction Status Checkers
// ──────────────────────────────────────────────

interface TxStatus {
  confirmed: boolean;
  confirmations: number;
  blockNumber: number | null;
  blockTimestamp: string | null;
  failed?: boolean;
}

/**
 * Check BTC transaction status via Blockstream API
 */
async function checkBTCTransaction(txHash: string): Promise<TxStatus> {
  const resp = await fetch(`https://blockstream.info/api/tx/${txHash}`);
  if (!resp.ok) throw new Error(`BTC tx fetch failed: ${resp.status}`);
  const data = await resp.json();

  const tipResp = await fetch('https://blockstream.info/api/blocks/tip/height');
  const tipHeight = tipResp.ok ? parseInt(await tipResp.text(), 10) : 0;

  const blockHeight = data.status?.block_height || null;
  const confirmations = blockHeight && tipHeight ? tipHeight - blockHeight + 1 : 0;

  return {
    confirmed: data.status?.confirmed === true,
    confirmations,
    blockNumber: blockHeight,
    blockTimestamp: data.status?.block_time
      ? new Date(data.status.block_time * 1000).toISOString()
      : null,
  };
}

/**
 * Check EVM (ETH/POL) transaction status via JSON-RPC
 */
async function checkEVMTransaction(
  txHash: string,
  rpcUrl: string
): Promise<TxStatus> {
  // Get transaction receipt
  const receiptResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getTransactionReceipt',
      params: [txHash],
      id: 1,
    }),
  });

  if (!receiptResp.ok) throw new Error(`EVM receipt fetch failed: ${receiptResp.status}`);
  const receiptData = await receiptResp.json();
  const receipt = receiptData.result;

  if (!receipt) {
    // Transaction not yet mined
    return { confirmed: false, confirmations: 0, blockNumber: null, blockTimestamp: null };
  }

  // Check if transaction succeeded
  const success = receipt.status === '0x1';
  if (!success) {
    return {
      confirmed: false,
      confirmations: 0,
      blockNumber: parseInt(receipt.blockNumber, 16),
      blockTimestamp: null,
      failed: true,
    };
  }

  // Get current block number for confirmation count
  const blockResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 2,
    }),
  });

  const blockData = await blockResp.json();
  const currentBlock = parseInt(blockData.result, 16);
  const txBlock = parseInt(receipt.blockNumber, 16);
  const confirmations = currentBlock - txBlock + 1;

  return {
    confirmed: true,
    confirmations,
    blockNumber: txBlock,
    blockTimestamp: null, // Would need a separate getBlock call
  };
}

/**
 * Check Solana transaction status via JSON-RPC
 */
async function checkSolanaTransaction(
  txHash: string,
  rpcUrl: string
): Promise<TxStatus> {
  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'getTransaction',
      params: [txHash, { encoding: 'json', maxSupportedTransactionVersion: 0 }],
      id: 1,
    }),
  });

  if (!resp.ok) throw new Error(`SOL tx fetch failed: ${resp.status}`);
  const data = await resp.json();
  const tx = data.result;

  if (!tx) {
    return { confirmed: false, confirmations: 0, blockNumber: null, blockTimestamp: null };
  }

  const failed = tx.meta?.err !== null;
  const slot = tx.slot || null;
  const blockTime = tx.blockTime
    ? new Date(tx.blockTime * 1000).toISOString()
    : null;

  // Get current slot for confirmation estimate
  const slotResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'getSlot',
      params: [],
      id: 2,
    }),
  });
  const slotData = await slotResp.json();
  const currentSlot = slotData.result || 0;
  const confirmations = slot ? currentSlot - slot : 0;

  return {
    confirmed: !failed && confirmations >= 1,
    confirmations,
    blockNumber: slot,
    blockTimestamp: blockTime,
    failed,
  };
}

/**
 * Check transaction status for any supported chain
 */
async function checkTransactionStatus(
  txHash: string,
  chain: string
): Promise<TxStatus> {
  const rpc = getRpcEndpoints();

  switch (chain) {
    case 'BTC':
    case 'BCH': // BCH uses same Blockstream-like API structure
      return checkBTCTransaction(txHash);
    case 'ETH':
    case 'USDC_ETH':
      return checkEVMTransaction(txHash, rpc.ETH);
    case 'POL':
    case 'USDC_POL':
      return checkEVMTransaction(txHash, rpc.POL);
    case 'SOL':
    case 'USDC_SOL':
      return checkSolanaTransaction(txHash, rpc.SOL);
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}

// ──────────────────────────────────────────────
// Cron Handler
// ──────────────────────────────────────────────

/**
 * GET /api/cron/monitor-wallet-transactions
 *
 * Background job that checks pending/confirming web wallet transactions
 * against the blockchain and updates their status in the DB.
 *
 * Solves the "closed browser before DB updated" problem — this cron
 * catches any transactions that the frontend missed updating.
 */
export async function GET(request: NextRequest) {
  try {
    // Auth check
    const authHeader = request.headers.get('authorization');
    const cronSecret = authHeader?.replace('Bearer ', '');
    const isVercelCron = request.headers.get('x-vercel-cron') === '1';

    if (!isVercelCron && cronSecret !== CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const now = new Date();

    const stats = {
      checked: 0,
      confirmed: 0,
      failed: 0,
      errors: 0,
      balancesRefreshed: 0,
    };

    // Fetch all pending/confirming web wallet transactions
    const { data: pendingTxs, error: fetchError } = await supabase
      .from('wallet_transactions')
      .select('id, wallet_id, address_id, chain, tx_hash, status, confirmations')
      .in('status', ['pending', 'confirming'])
      .order('created_at', { ascending: true })
      .limit(50);

    if (fetchError) {
      console.error('[wallet-tx-monitor] Failed to fetch pending transactions:', fetchError);
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!pendingTxs || pendingTxs.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pending transactions',
        timestamp: now.toISOString(),
        stats,
      });
    }

    console.log(`[wallet-tx-monitor] Processing ${pendingTxs.length} pending transactions`);

    // Track which wallet addresses need balance refresh
    const addressesToRefresh = new Set<string>();

    for (const tx of pendingTxs) {
      stats.checked++;

      try {
        const txStatus = await checkTransactionStatus(tx.tx_hash, tx.chain);
        const requiredConfs = REQUIRED_CONFIRMATIONS[tx.chain] || 6;

        let newStatus = tx.status;

        if (txStatus.failed) {
          newStatus = 'failed';
          stats.failed++;
        } else if (txStatus.confirmed && txStatus.confirmations >= requiredConfs) {
          newStatus = 'confirmed';
          stats.confirmed++;
        } else if (txStatus.confirmed && txStatus.confirmations > 0) {
          newStatus = 'confirming';
        }

        // Only update if status changed or confirmations changed
        if (
          newStatus !== tx.status ||
          txStatus.confirmations !== tx.confirmations
        ) {
          const { error: updateError } = await supabase
            .from('wallet_transactions')
            .update({
              status: newStatus,
              confirmations: txStatus.confirmations,
              block_number: txStatus.blockNumber,
              block_timestamp: txStatus.blockTimestamp,
              updated_at: now.toISOString(),
            })
            .eq('id', tx.id);

          if (updateError) {
            console.error(
              `[wallet-tx-monitor] Failed to update tx ${tx.id}:`,
              updateError
            );
            stats.errors++;
          } else {
            console.log(
              `[wallet-tx-monitor] tx ${tx.tx_hash.substring(0, 16)}... ${tx.status} → ${newStatus} (${txStatus.confirmations} confs)`
            );

            // Queue balance refresh for confirmed transactions
            if (newStatus === 'confirmed' && tx.address_id) {
              addressesToRefresh.add(tx.address_id);
            }
          }
        }
      } catch (err) {
        console.error(
          `[wallet-tx-monitor] Error checking tx ${tx.tx_hash}:`,
          err
        );
        stats.errors++;
      }
    }

    // Refresh cached balances for addresses that had transactions confirmed
    const addressIds = Array.from(addressesToRefresh);
    for (const addressId of addressIds) {
      try {
        const { data: addr } = await supabase
          .from('wallet_addresses')
          .select('address, chain')
          .eq('id', addressId)
          .single();

        if (addr) {
          // Dynamic import to avoid circular deps
          const balanceModule = await import('../../../../lib/web-wallet/balance');
          const fetchBalance = balanceModule.fetchBalance;
          const balance = await fetchBalance(addr.address, addr.chain);
          await supabase
            .from('wallet_addresses')
            .update({
              cached_balance: parseFloat(balance),
              cached_balance_updated_at: now.toISOString(),
            })
            .eq('id', addressId);
          stats.balancesRefreshed++;
        }
      } catch (err) {
        console.error(
          `[wallet-tx-monitor] Error refreshing balance for address ${addressId}:`,
          err
        );
      }
    }

    const response = {
      success: true,
      timestamp: now.toISOString(),
      stats,
    };

    console.log('[wallet-tx-monitor] Complete:', response);
    return NextResponse.json(response);
  } catch (error) {
    console.error('[wallet-tx-monitor] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Monitor failed' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
