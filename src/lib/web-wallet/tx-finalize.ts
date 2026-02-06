/**
 * Web Wallet Transaction Finalizer
 *
 * Background service that checks pending/confirming wallet_transactions
 * against on-chain RPC endpoints and updates their status in the DB.
 *
 * Called by the main payment monitor daemon on each cycle.
 */

// ── RPC Endpoints ──

const RPC_ENDPOINTS: Record<string, string> = {
  BTC: process.env.BITCOIN_RPC_URL || 'https://blockstream.info/api',
  BCH: process.env.BCH_RPC_URL || 'https://rest.cryptoapis.io/blockchain-data/bitcoin-cash/mainnet',
  ETH: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  POL: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
  SOL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
};

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

// ── Types ──

interface TxStatus {
  confirmed: boolean;
  confirmations: number;
  blockNumber?: number;
  blockTimestamp?: string;
  failed?: boolean;
}

interface WalletTxRow {
  id: string;
  wallet_id: string;
  chain: string;
  tx_hash: string;
  status: string;
  confirmations: number;
  metadata: Record<string, unknown> | null;
}

export interface WalletTxCycleStats {
  checked: number;
  confirmed: number;
  failed: number;
  errors: number;
}

// ── Chain-specific status checkers ──

async function checkBTC(txHash: string): Promise<TxStatus | null> {
  try {
    const resp = await fetch(`https://blockstream.info/api/tx/${txHash}`);
    if (!resp.ok) return null;
    const tx = await resp.json();

    if (!tx.status?.confirmed) {
      return { confirmed: false, confirmations: 0 };
    }

    const tipResp = await fetch('https://blockstream.info/api/blocks/tip/height');
    const tipHeight = tipResp.ok ? parseInt(await tipResp.text(), 10) : 0;
    const confirmations = tipHeight && tx.status.block_height
      ? tipHeight - tx.status.block_height + 1
      : 1;

    return {
      confirmed: confirmations >= REQUIRED_CONFIRMATIONS.BTC,
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
  const rpcUrl = chain === 'POL' || chain === 'USDC_POL'
    ? RPC_ENDPOINTS.POL
    : RPC_ENDPOINTS.ETH;
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
      return { confirmed: false, confirmations: 0 };
    }

    const receipt = data.result;
    const txBlockNum = parseInt(receipt.blockNumber, 16);
    const txFailed = receipt.status === '0x0';

    // Get latest block number
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
  const rpcUrl = RPC_ENDPOINTS.SOL;
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

    return {
      confirmed: !failed && !!tx.slot,
      confirmations: tx.slot ? 32 : 0,
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
    // Try fullstack.cash first
    const resp = await fetch(`https://api.fullstack.cash/v5/electrumx/tx/data/${txHash}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data.success && data.details) {
        const confirmations = data.details.confirmations || 0;
        return {
          confirmed: confirmations >= REQUIRED_CONFIRMATIONS.BCH,
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
        return {
          confirmed: blockId > 0,
          confirmations: blockId > 0 ? 6 : 0,
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

// ── Unified checker ──

function checkOnChain(txHash: string, chain: string): Promise<TxStatus | null> {
  switch (chain) {
    case 'BTC': return checkBTC(txHash);
    case 'BCH': return checkBCH(txHash);
    case 'ETH': case 'USDC_ETH': return checkEVM(txHash, chain);
    case 'POL': case 'USDC_POL': return checkEVM(txHash, chain);
    case 'SOL': case 'USDC_SOL': return checkSOL(txHash);
    default: return Promise.resolve(null);
  }
}

// ── Main cycle ──

/**
 * Finalize pending/confirming web-wallet transactions by checking on-chain status.
 * Call this from the main monitor daemon on each cycle.
 *
 * @param supabase - Supabase client instance (passed in to avoid re-creating)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runWalletTxCycle(supabase: any): Promise<WalletTxCycleStats> {
  const stats: WalletTxCycleStats = { checked: 0, confirmed: 0, failed: 0, errors: 0 };
  const now = new Date();

  const { data, error: fetchError } = await supabase
    .from('wallet_transactions')
    .select('id, wallet_id, chain, tx_hash, status, confirmations, metadata')
    .in('status', ['pending', 'confirming'])
    .not('tx_hash', 'is', null)
    .limit(200)
    .order('created_at', { ascending: true });

  if (fetchError) {
    console.error('[WalletTxMonitor] Failed to fetch:', fetchError.message);
    return stats;
  }

  const txs = (data || []) as unknown as WalletTxRow[];

  // Filter out UUID placeholders (not yet broadcast)
  const realTxs = txs.filter(tx => tx.tx_hash && !tx.tx_hash.includes('-'));

  if (realTxs.length === 0) return stats;

  console.log(`[WalletTxMonitor] Checking ${realTxs.length} wallet transactions`);

  for (const tx of realTxs) {
    stats.checked++;
    try {
      const status = await checkOnChain(tx.tx_hash, tx.chain);
      if (!status) { stats.errors++; continue; }

      if (status.failed) {
        await supabase
          .from('wallet_transactions')
          .update({
            status: 'failed',
            confirmations: status.confirmations,
            block_number: status.blockNumber || null,
            block_timestamp: status.blockTimestamp || null,
            updated_at: now.toISOString(),
            metadata: { ...(tx.metadata || {}), finalized_by: 'daemon', finalized_at: now.toISOString() },
          })
          .eq('id', tx.id);
        stats.failed++;
        console.log(`[WalletTxMonitor] ${tx.tx_hash.slice(0, 12)}... ${tx.chain} → FAILED`);
      } else if (status.confirmed) {
        await supabase
          .from('wallet_transactions')
          .update({
            status: 'confirmed',
            confirmations: status.confirmations,
            block_number: status.blockNumber || null,
            block_timestamp: status.blockTimestamp || null,
            updated_at: now.toISOString(),
            metadata: { ...(tx.metadata || {}), finalized_by: 'daemon', finalized_at: now.toISOString() },
          })
          .eq('id', tx.id);
        stats.confirmed++;
        console.log(`[WalletTxMonitor] ${tx.tx_hash.slice(0, 12)}... ${tx.chain} → CONFIRMED (${status.confirmations} confs)`);
      } else if (status.confirmations > (tx.confirmations || 0)) {
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
      }
    } catch (err) {
      stats.errors++;
      console.error(`[WalletTxMonitor] Error on tx ${tx.id}:`, err);
    }
  }

  if (stats.checked > 0) {
    console.log(`[WalletTxMonitor] Done: checked=${stats.checked} confirmed=${stats.confirmed} failed=${stats.failed} errors=${stats.errors}`);
  }

  return stats;
}

// Export for testing
export { REQUIRED_CONFIRMATIONS, checkOnChain };
export type { TxStatus, WalletTxRow };
