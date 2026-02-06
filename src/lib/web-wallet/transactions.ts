/**
 * Web Wallet Transaction History Service
 *
 * Fetches transaction history from blockchain explorers/RPCs and
 * manages the wallet_transactions table.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WalletChain } from './identity';

/** Truncate an address for safe logging */
function truncAddr(addr: string): string {
  if (!addr || addr.length <= 12) return addr || '';
  return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
}

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface TransactionRecord {
  id: string;
  wallet_id: string;
  address_id: string | null;
  chain: WalletChain;
  tx_hash: string;
  direction: 'incoming' | 'outgoing';
  status: 'pending' | 'confirming' | 'confirmed' | 'failed';
  amount: string;
  from_address: string;
  to_address: string;
  fee_amount: string | null;
  fee_currency: string | null;
  confirmations: number;
  block_number: number | null;
  block_timestamp: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TransactionListOptions {
  chain?: string;
  direction?: 'incoming' | 'outgoing';
  status?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
}

export interface TransactionListResult {
  transactions: TransactionRecord[];
  total: number;
  limit: number;
  offset: number;
}

// Required confirmations per chain
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
    SOL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  };
}

// ──────────────────────────────────────────────
// Transaction Scanners per Chain
// ──────────────────────────────────────────────

interface RawTransaction {
  tx_hash: string;
  from_address: string;
  to_address: string;
  amount: string;
  fee_amount?: string;
  block_number?: number;
  block_timestamp?: string;
  confirmations?: number;
  status: 'pending' | 'confirming' | 'confirmed' | 'failed';
}

/**
 * Fetch BTC transactions for an address via Blockstream API.
 */
async function scanBTCTransactions(address: string): Promise<RawTransaction[]> {
  const response = await fetch(`https://blockstream.info/api/address/${address}/txs`);
  if (!response.ok) {
    throw new Error(`BTC tx scan failed: ${response.status}`);
  }

  const txs = await response.json();
  const results: RawTransaction[] = [];

  for (const tx of txs.slice(0, 50)) { // Limit to 50 most recent
    // Determine direction: is address in inputs or outputs?
    const isOutgoing = tx.vin?.some((v: any) => v.prevout?.scriptpubkey_address === address);
    const isIncoming = tx.vout?.some((v: any) => v.scriptpubkey_address === address);

    // Calculate amount received or sent
    let amount = 0;
    for (const vout of tx.vout || []) {
      if (vout.scriptpubkey_address === address) {
        amount += vout.value || 0;
      }
    }

    const confirmations = tx.status?.confirmed
      ? (tx.status.block_height ? 1 : 0) // Simplified; real count needs current block height
      : 0;

    results.push({
      tx_hash: tx.txid,
      from_address: isOutgoing ? address : (tx.vin?.[0]?.prevout?.scriptpubkey_address || 'unknown'),
      to_address: isIncoming ? address : (tx.vout?.[0]?.scriptpubkey_address || 'unknown'),
      amount: (amount / 1e8).toString(),
      fee_amount: tx.fee ? (tx.fee / 1e8).toString() : undefined,
      block_number: tx.status?.block_height,
      block_timestamp: tx.status?.block_time
        ? new Date(tx.status.block_time * 1000).toISOString()
        : undefined,
      confirmations,
      status: tx.status?.confirmed ? 'confirmed' : 'pending',
    });
  }

  return results;
}

/**
 * Fetch EVM transactions for an address via JSON-RPC (eth_getLogs for tokens,
 * basic balance check for native). For full tx history, an explorer API is needed.
 * This is a simplified scanner that uses recent block logs.
 */
