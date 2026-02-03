import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/cron/monitor-wallet-txs
 *
 * Background job that finalizes web-wallet transactions.
 * Finds all pending/confirming rows in wallet_transactions,
 * checks their on-chain status via RPC, and updates the DB.
 *
 * Should be called every ~30-60 seconds by an external cron or Vercel Cron.
 *
 * Auth: CRON_SECRET / INTERNAL_API_KEY in Authorization header,
 *       or Vercel's x-vercel-cron header.
 */

function getEnv() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    cronSecret: process.env.CRON_SECRET || process.env.INTERNAL_API_KEY || '',
  };
}

// ── RPC endpoints ──

function getRpcUrl(chain: string): string {
  const urls: Record<string, string> = {
    BTC: process.env.BITCOIN_RPC_URL || 'https://blockstream.info/api',
    ETH: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    POL: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    SOL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  };
  // Map USDC variants to their parent chain RPC
  if (chain === 'USDC_ETH') return urls.ETH;
  if (chain === 'USDC_POL') return urls.POL;
  if (chain === 'USDC_SOL') return urls.SOL;
  return urls[chain] || '';
}

// Required confirmations before marking "confirmed"
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

// ── Chain-specific status checkers ──

interface TxStatus {
  confirmed: boolean;
  confirmations: number;
  blockNumber?: number;
  blockTimestamp?: string;
  failed?: boolean;
}

async function checkBTC(txHash: string): Promise<TxStatus | null> {
  try {
    const resp = await fetch(`https://blockstream.info/api/tx/${txHash}`);
    if (!resp.ok) return null;
    const tx = await resp.json();

    if (!tx.status?.confirmed) {
      return { confirmed: false, confirmations: 0 };
    }

    // Get current block height for confirmation count
    const tipResp = await fetch('https://blockstream.info/api/blocks/tip/height');
    const tipHeight = tipResp.ok ? parseInt(await tipResp.text(), 10) : 0;
    const confirmations = tipHeight && tx.status.block_height
      ? tipHeight - tx.status.block_height + 1
      : 1;

    return {
      confirmed: confirmations >= (REQUIRED_CONFIRMATIONS.BTC),
      confirmations,
      blockNumber: tx.status.block_height,
      blockTimestamp: tx.status.block_time
        ? new Date(tx.status.block_time * 1000).toISOString()
        : undefined,
    };
  } catch {
    return null;
  }
}

async function checkEVM(txHash: string, chain: string): Promise<TxStatus | null> {
  const rpcUrl = getRpcUrl(chain);
  if (!rpcUrl) return null;

  try {
    // Get transaction receipt
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getTransactionReceipt',
        params: [txHash],
        id: 1,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.error || !data.result) {
      // Receipt not available yet → still pending
      return { confirmed: false, confirmations: 0 };
    }

    const receipt = data.result;
    const txBlockNum = parseInt(receipt.blockNumber, 16);
    const txFailed = receipt.status === '0x0';

    // Get latest block for confirmation count
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
    const blockData = blockResp.ok ? await blockResp.json() : null;
    const latestBlock = blockData?.result ? parseInt(blockData.result, 16) : 0;
    const confirmations = latestBlock ? latestBlock - txBlockNum + 1 : 1;

    // Get block timestamp
    let blockTimestamp: string | undefined;
    try {
      const blkResp = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getBlockByNumber',
          params: [receipt.blockNumber, false],
          id: 3,
        }),
      });
      const blkData = blkResp.ok ? await blkResp.json() : null;
      if (blkData?.result?.timestamp) {
        blockTimestamp = new Date(parseInt(blkData.result.timestamp, 16) * 1000).toISOString();
      }
    } catch { /* non-critical */ }

    const required = REQUIRED_CONFIRMATIONS[chain] || 12;

    return {
      confirmed: !txFailed && confirmations >= required,
      confirmations,
      blockNumber: txBlockNum,
      blockTimestamp,
      failed: txFailed,
    };
  } catch {
    return null;
  }
}

async function checkSOL(txHash: string): Promise<TxStatus | null> {
  const rpcUrl = getRpcUrl('SOL');
  if (!rpcUrl) return null;

  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'getTransaction',
        params: [txHash, { encoding: 'json', commitment: 'confirmed' }],
        id: 1,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.error || !data.result) {
      return { confirmed: false, confirmations: 0 };
    }

    const tx = data.result;
    const failed = !!tx.meta?.err;
    // Solana: if the tx is returned with "confirmed" commitment, it has enough confirmations
    const confirmations = tx.slot ? 32 : 0; // Simplified; finalized ≈ 32

    return {
      confirmed: !failed && !!tx.slot,
      confirmations,
      blockNumber: tx.slot,
      blockTimestamp: tx.blockTime
        ? new Date(tx.blockTime * 1000).toISOString()
        : undefined,
      failed,
    };
  } catch {
    return null;
  }
}