async function scanEVMTransactions(
  address: string,
  rpcUrl: string,
  chain: string
): Promise<RawTransaction[]> {
  // Get latest block number
  const blockResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1,
    }),
  });

  if (!blockResp.ok) {
    throw new Error(`${chain} block number fetch failed: ${blockResp.status}`);
  }

  const blockData = await blockResp.json();
  if (blockData.error) {
    throw new Error(`RPC error: ${blockData.error.message}`);
  }

  const latestBlock = parseInt(blockData.result, 16);
  // Scan last ~1000 blocks (adjust as needed)
  const fromBlock = Math.max(0, latestBlock - 1000);

  // Look for incoming transfers via eth_getLogs (Transfer events to this address)
  // ERC-20 Transfer topic: keccak256("Transfer(address,address,uint256)")
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const paddedAddress = '0x' + address.toLowerCase().replace('0x', '').padStart(64, '0');

  const logsResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getLogs',
      params: [{
        fromBlock: '0x' + fromBlock.toString(16),
        toBlock: 'latest',
        topics: [transferTopic, null, paddedAddress], // Transfer to this address
      }],
      id: 1,
    }),
  });

  if (!logsResp.ok) {
    throw new Error(`${chain} logs fetch failed: ${logsResp.status}`);
  }

  const logsData = await logsResp.json();
  const results: RawTransaction[] = [];

  if (logsData.result) {
    for (const log of logsData.result.slice(0, 50)) {
      const fromAddr = '0x' + (log.topics?.[1] || '').slice(26);
      const amount = BigInt(log.data || '0x0');
      const blockNum = parseInt(log.blockNumber, 16);
      const confirmations = latestBlock - blockNum;

      results.push({
        tx_hash: log.transactionHash,
        from_address: fromAddr,
        to_address: address,
        amount: (Number(amount) / 1e18).toString(),
        block_number: blockNum,
        confirmations,
        status: confirmations >= (REQUIRED_CONFIRMATIONS[chain] || 12) ? 'confirmed' : 'confirming',
      });
    }
  }

  return results;
}

/**
 * Fetch SOL transactions for an address via JSON-RPC.
 */
async function scanSOLTransactions(address: string, rpcUrl: string): Promise<RawTransaction[]> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'getSignaturesForAddress',
      params: [address, { limit: 50 }],
      id: 1,
    }),
  });

  if (!response.ok) {
    throw new Error(`SOL tx scan failed: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  const results: RawTransaction[] = [];

  for (const sig of data.result || []) {
    results.push({
      tx_hash: sig.signature,
      from_address: 'unknown', // Need getTransaction call for full details
      to_address: address,
      amount: '0', // Need getTransaction call for amount
      block_number: sig.slot,
      block_timestamp: sig.blockTime
        ? new Date(sig.blockTime * 1000).toISOString()
        : undefined,
      confirmations: sig.confirmationStatus === 'finalized' ? 32 : 0,
      status: sig.confirmationStatus === 'finalized' ? 'confirmed'
        : sig.err ? 'failed'
        : 'confirming',
    });
  }

  return results;
}

// ──────────────────────────────────────────────
// Unified Scanner
// ──────────────────────────────────────────────

/**
 * Scan transactions for a given address and chain.
 */
export async function scanTransactions(
  address: string,
  chain: WalletChain
): Promise<RawTransaction[]> {
  console.log(`[Transactions] Scanning ${chain} transactions for ${truncAddr(address)}`);
  const rpc = getRpcEndpoints();

  switch (chain) {
    case 'BTC':
      return scanBTCTransactions(address);
    case 'BCH':
      // BCH uses similar explorer; simplified to return empty for now
      return [];
    case 'ETH':
    case 'USDC_ETH':
      return scanEVMTransactions(address, rpc.ETH, chain);
    case 'POL':
    case 'USDC_POL':
      return scanEVMTransactions(address, rpc.POL, chain);
    case 'SOL':
    case 'USDC_SOL':
      return scanSOLTransactions(address, rpc.SOL);
    default:
      return [];
  }
}

// ──────────────────────────────────────────────
// Database Operations
// ──────────────────────────────────────────────

/**
 * Upsert scanned transactions into the database.
 */
export async function upsertTransactions(
  supabase: SupabaseClient,
  walletId: string,
  addressId: string,
  chain: WalletChain,
  address: string,
  rawTxs: RawTransaction[]
): Promise<{ inserted: number; updated: number }> {
  console.log(`[Transactions] Upserting ${rawTxs.length} ${chain} txs for ${truncAddr(address)}`);

  let inserted = 0;
  let updated = 0;

  for (const raw of rawTxs) {
    const direction: 'incoming' | 'outgoing' =
      raw.to_address.toLowerCase() === address.toLowerCase() ? 'incoming' : 'outgoing';

    const record = {
      wallet_id: walletId,
      address_id: addressId,
      chain,
      tx_hash: raw.tx_hash,
      direction,
      status: raw.status,
      amount: parseFloat(raw.amount),
      from_address: raw.from_address,
      to_address: raw.to_address,
      fee_amount: raw.fee_amount ? parseFloat(raw.fee_amount) : null,
      fee_currency: chain.includes('USDC') ? 'USDC' : chain,
      confirmations: raw.confirmations || 0,
      block_number: raw.block_number || null,
      block_timestamp: raw.block_timestamp || null,
    };

    // Try insert, on conflict update status/confirmations
    const { error: insertError } = await supabase
      .from('wallet_transactions')
      .upsert(record, { onConflict: 'chain,tx_hash' });

    if (!insertError) {
      inserted++;
    } else {
      // Update existing
      const { error: updateError } = await supabase
        .from('wallet_transactions')
        .update({
          status: record.status,
          confirmations: record.confirmations,
          block_number: record.block_number,
          block_timestamp: record.block_timestamp,
        })
        .eq('chain', chain)
        .eq('tx_hash', raw.tx_hash);

      if (!updateError) updated++;
    }
  }

  return { inserted, updated };
}

/**
 * Get transaction history for a wallet with pagination and filtering.
 */
export async function getTransactionHistory(
  supabase: SupabaseClient,
  walletId: string,
  options: TransactionListOptions = {}
): Promise<{ success: true; data: TransactionListResult } | { success: false; error: string; code?: string }> {
  const limit = Math.min(options.limit || 50, 100);
  const offset = options.offset || 0;

  // Build query
  let query = supabase
    .from('wallet_transactions')
    .select('*', { count: 'exact' })
    .eq('wallet_id', walletId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (options.chain) {
    query = query.eq('chain', options.chain);
  }
  if (options.direction) {
    query = query.eq('direction', options.direction);
  }
  if (options.status) {
    query = query.eq('status', options.status);
  }
  if (options.from_date) {
    query = query.gte('created_at', options.from_date);
  }
  if (options.to_date) {
    query = query.lte('created_at', options.to_date);
  }

  const { data, count, error } = await query;

  if (error) {
    console.error(`[Transactions] Failed to load history for wallet ${walletId}:`, error.message);
    return { success: false, error: 'Failed to load transactions', code: 'DB_ERROR' };
  }

  console.log(`[Transactions] Loaded ${data?.length || 0} of ${count || 0} transactions for wallet ${walletId}`);

  return {
    success: true,
    data: {
      transactions: (data || []) as TransactionRecord[],
      total: count || 0,
      limit,
      offset,
    },
  };
}

/**
 * Get a single transaction by ID.
 */
export async function getTransaction(
  supabase: SupabaseClient,
  walletId: string,
  transactionId: string
): Promise<{ success: true; data: TransactionRecord } | { success: false; error: string; code?: string }> {
  // Try by UUID first
  const { data, error } = await supabase
    .from('wallet_transactions')
    .select('*')
    .eq('id', transactionId)
    .eq('wallet_id', walletId)
    .single();

  if (!error && data) {
    return { success: true, data: data as TransactionRecord };
  }

  // Fall back to tx_hash lookup (URLs use the on-chain hash, not the UUID)
  const { data: byHash, error: hashError } = await supabase
    .from('wallet_transactions')
    .select('*')
    .eq('tx_hash', transactionId)
    .eq('wallet_id', walletId)
    .single();

  if (!hashError && byHash) {
    return { success: true, data: byHash as TransactionRecord };
  }

  return { success: false, error: 'Transaction not found', code: 'TX_NOT_FOUND' };
}

// Export for testing
export { REQUIRED_CONFIRMATIONS };
export type { RawTransaction };