async function checkBCH(txHash: string): Promise<TxStatus | null> {
  try {
    // Try fullstack.cash
    const resp = await fetch(`https://api.fullstack.cash/v5/electrumx/tx/data/${txHash}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data.success && data.details) {
        const confirmations = data.details.confirmations || 0;
        return {
          confirmed: confirmations >= (REQUIRED_CONFIRMATIONS.BCH),
          confirmations,
          blockNumber: data.details.blockheight || undefined,
          blockTimestamp: data.details.blocktime
            ? new Date(data.details.blocktime * 1000).toISOString()
            : undefined,
        };
      }
    }

    // Fallback: Blockchair
    const bcResp = await fetch(`https://api.blockchair.com/bitcoin-cash/dashboards/transaction/${txHash}`);
    if (bcResp.ok) {
      const bcData = await bcResp.json();
      const txInfo = bcData?.data?.[txHash]?.transaction;
      if (txInfo) {
        const blockId = txInfo.block_id || 0;
        // Rough confirmation count (blockchair doesn't return it directly)
        return {
          confirmed: blockId > 0,
          confirmations: blockId > 0 ? 6 : 0, // Assume confirmed if mined
          blockNumber: blockId || undefined,
          blockTimestamp: txInfo.time || undefined,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check on-chain status for a transaction.
 */
async function checkTxStatus(txHash: string, chain: string): Promise<TxStatus | null> {
  switch (chain) {
    case 'BTC':
      return checkBTC(txHash);
    case 'BCH':
      return checkBCH(txHash);
    case 'ETH':
    case 'USDC_ETH':
      return checkEVM(txHash, chain);
    case 'POL':
    case 'USDC_POL':
      return checkEVM(txHash, chain);
    case 'SOL':
    case 'USDC_SOL':
      return checkSOL(txHash);
    default:
      return null;
  }
}

// ── Auth helper ──

function isAuthorized(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  if (isVercelCron) return true;

  const { cronSecret } = getEnv();
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');
  return !!cronSecret && token === cronSecret;
}

// ── Route handler ──

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { supabaseUrl, supabaseServiceKey } = getEnv();
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date();

  const stats = { checked: 0, confirmed: 0, failed: 0, errors: 0, unchanged: 0 };

  // Fetch all pending/confirming wallet transactions
  // Only check txs with a real tx_hash (not placeholder UUIDs)
  const { data: txs, error: fetchError } = await supabase
    .from('wallet_transactions')
    .select('id, wallet_id, chain, tx_hash, status, confirmations, metadata')
    .in('status', ['pending', 'confirming'])
    .not('tx_hash', 'is', null)
    .limit(200)
    .order('created_at', { ascending: true });

  if (fetchError) {
    console.error('[MonitorWalletTxs] Failed to fetch transactions:', fetchError.message);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  // Filter out placeholder hashes (UUIDs from prepare-tx that haven't been broadcast yet)
  const realTxs = (txs || []).filter(tx => {
    // UUIDs contain dashes; real tx hashes don't (they're hex or base58)
    return tx.tx_hash && !tx.tx_hash.includes('-');
  });

  console.log(`[MonitorWalletTxs] Checking ${realTxs.length} transactions (${txs?.length || 0} total pending/confirming)`);

  for (const tx of realTxs) {
    stats.checked++;
    try {
      const status = await checkTxStatus(tx.tx_hash, tx.chain);

      if (!status) {
        // RPC unavailable, skip
        stats.errors++;
        continue;
      }

      if (status.failed) {
        await supabase
          .from('wallet_transactions')
          .update({
            status: 'failed',
            confirmations: status.confirmations,
            block_number: status.blockNumber || null,
            block_timestamp: status.blockTimestamp || null,
            updated_at: now.toISOString(),
            metadata: { ...(tx.metadata || {}), finalized_by: 'cron', finalized_at: now.toISOString() },
          })
          .eq('id', tx.id);
        stats.failed++;
        console.log(`[MonitorWalletTxs] TX ${tx.tx_hash.slice(0, 12)}... on ${tx.chain} → FAILED`);
        continue;
      }

      if (status.confirmed) {
        await supabase
          .from('wallet_transactions')
          .update({
            status: 'confirmed',
            confirmations: status.confirmations,
            block_number: status.blockNumber || null,
            block_timestamp: status.blockTimestamp || null,
            updated_at: now.toISOString(),
            metadata: { ...(tx.metadata || {}), finalized_by: 'cron', finalized_at: now.toISOString() },
          })
          .eq('id', tx.id);
        stats.confirmed++;
        console.log(`[MonitorWalletTxs] TX ${tx.tx_hash.slice(0, 12)}... on ${tx.chain} → CONFIRMED (${status.confirmations} confs)`);
        continue;
      }

      // Still confirming — update confirmation count if changed
      if (status.confirmations > (tx.confirmations || 0)) {
        await supabase
          .from('wallet_transactions')
          .update({
            status: 'confirming',
            confirmations: status.confirmations,
            block_number: status.blockNumber || null,
            block_timestamp: status.blockTimestamp || null,
            updated_at: now.toISOString(),
          })
          .eq('id', tx.id);
        console.log(`[MonitorWalletTxs] TX ${tx.tx_hash.slice(0, 12)}... on ${tx.chain} → confirming (${status.confirmations} confs)`);
      } else {
        stats.unchanged++;
      }
    } catch (err) {
      stats.errors++;
      console.error(`[MonitorWalletTxs] Error checking tx ${tx.id}:`, err);
    }
  }

  const result = { success: true, timestamp: now.toISOString(), stats };
  console.log('[MonitorWalletTxs] Complete:', JSON.stringify(stats));

  return NextResponse.json(result);
}

// Support GET for Vercel Cron compatibility
export async function GET(request: NextRequest) {
  return POST(request);
}
