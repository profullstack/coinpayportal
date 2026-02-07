/**
 * On-Chain Transaction History Indexer
 *
 * Fetches on-chain transaction history for wallet addresses from free
 * public blockchain APIs and returns normalized transaction records.
 * Used by the sync-history API route to discover external deposits
 * that weren't initiated through the app.
 *
 * Each chain function returns a normalized IndexedTransaction list.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WalletChain } from './identity';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface IndexedTransaction {
  txHash: string;
  chain: WalletChain;
  direction: 'incoming' | 'outgoing';
  amount: string;
  fromAddress: string;
  toAddress: string;
  status: 'confirmed' | 'pending';
  confirmations: number;
  timestamp: string; // ISO
  fee?: string;
  blockNumber?: number;
}

export interface SyncResult {
  newTransactions: number;
  chain: WalletChain;
  address: string;
  errors: string[];
}

// ──────────────────────────────────────────────
// RPC / API Endpoints (reuse from balance.ts)
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
    BNB: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
  };
}

// USDC contract addresses (same as balance.ts)
const USDC_CONTRACTS: Record<string, string> = {
  USDC_ETH: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDC_POL: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
};

// USDT contract addresses
const USDT_CONTRACTS: Record<string, string> = {
  USDT_ETH: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  USDT_POL: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
};

const USDC_SOL_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_SOL_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// Explorer API base URLs
const EXPLORER_APIS: Record<string, string> = {
  ETH: 'https://api.etherscan.io/api',
  POL: 'https://api.polygonscan.com/api',
  BNB: 'https://api.bscscan.com/api',
};

// ERC-20 Transfer event topic
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Max transactions per scan */
const MAX_TXS = 50;

/** Truncate address for logging */
function truncAddr(addr: string): string {
  if (!addr || addr.length <= 12) return addr || '';
  return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
}

// ──────────────────────────────────────────────
// BTC Indexer (Blockstream API)
// ──────────────────────────────────────────────

async function fetchBTCHistory(
  address: string
): Promise<IndexedTransaction[]> {
  const resp = await fetch(
    `https://blockstream.info/api/address/${address}/txs`
  );
  if (!resp.ok) {
    throw new Error(`BTC history fetch failed: ${resp.status}`);
  }

  // Blockstream returns array of transaction objects
  const txs: Array<{
    txid: string;
    vin: Array<{ prevout?: { scriptpubkey_address?: string; value?: number } }>;
    vout: Array<{ scriptpubkey_address?: string; value?: number }>;
    fee?: number;
    status: { confirmed?: boolean; block_height?: number; block_time?: number };
  }> = await resp.json();

  const results: IndexedTransaction[] = [];

  for (const tx of txs.slice(0, MAX_TXS)) {
    const isOutgoing = tx.vin?.some(
      (v) => v.prevout?.scriptpubkey_address === address
    );

    // Sum outputs to our address
    let receivedSats = 0;
    for (const vout of tx.vout || []) {
      if (vout.scriptpubkey_address === address) {
        receivedSats += vout.value || 0;
      }
    }

    // Sum inputs from our address for outgoing amount
    let sentSats = 0;
    if (isOutgoing) {
      for (const vin of tx.vin || []) {
        if (vin.prevout?.scriptpubkey_address === address) {
          sentSats += vin.prevout?.value || 0;
        }
      }
    }

    const direction: 'incoming' | 'outgoing' = isOutgoing
      ? 'outgoing'
      : 'incoming';
    const amount = direction === 'outgoing'
      ? ((sentSats - receivedSats) / 1e8).toString()
      : (receivedSats / 1e8).toString();

    const firstSender =
      tx.vin?.[0]?.prevout?.scriptpubkey_address || 'unknown';
    const firstReceiver = tx.vout?.[0]?.scriptpubkey_address || 'unknown';

    results.push({
      txHash: tx.txid,
      chain: 'BTC',
      direction,
      amount,
      fromAddress: isOutgoing ? address : firstSender,
      toAddress: isOutgoing ? firstReceiver : address,
      status: tx.status?.confirmed ? 'confirmed' : 'pending',
      confirmations: tx.status?.confirmed ? 1 : 0,
      timestamp: tx.status?.block_time
        ? new Date(tx.status.block_time * 1000).toISOString()
        : new Date().toISOString(),
      fee: tx.fee ? (tx.fee / 1e8).toString() : undefined,
      blockNumber: tx.status?.block_height,
    });
  }

  return results;
}

// ──────────────────────────────────────────────
// BCH Indexer (Blockchair API)
// ──────────────────────────────────────────────

async function fetchBCHHistory(
  address: string
): Promise<IndexedTransaction[]> {
  // Strip "bitcoincash:" prefix if present for API compatibility
  const cleanAddr = address.startsWith('bitcoincash:')
    ? address.substring(12)
    : address;

  // Try fullstack.cash electrumx endpoint first (free, no key)
  try {
    const resp = await fetch(
      `https://api.fullstack.cash/v5/electrumx/transactions/${address}`
    );
    if (resp.ok) {
      const data: {
        success?: boolean;
        transactions?: Array<{
          tx_hash: string;
          height: number;
        }>;
      } = await resp.json();

      if (data.success && data.transactions) {
        const results: IndexedTransaction[] = [];
        for (const tx of data.transactions.slice(0, MAX_TXS)) {
          results.push({
            txHash: tx.tx_hash,
            chain: 'BCH',
            direction: 'incoming', // Can't determine without full tx details
            amount: '0', // Would need additional API call for amounts
            fromAddress: 'unknown',
            toAddress: address,
            status: tx.height > 0 ? 'confirmed' : 'pending',
            confirmations: tx.height > 0 ? 1 : 0,
            timestamp: new Date().toISOString(),
            blockNumber: tx.height > 0 ? tx.height : undefined,
          });
        }
        return results;
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TxIndexer] BCH fullstack.cash failed: ${msg}`);
  }

  // Fallback: Blockchair (limited free requests)
  try {
    const resp = await fetch(
      `https://api.blockchair.com/bitcoin-cash/dashboards/address/${cleanAddr}?limit=50`
    );
    if (resp.ok) {
      const data: {
        data?: Record<
          string,
          {
            transactions?: string[];
          }
        >;
      } = await resp.json();

      const addrData = data.data?.[cleanAddr];
      if (addrData?.transactions) {
        return addrData.transactions.slice(0, MAX_TXS).map(
          (txHash: string): IndexedTransaction => ({
            txHash,
            chain: 'BCH',
            direction: 'incoming',
            amount: '0',
            fromAddress: 'unknown',
            toAddress: address,
            status: 'confirmed',
            confirmations: 1,
            timestamp: new Date().toISOString(),
          })
        );
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TxIndexer] BCH blockchair failed: ${msg}`);
  }

  // If all APIs fail, return empty rather than throwing
  console.warn(`[TxIndexer] All BCH APIs failed for ${truncAddr(address)}`);
  return [];
}

// ──────────────────────────────────────────────
// EVM Native (ETH/POL) Indexer
// ──────────────────────────────────────────────

/**
 * Fetch native ETH/POL transaction history via block explorer API.
 * Fetches both normal transactions AND internal transactions (from contracts/exchanges).
 * Uses Etherscan V2 API (unified endpoint with chainid parameter).
 * Returns empty array if no API key configured.
 */
async function fetchNativeViaExplorer(
  address: string,
  chain: 'ETH' | 'POL'
): Promise<IndexedTransaction[]> {
  const apiKey = chain === 'POL'
    ? process.env.POLYGONSCAN_API_KEY
    : process.env.ETHERSCAN_API_KEY;

  if (!apiKey) {
    console.warn(`[TxIndexer] No ${chain === 'POL' ? 'POLYGONSCAN' : 'ETHERSCAN'}_API_KEY configured, skipping native tx fetch`);
    return [];
  }

  // Etherscan V2 API uses unified endpoint with chainid
  // chainid: 1 = Ethereum, 137 = Polygon
  const chainId = chain === 'POL' ? 137 : 1;
  const baseUrl = 'https://api.etherscan.io/v2/api';

  const results: IndexedTransaction[] = [];
  const addrLower = address.toLowerCase();
  const seenHashes = new Set<string>();

  // 1. Fetch normal transactions
  const normalUrl = `${baseUrl}?chainid=${chainId}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=${MAX_TXS}&sort=desc&apikey=${apiKey}`;

  try {
    const resp = await fetch(normalUrl);
    if (resp.ok) {
      const data: {
        status: string;
        message: string;
        result: Array<{
          hash: string;
          from: string;
          to: string;
          value: string;
          timeStamp: string;
          blockNumber: string;
          confirmations: string;
          isError: string;
          gasUsed: string;
          gasPrice: string;
        }>;
      } = await resp.json();

      if (data.status === '1' && Array.isArray(data.result)) {
        for (const tx of data.result) {
          if (tx.isError === '1') continue;
          const valueWei = BigInt(tx.value || '0');
          if (valueWei === BigInt(0)) continue;

          seenHashes.add(tx.hash.toLowerCase());
          const direction: 'incoming' | 'outgoing' =
            tx.to.toLowerCase() === addrLower ? 'incoming' : 'outgoing';
          const fee = BigInt(tx.gasUsed || '0') * BigInt(tx.gasPrice || '0');

          results.push({
            txHash: tx.hash,
            chain,
            direction,
            amount: formatWei(valueWei, 18),
            fromAddress: tx.from,
            toAddress: tx.to,
            status: parseInt(tx.confirmations || '0', 10) >= 12 ? 'confirmed' : 'pending',
            confirmations: parseInt(tx.confirmations || '0', 10),
            timestamp: new Date(parseInt(tx.timeStamp, 10) * 1000).toISOString(),
            fee: formatWei(fee, 18),
            blockNumber: parseInt(tx.blockNumber, 10),
          });
        }
      }
    }
  } catch (err: unknown) {
    console.error(`[TxIndexer] ${chain} normal txlist fetch failed:`, err);
  }

  // 2. Fetch internal transactions (deposits from exchanges/contracts)
  const internalUrl = `${baseUrl}?chainid=${chainId}&module=account&action=txlistinternal&address=${address}&startblock=0&endblock=99999999&page=1&offset=${MAX_TXS}&sort=desc&apikey=${apiKey}`;

  try {
    const resp = await fetch(internalUrl);
    if (resp.ok) {
      const data: {
        status: string;
        message: string;
        result: Array<{
          hash: string;
          from: string;
          to: string;
          value: string;
          timeStamp: string;
          blockNumber: string;
          isError: string;
          contractAddress?: string;
        }>;
      } = await resp.json();

      if (data.status === '1' && Array.isArray(data.result)) {
        for (const tx of data.result) {
          if (tx.isError === '1') continue;
          // Skip if we already have this tx from normal list
          if (seenHashes.has(tx.hash.toLowerCase())) continue;
          
          const valueWei = BigInt(tx.value || '0');
          if (valueWei === BigInt(0)) continue;

          const direction: 'incoming' | 'outgoing' =
            tx.to.toLowerCase() === addrLower ? 'incoming' : 'outgoing';

          results.push({
            txHash: tx.hash,
            chain,
            direction,
            amount: formatWei(valueWei, 18),
            fromAddress: tx.from,
            toAddress: tx.to,
            status: 'confirmed', // Internal txs are always confirmed
            confirmations: 1,
            timestamp: new Date(parseInt(tx.timeStamp, 10) * 1000).toISOString(),
            blockNumber: parseInt(tx.blockNumber, 10),
          });
        }
      }
    }
  } catch (err: unknown) {
    console.error(`[TxIndexer] ${chain} internal txlist fetch failed:`, err);
  }

  console.log(`[TxIndexer] ${chain} explorer: found ${results.length} native txs (incl. internal) for ${truncAddr(address)}`);
  return results.slice(0, MAX_TXS);
}

async function fetchEVMNativeHistory(
  address: string,
  rpcUrl: string,
  chain: 'ETH' | 'POL'
): Promise<IndexedTransaction[]> {
  const results: IndexedTransaction[] = [];

  // 1. Fetch native transfers via explorer API (Polygonscan/Etherscan)
  const nativeTxs = await fetchNativeViaExplorer(address, chain);
  results.push(...nativeTxs);

  // 2. Also fetch ERC-20 transfers via eth_getLogs (for token transfers)
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
    // If RPC fails but we have explorer results, return those
    if (results.length > 0) return results.slice(0, MAX_TXS);
    throw new Error(`${chain} block number fetch failed: ${blockResp.status}`);
  }

  const blockData: { result?: string; error?: { message: string } } =
    await blockResp.json();
  if (blockData.error) {
    if (results.length > 0) return results.slice(0, MAX_TXS);
    throw new Error(`${chain} RPC error: ${blockData.error.message}`);
  }

  const latestBlock = parseInt(blockData.result || '0x0', 16);
  const fromBlock = Math.max(0, latestBlock - 5000);
  const paddedAddress =
    '0x' + address.toLowerCase().replace('0x', '').padStart(64, '0');

  // Incoming token transfers (ERC-20)
  const incomingResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getLogs',
      params: [
        {
          fromBlock: '0x' + fromBlock.toString(16),
          toBlock: 'latest',
          topics: [TRANSFER_TOPIC, null, paddedAddress],
        },
      ],
      id: 2,
    }),
  });

  if (incomingResp.ok) {
    const inData: {
      result?: Array<{
        transactionHash: string;
        topics?: string[];
        data?: string;
        blockNumber?: string;
      }>;
      error?: { message: string };
    } = await incomingResp.json();

    if (inData.result) {
      for (const log of inData.result.slice(0, MAX_TXS)) {
        // Skip if we already have this tx from explorer (native tx)
        if (results.some((r) => r.txHash === log.transactionHash)) continue;

        const fromAddr = '0x' + (log.topics?.[1] || '').slice(26);
        const rawAmount = BigInt(log.data || '0x0');
        const blockNum = parseInt(log.blockNumber || '0x0', 16);
        const confirmations = latestBlock - blockNum;

        results.push({
          txHash: log.transactionHash,
          chain,
          direction: 'incoming',
          amount: formatWei(rawAmount, 18),
          fromAddress: fromAddr,
          toAddress: address,
          status: confirmations >= 12 ? 'confirmed' : 'pending',
          confirmations,
          timestamp: new Date().toISOString(),
          blockNumber: blockNum,
        });
      }
    }
  }

  // Outgoing token transfers (ERC-20)
  const outgoingResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getLogs',
      params: [
        {
          fromBlock: '0x' + fromBlock.toString(16),
          toBlock: 'latest',
          topics: [TRANSFER_TOPIC, paddedAddress, null],
        },
      ],
      id: 3,
    }),
  });

  if (outgoingResp.ok) {
    const outData: {
      result?: Array<{
        transactionHash: string;
        topics?: string[];
        data?: string;
        blockNumber?: string;
      }>;
    } = await outgoingResp.json();

    if (outData.result) {
      for (const log of outData.result.slice(0, MAX_TXS)) {
        // Skip duplicates
        if (results.some((r) => r.txHash === log.transactionHash)) continue;

        const toAddr = '0x' + (log.topics?.[2] || '').slice(26);
        const rawAmount = BigInt(log.data || '0x0');
        const blockNum = parseInt(log.blockNumber || '0x0', 16);
        const confirmations = latestBlock - blockNum;

        results.push({
          txHash: log.transactionHash,
          chain,
          direction: 'outgoing',
          amount: formatWei(rawAmount, 18),
          fromAddress: address,
          toAddress: toAddr,
          status: confirmations >= 12 ? 'confirmed' : 'pending',
          confirmations,
          timestamp: new Date().toISOString(),
          blockNumber: blockNum,
        });
      }
    }
  }

  return results.slice(0, MAX_TXS);
}

// ──────────────────────────────────────────────
// EVM USDC (ERC-20) Indexer
// ──────────────────────────────────────────────

async function fetchEVMUSDCHistory(
  address: string,
  rpcUrl: string,
  chain: 'USDC_ETH' | 'USDC_POL'
): Promise<IndexedTransaction[]> {
  const contractAddress = USDC_CONTRACTS[chain];
  if (!contractAddress) return [];

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
    throw new Error(
      `${chain} block number fetch failed: ${blockResp.status}`
    );
  }

  const blockData: { result?: string; error?: { message: string } } =
    await blockResp.json();
  if (blockData.error) {
    throw new Error(`${chain} RPC error: ${blockData.error.message}`);
  }

  const latestBlock = parseInt(blockData.result || '0x0', 16);
  const fromBlock = Math.max(0, latestBlock - 5000);
  const paddedAddress =
    '0x' + address.toLowerCase().replace('0x', '').padStart(64, '0');
  const results: IndexedTransaction[] = [];

  // Incoming USDC transfers
  const inResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getLogs',
      params: [
        {
          fromBlock: '0x' + fromBlock.toString(16),
          toBlock: 'latest',
          address: contractAddress,
          topics: [TRANSFER_TOPIC, null, paddedAddress],
        },
      ],
      id: 2,
    }),
  });

  if (inResp.ok) {
    const inData: {
      result?: Array<{
        transactionHash: string;
        topics?: string[];
        data?: string;
        blockNumber?: string;
      }>;
    } = await inResp.json();

    for (const log of (inData.result || []).slice(0, MAX_TXS)) {
      const fromAddr = '0x' + (log.topics?.[1] || '').slice(26);
      const rawAmount = BigInt(log.data || '0x0');
      const blockNum = parseInt(log.blockNumber || '0x0', 16);
      const confirmations = latestBlock - blockNum;

      results.push({
        txHash: log.transactionHash,
        chain,
        direction: 'incoming',
        amount: formatWei(rawAmount, 6), // USDC has 6 decimals
        fromAddress: fromAddr,
        toAddress: address,
        status: confirmations >= 12 ? 'confirmed' : 'pending',
        confirmations,
        timestamp: new Date().toISOString(),
        blockNumber: blockNum,
      });
    }
  }

  // Outgoing USDC transfers
  const outResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getLogs',
      params: [
        {
          fromBlock: '0x' + fromBlock.toString(16),
          toBlock: 'latest',
          address: contractAddress,
          topics: [TRANSFER_TOPIC, paddedAddress, null],
        },
      ],
      id: 3,
    }),
  });

  if (outResp.ok) {
    const outData: {
      result?: Array<{
        transactionHash: string;
        topics?: string[];
        data?: string;
        blockNumber?: string;
      }>;
    } = await outResp.json();

    for (const log of (outData.result || []).slice(0, MAX_TXS)) {
      const toAddr = '0x' + (log.topics?.[2] || '').slice(26);
      const rawAmount = BigInt(log.data || '0x0');
      const blockNum = parseInt(log.blockNumber || '0x0', 16);
      const confirmations = latestBlock - blockNum;

      if (!results.some((r) => r.txHash === log.transactionHash)) {
        results.push({
          txHash: log.transactionHash,
          chain,
          direction: 'outgoing',
          amount: formatWei(rawAmount, 6),
          fromAddress: address,
          toAddress: toAddr,
          status: confirmations >= 12 ? 'confirmed' : 'pending',
          confirmations,
          timestamp: new Date().toISOString(),
          blockNumber: blockNum,
        });
      }
    }
  }

  return results.slice(0, MAX_TXS);
}

// ──────────────────────────────────────────────
// SOL Indexer (Solana RPC)
// ──────────────────────────────────────────────

async function fetchSOLHistory(
  address: string,
  rpcUrl: string
): Promise<IndexedTransaction[]> {
  // Step 1: Get recent signatures
  const sigResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'getSignaturesForAddress',
      params: [address, { limit: MAX_TXS }],
      id: 1,
    }),
  });

  if (!sigResp.ok) {
    throw new Error(`SOL signatures fetch failed: ${sigResp.status}`);
  }

  const sigData: {
    result?: Array<{
      signature: string;
      slot: number;
      blockTime?: number;
      confirmationStatus?: string;
      err?: unknown;
    }>;
    error?: { message: string };
  } = await sigResp.json();

  if (sigData.error) {
    throw new Error(`SOL RPC error: ${sigData.error.message}`);
  }

  const signatures = sigData.result || [];
  const results: IndexedTransaction[] = [];

  // Step 2: Fetch transaction details in small batches to avoid rate limiting
  const batchSize = 5;
  for (let i = 0; i < Math.min(signatures.length, MAX_TXS); i += batchSize) {
    const batch = signatures.slice(i, i + batchSize);
    const detailPromises = batch.map(async (sig) => {
      try {
        const txResp = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'getTransaction',
            params: [
              sig.signature,
              { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
            ],
            id: 1,
          }),
        });

        if (!txResp.ok) return null;

        const txData: {
          result?: {
            meta?: {
              fee?: number;
              preBalances?: number[];
              postBalances?: number[];
              err?: unknown;
            };
            transaction?: {
              message?: {
                accountKeys?: Array<{
                  pubkey?: string;
                }>;
              };
            };
          };
        } = await txResp.json();

        if (!txData.result?.meta || !txData.result?.transaction) return null;

        const meta = txData.result.meta;
        const accountKeys =
          txData.result.transaction.message?.accountKeys || [];

        // Find our account index
        const ourIndex = accountKeys.findIndex(
          (key) => key.pubkey === address
        );

        if (ourIndex === -1) return null;

        const preBalance = meta.preBalances?.[ourIndex] || 0;
        const postBalance = meta.postBalances?.[ourIndex] || 0;
        const diff = postBalance - preBalance;
        const direction: 'incoming' | 'outgoing' =
          diff >= 0 ? 'incoming' : 'outgoing';

        const amountLamports = Math.abs(diff);
        const amount = (amountLamports / 1e9).toString();

        // Determine from/to
        const firstAccount = accountKeys[0]?.pubkey || 'unknown';
        const fromAddr = direction === 'outgoing' ? address : firstAccount;
        const toAddr = direction === 'incoming' ? address : firstAccount;

        return {
          txHash: sig.signature,
          chain: 'SOL' as WalletChain,
          direction,
          amount,
          fromAddress: fromAddr,
          toAddress: toAddr,
          status:
            sig.confirmationStatus === 'finalized'
              ? ('confirmed' as const)
              : ('pending' as const),
          confirmations:
            sig.confirmationStatus === 'finalized' ? 32 : 0,
          timestamp: sig.blockTime
            ? new Date(sig.blockTime * 1000).toISOString()
            : new Date().toISOString(),
          fee: meta.fee ? (meta.fee / 1e9).toString() : undefined,
          blockNumber: sig.slot,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[TxIndexer] SOL tx detail fetch failed for ${sig.signature}: ${msg}`
        );
        return null;
      }
    });

    const batchResults = await Promise.allSettled(detailPromises);
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(r.value);
      }
    }
  }

  // For signatures we couldn't get details for, add basic entry
  for (const sig of signatures) {
    if (!results.some((r) => r.txHash === sig.signature)) {
      results.push({
        txHash: sig.signature,
        chain: 'SOL',
        direction: 'incoming',
        amount: '0',
        fromAddress: 'unknown',
        toAddress: address,
        status:
          sig.confirmationStatus === 'finalized' ? 'confirmed' : 'pending',
        confirmations: sig.confirmationStatus === 'finalized' ? 32 : 0,
        timestamp: sig.blockTime
          ? new Date(sig.blockTime * 1000).toISOString()
          : new Date().toISOString(),
        blockNumber: sig.slot,
      });
    }
  }

  return results.slice(0, MAX_TXS);
}

// ──────────────────────────────────────────────
// USDC on SOL Indexer (SPL Token transfers)
// ──────────────────────────────────────────────

async function fetchUSDCSOLHistory(
  address: string,
  rpcUrl: string
): Promise<IndexedTransaction[]> {
  // Use getSignaturesForAddress and filter for USDC token program interactions
  // For simplicity, we reuse SOL signatures and look for token transfers
  const sigResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'getSignaturesForAddress',
      params: [address, { limit: MAX_TXS }],
      id: 1,
    }),
  });

  if (!sigResp.ok) {
    throw new Error(`USDC_SOL signatures fetch failed: ${sigResp.status}`);
  }

  const sigData: {
    result?: Array<{
      signature: string;
      slot: number;
      blockTime?: number;
      confirmationStatus?: string;
      err?: unknown;
    }>;
    error?: { message: string };
  } = await sigResp.json();

  if (sigData.error) {
    throw new Error(`SOL RPC error: ${sigData.error.message}`);
  }

  const signatures = sigData.result || [];
  const results: IndexedTransaction[] = [];

  // Fetch transaction details and filter for USDC transfers
  const batchSize = 5;
  for (let i = 0; i < Math.min(signatures.length, MAX_TXS); i += batchSize) {
    const batch = signatures.slice(i, i + batchSize);
    const detailPromises = batch.map(async (sig) => {
      try {
        const txResp = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'getTransaction',
            params: [
              sig.signature,
              { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
            ],
            id: 1,
          }),
        });

        if (!txResp.ok) return null;

        // Response shape for parsed Solana transactions
        const txData: {
          result?: {
            meta?: {
              preTokenBalances?: Array<{
                mint?: string;
                owner?: string;
                uiTokenAmount?: { uiAmount?: number };
              }>;
              postTokenBalances?: Array<{
                mint?: string;
                owner?: string;
                uiTokenAmount?: { uiAmount?: number };
              }>;
            };
          };
        } = await txResp.json();

        if (!txData.result?.meta) return null;

        const meta = txData.result.meta;

        // Look for USDC mint changes
        const preUSDC = meta.preTokenBalances?.find(
          (b) => b.mint === USDC_SOL_MINT && b.owner === address
        );
        const postUSDC = meta.postTokenBalances?.find(
          (b) => b.mint === USDC_SOL_MINT && b.owner === address
        );

        if (!preUSDC && !postUSDC) return null; // Not a USDC tx for this address

        const preBal = preUSDC?.uiTokenAmount?.uiAmount || 0;
        const postBal = postUSDC?.uiTokenAmount?.uiAmount || 0;
        const diff = postBal - preBal;

        if (Math.abs(diff) < 0.000001) return null; // No meaningful change

        const direction: 'incoming' | 'outgoing' =
          diff > 0 ? 'incoming' : 'outgoing';

        return {
          txHash: sig.signature,
          chain: 'USDC_SOL' as WalletChain,
          direction,
          amount: Math.abs(diff).toString(),
          fromAddress: direction === 'outgoing' ? address : 'unknown',
          toAddress: direction === 'incoming' ? address : 'unknown',
          status:
            sig.confirmationStatus === 'finalized'
              ? ('confirmed' as const)
              : ('pending' as const),
          confirmations:
            sig.confirmationStatus === 'finalized' ? 32 : 0,
          timestamp: sig.blockTime
            ? new Date(sig.blockTime * 1000).toISOString()
            : new Date().toISOString(),
          blockNumber: sig.slot,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[TxIndexer] USDC_SOL tx detail fetch failed for ${sig.signature}: ${msg}`
        );
        return null;
      }
    });

    const batchResults = await Promise.allSettled(detailPromises);
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(r.value);
      }
    }
  }

  return results.slice(0, MAX_TXS);
}

// ──────────────────────────────────────────────
// DOGE Indexer (Blockcypher API - free, no key needed)
// ──────────────────────────────────────────────

async function fetchDOGEHistory(address: string): Promise<IndexedTransaction[]> {
  try {
    const resp = await fetch(
      `https://api.blockcypher.com/v1/doge/main/addrs/${address}/full?limit=${MAX_TXS}`
    );
    
    if (!resp.ok) {
      // Try fallback: dogechain.info
      return fetchDOGEHistoryFallback(address);
    }

    const data: {
      txs?: Array<{
        hash: string;
        confirmed?: string;
        received: string;
        total: number;
        fees: number;
        inputs: Array<{ addresses?: string[]; output_value?: number }>;
        outputs: Array<{ addresses?: string[]; value?: number }>;
        block_height?: number;
        confirmations?: number;
      }>;
    } = await resp.json();

    const results: IndexedTransaction[] = [];
    const addrLower = address.toLowerCase();

    for (const tx of data.txs || []) {
      const isOutgoing = tx.inputs?.some((i) =>
        i.addresses?.some((a) => a.toLowerCase() === addrLower)
      );
      
      let amount = 0;
      if (isOutgoing) {
        // Sum outputs NOT to us
        for (const out of tx.outputs || []) {
          if (!out.addresses?.some((a) => a.toLowerCase() === addrLower)) {
            amount += out.value || 0;
          }
        }
      } else {
        // Sum outputs TO us
        for (const out of tx.outputs || []) {
          if (out.addresses?.some((a) => a.toLowerCase() === addrLower)) {
            amount += out.value || 0;
          }
        }
      }

      results.push({
        txHash: tx.hash,
        chain: 'DOGE',
        direction: isOutgoing ? 'outgoing' : 'incoming',
        amount: (amount / 1e8).toString(),
        fromAddress: isOutgoing ? address : (tx.inputs?.[0]?.addresses?.[0] || 'unknown'),
        toAddress: isOutgoing ? (tx.outputs?.[0]?.addresses?.[0] || 'unknown') : address,
        status: (tx.confirmations || 0) >= 6 ? 'confirmed' : 'pending',
        confirmations: tx.confirmations || 0,
        timestamp: tx.confirmed || tx.received || new Date().toISOString(),
        fee: (tx.fees / 1e8).toString(),
        blockNumber: tx.block_height,
      });
    }

    return results;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TxIndexer] DOGE fetch failed: ${msg}`);
    return [];
  }
}

async function fetchDOGEHistoryFallback(address: string): Promise<IndexedTransaction[]> {
  try {
    const resp = await fetch(`https://dogechain.info/api/v1/address/transactions/${address}`);
    if (!resp.ok) return [];

    const data: {
      transactions?: Array<{
        hash: string;
        time: number;
        value: string;
        confirmations?: number;
      }>;
    } = await resp.json();

    return (data.transactions || []).slice(0, MAX_TXS).map((tx): IndexedTransaction => ({
      txHash: tx.hash,
      chain: 'DOGE',
      direction: parseFloat(tx.value) >= 0 ? 'incoming' : 'outgoing',
      amount: Math.abs(parseFloat(tx.value)).toString(),
      fromAddress: 'unknown',
      toAddress: address,
      status: (tx.confirmations || 0) >= 6 ? 'confirmed' : 'pending',
      confirmations: tx.confirmations || 0,
      timestamp: new Date(tx.time * 1000).toISOString(),
    }));
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────
// XRP Indexer (XRPL Data API - free, no key needed)
// ──────────────────────────────────────────────

async function fetchXRPHistory(address: string): Promise<IndexedTransaction[]> {
  try {
    // Use XRPL public API
    const resp = await fetch('https://s1.ripple.com:51234/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'account_tx',
        params: [{
          account: address,
          limit: MAX_TXS,
          ledger_index_min: -1,
          ledger_index_max: -1,
        }],
      }),
    });

    if (!resp.ok) {
      throw new Error(`XRP API failed: ${resp.status}`);
    }

    const data: {
      result?: {
        transactions?: Array<{
          tx: {
            hash: string;
            TransactionType: string;
            Account: string;
            Destination?: string;
            Amount?: string | { value: string };
            Fee?: string;
            date?: number;
          };
          meta?: {
            delivered_amount?: string | { value: string };
          };
          validated?: boolean;
        }>;
        status?: string;
      };
    } = await resp.json();

    if (data.result?.status !== 'success') {
      return [];
    }

    const results: IndexedTransaction[] = [];

    for (const entry of data.result.transactions || []) {
      const tx = entry.tx;
      if (tx.TransactionType !== 'Payment') continue;

      const isOutgoing = tx.Account === address;
      
      // Amount can be string (drops) or object (for issued currencies)
      let amount = '0';
      const rawAmount = entry.meta?.delivered_amount || tx.Amount;
      if (typeof rawAmount === 'string') {
        amount = (parseInt(rawAmount, 10) / 1e6).toString();
      } else if (rawAmount?.value) {
        amount = rawAmount.value;
      }

      // XRP epoch starts from 2000-01-01
      const xrpEpoch = 946684800;
      const timestamp = tx.date
        ? new Date((tx.date + xrpEpoch) * 1000).toISOString()
        : new Date().toISOString();

      results.push({
        txHash: tx.hash,
        chain: 'XRP',
        direction: isOutgoing ? 'outgoing' : 'incoming',
        amount,
        fromAddress: tx.Account,
        toAddress: tx.Destination || 'unknown',
        status: entry.validated ? 'confirmed' : 'pending',
        confirmations: entry.validated ? 1 : 0,
        timestamp,
        fee: tx.Fee ? (parseInt(tx.Fee, 10) / 1e6).toString() : undefined,
      });
    }

    return results;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TxIndexer] XRP fetch failed: ${msg}`);
    return [];
  }
}

// ──────────────────────────────────────────────
// ADA (Cardano) Indexer - Blockfrost API (needs key)
// ──────────────────────────────────────────────

async function fetchADAHistory(address: string): Promise<IndexedTransaction[]> {
  const apiKey = process.env.BLOCKFROST_API_KEY;
  
  if (!apiKey) {
    console.warn('[TxIndexer] BLOCKFROST_API_KEY not set, skipping ADA history');
    return [];
  }

  try {
    // Get address transactions
    const resp = await fetch(
      `https://cardano-mainnet.blockfrost.io/api/v0/addresses/${address}/transactions?order=desc&count=${MAX_TXS}`,
      {
        headers: { project_id: apiKey },
      }
    );

    if (!resp.ok) {
      if (resp.status === 404) return []; // Address not found / no txs
      throw new Error(`Blockfrost API failed: ${resp.status}`);
    }

    const txList: Array<{
      tx_hash: string;
      block_time: number;
    }> = await resp.json();

    const results: IndexedTransaction[] = [];

    // Fetch details for each transaction (batched)
    for (const txRef of txList.slice(0, 20)) { // Limit to avoid rate limits
      try {
        const [txResp, utxoResp] = await Promise.all([
          fetch(`https://cardano-mainnet.blockfrost.io/api/v0/txs/${txRef.tx_hash}`, {
            headers: { project_id: apiKey },
          }),
          fetch(`https://cardano-mainnet.blockfrost.io/api/v0/txs/${txRef.tx_hash}/utxos`, {
            headers: { project_id: apiKey },
          }),
        ]);

        if (!txResp.ok || !utxoResp.ok) continue;

        const txData: { fees: string; block_height: number } = await txResp.json();
        const utxoData: {
          inputs: Array<{ address: string; amount: Array<{ unit: string; quantity: string }> }>;
          outputs: Array<{ address: string; amount: Array<{ unit: string; quantity: string }> }>;
        } = await utxoResp.json();

        const isOutgoing = utxoData.inputs.some((i) => i.address === address);
        
        // Calculate ADA amount (lovelace)
        let amount = BigInt(0);
        if (isOutgoing) {
          for (const out of utxoData.outputs) {
            if (out.address !== address) {
              const lovelace = out.amount.find((a) => a.unit === 'lovelace');
              if (lovelace) amount += BigInt(lovelace.quantity);
            }
          }
        } else {
          for (const out of utxoData.outputs) {
            if (out.address === address) {
              const lovelace = out.amount.find((a) => a.unit === 'lovelace');
              if (lovelace) amount += BigInt(lovelace.quantity);
            }
          }
        }

        results.push({
          txHash: txRef.tx_hash,
          chain: 'ADA',
          direction: isOutgoing ? 'outgoing' : 'incoming',
          amount: (Number(amount) / 1e6).toString(),
          fromAddress: isOutgoing ? address : (utxoData.inputs[0]?.address || 'unknown'),
          toAddress: isOutgoing ? (utxoData.outputs[0]?.address || 'unknown') : address,
          status: 'confirmed',
          confirmations: 1,
          timestamp: new Date(txRef.block_time * 1000).toISOString(),
          fee: (parseInt(txData.fees, 10) / 1e6).toString(),
          blockNumber: txData.block_height,
        });
      } catch {
        // Skip failed tx lookups
      }
    }

    return results;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TxIndexer] ADA fetch failed: ${msg}`);
    return [];
  }
}

// ──────────────────────────────────────────────
// BNB (BSC) Indexer - Same pattern as ETH/POL
// ──────────────────────────────────────────────

async function fetchBNBHistory(
  address: string,
  rpcUrl: string
): Promise<IndexedTransaction[]> {
  const results: IndexedTransaction[] = [];

  // 1. Fetch native BNB transfers via BscScan API
  const apiKey = process.env.BSCSCAN_API_KEY;
  if (apiKey) {
    const url = `${EXPLORER_APIS.BNB}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=${MAX_TXS}&sort=desc&apikey=${apiKey}`;
    
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const data: {
          status: string;
          result: Array<{
            hash: string;
            from: string;
            to: string;
            value: string;
            timeStamp: string;
            blockNumber: string;
            confirmations: string;
            isError: string;
            gasUsed: string;
            gasPrice: string;
          }>;
        } = await resp.json();

        if (data.status === '1' && Array.isArray(data.result)) {
          const addrLower = address.toLowerCase();
          for (const tx of data.result) {
            if (tx.isError === '1') continue;
            const valueWei = BigInt(tx.value || '0');
            if (valueWei === BigInt(0)) continue;

            const direction: 'incoming' | 'outgoing' =
              tx.to.toLowerCase() === addrLower ? 'incoming' : 'outgoing';
            const fee = BigInt(tx.gasUsed || '0') * BigInt(tx.gasPrice || '0');

            results.push({
              txHash: tx.hash,
              chain: 'BNB',
              direction,
              amount: formatWei(valueWei, 18),
              fromAddress: tx.from,
              toAddress: tx.to,
              status: parseInt(tx.confirmations || '0', 10) >= 12 ? 'confirmed' : 'pending',
              confirmations: parseInt(tx.confirmations || '0', 10),
              timestamp: new Date(parseInt(tx.timeStamp, 10) * 1000).toISOString(),
              fee: formatWei(fee, 18),
              blockNumber: parseInt(tx.blockNumber, 10),
            });
          }
        }
      }
    } catch (err: unknown) {
      console.error(`[TxIndexer] BNB explorer fetch failed: ${err}`);
    }
  }

  // 2. Also fetch BEP-20 token transfers via eth_getLogs
  try {
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

    if (blockResp.ok) {
      const blockData: { result?: string } = await blockResp.json();
      const latestBlock = parseInt(blockData.result || '0x0', 16);
      const fromBlock = Math.max(0, latestBlock - 5000);
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
            topics: [TRANSFER_TOPIC, null, paddedAddress],
          }],
          id: 2,
        }),
      });

      if (logsResp.ok) {
        const logsData: { result?: Array<{ transactionHash: string; topics?: string[]; data?: string; blockNumber?: string }> } = await logsResp.json();
        for (const log of (logsData.result || []).slice(0, MAX_TXS)) {
          if (results.some((r) => r.txHash === log.transactionHash)) continue;
          const fromAddr = '0x' + (log.topics?.[1] || '').slice(26);
          const rawAmount = BigInt(log.data || '0x0');
          const blockNum = parseInt(log.blockNumber || '0x0', 16);
          results.push({
            txHash: log.transactionHash,
            chain: 'BNB',
            direction: 'incoming',
            amount: formatWei(rawAmount, 18),
            fromAddress: fromAddr,
            toAddress: address,
            status: (latestBlock - blockNum) >= 12 ? 'confirmed' : 'pending',
            confirmations: latestBlock - blockNum,
            timestamp: new Date().toISOString(),
            blockNumber: blockNum,
          });
        }
      }
    }
  } catch {
    // RPC errors are non-fatal if we got explorer results
  }

  return results.slice(0, MAX_TXS);
}

// ──────────────────────────────────────────────
// USDT Indexers (same pattern as USDC)
// ──────────────────────────────────────────────

async function fetchUSDTEVMHistory(
  address: string,
  rpcUrl: string,
  chain: 'USDT_ETH' | 'USDT_POL'
): Promise<IndexedTransaction[]> {
  const contractAddress = USDT_CONTRACTS[chain];
  if (!contractAddress) return [];

  const baseChain = chain.replace('USDT_', '') as 'ETH' | 'POL';

  try {
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

    if (!blockResp.ok) return [];

    const blockData: { result?: string; error?: { message: string } } = await blockResp.json();
    if (blockData.error) return [];

    const latestBlock = parseInt(blockData.result || '0x0', 16);
    const fromBlock = Math.max(0, latestBlock - 5000);
    const paddedAddress = '0x' + address.toLowerCase().replace('0x', '').padStart(64, '0');
    const results: IndexedTransaction[] = [];

    // Incoming USDT transfers
    const inResp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getLogs',
        params: [{
          fromBlock: '0x' + fromBlock.toString(16),
          toBlock: 'latest',
          address: contractAddress,
          topics: [TRANSFER_TOPIC, null, paddedAddress],
        }],
        id: 2,
      }),
    });

    if (inResp.ok) {
      const inData: { result?: Array<{ transactionHash: string; topics?: string[]; data?: string; blockNumber?: string }> } = await inResp.json();
      for (const log of (inData.result || []).slice(0, MAX_TXS)) {
        const fromAddr = '0x' + (log.topics?.[1] || '').slice(26);
        const rawAmount = BigInt(log.data || '0x0');
        const blockNum = parseInt(log.blockNumber || '0x0', 16);
        const confirmations = latestBlock - blockNum;

        results.push({
          txHash: log.transactionHash,
          chain,
          direction: 'incoming',
          amount: formatWei(rawAmount, 6), // USDT has 6 decimals
          fromAddress: fromAddr,
          toAddress: address,
          status: confirmations >= 12 ? 'confirmed' : 'pending',
          confirmations,
          timestamp: new Date().toISOString(),
          blockNumber: blockNum,
        });
      }
    }

    // Outgoing USDT transfers
    const outResp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getLogs',
        params: [{
          fromBlock: '0x' + fromBlock.toString(16),
          toBlock: 'latest',
          address: contractAddress,
          topics: [TRANSFER_TOPIC, paddedAddress, null],
        }],
        id: 3,
      }),
    });

    if (outResp.ok) {
      const outData: { result?: Array<{ transactionHash: string; topics?: string[]; data?: string; blockNumber?: string }> } = await outResp.json();
      for (const log of (outData.result || []).slice(0, MAX_TXS)) {
        if (results.some((r) => r.txHash === log.transactionHash)) continue;
        const toAddr = '0x' + (log.topics?.[2] || '').slice(26);
        const rawAmount = BigInt(log.data || '0x0');
        const blockNum = parseInt(log.blockNumber || '0x0', 16);
        const confirmations = latestBlock - blockNum;

        results.push({
          txHash: log.transactionHash,
          chain,
          direction: 'outgoing',
          amount: formatWei(rawAmount, 6),
          fromAddress: address,
          toAddress: toAddr,
          status: confirmations >= 12 ? 'confirmed' : 'pending',
          confirmations,
          timestamp: new Date().toISOString(),
          blockNumber: blockNum,
        });
      }
    }

    return results.slice(0, MAX_TXS);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TxIndexer] ${chain} fetch failed: ${msg}`);
    return [];
  }
}

async function fetchUSDTSOLHistory(
  address: string,
  rpcUrl: string
): Promise<IndexedTransaction[]> {
  // Same pattern as USDC_SOL but with USDT mint
  try {
    const sigResp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'getSignaturesForAddress',
        params: [address, { limit: MAX_TXS }],
        id: 1,
      }),
    });

    if (!sigResp.ok) return [];

    const sigData: {
      result?: Array<{
        signature: string;
        slot: number;
        blockTime?: number;
        confirmationStatus?: string;
      }>;
      error?: { message: string };
    } = await sigResp.json();

    if (sigData.error) return [];

    const signatures = sigData.result || [];
    const results: IndexedTransaction[] = [];

    const batchSize = 5;
    for (let i = 0; i < Math.min(signatures.length, MAX_TXS); i += batchSize) {
      const batch = signatures.slice(i, i + batchSize);
      const detailPromises = batch.map(async (sig) => {
        try {
          const txResp = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'getTransaction',
              params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
              id: 1,
            }),
          });

          if (!txResp.ok) return null;

          const txData: {
            result?: {
              meta?: {
                preTokenBalances?: Array<{ mint?: string; owner?: string; uiTokenAmount?: { uiAmount?: number } }>;
                postTokenBalances?: Array<{ mint?: string; owner?: string; uiTokenAmount?: { uiAmount?: number } }>;
              };
            };
          } = await txResp.json();

          if (!txData.result?.meta) return null;

          const meta = txData.result.meta;
          const preUSDT = meta.preTokenBalances?.find((b) => b.mint === USDT_SOL_MINT && b.owner === address);
          const postUSDT = meta.postTokenBalances?.find((b) => b.mint === USDT_SOL_MINT && b.owner === address);

          if (!preUSDT && !postUSDT) return null;

          const preBal = preUSDT?.uiTokenAmount?.uiAmount || 0;
          const postBal = postUSDT?.uiTokenAmount?.uiAmount || 0;
          const diff = postBal - preBal;

          if (Math.abs(diff) < 0.000001) return null;

          return {
            txHash: sig.signature,
            chain: 'USDT_SOL' as WalletChain,
            direction: (diff > 0 ? 'incoming' : 'outgoing') as 'incoming' | 'outgoing',
            amount: Math.abs(diff).toString(),
            fromAddress: diff > 0 ? 'unknown' : address,
            toAddress: diff > 0 ? address : 'unknown',
            status: (sig.confirmationStatus === 'finalized' ? 'confirmed' : 'pending') as 'confirmed' | 'pending',
            confirmations: sig.confirmationStatus === 'finalized' ? 32 : 0,
            timestamp: sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : new Date().toISOString(),
            blockNumber: sig.slot,
          };
        } catch {
          return null;
        }
      });

      const batchResults = await Promise.allSettled(detailPromises);
      for (const r of batchResults) {
        if (r.status === 'fulfilled' && r.value) {
          results.push(r.value);
        }
      }
    }

    return results.slice(0, MAX_TXS);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TxIndexer] USDT_SOL fetch failed: ${msg}`);
    return [];
  }
}

// ──────────────────────────────────────────────
// Unified Indexer
// ──────────────────────────────────────────────

/**
 * Fetch on-chain transaction history for a given address and chain.
 * Returns a normalized list of IndexedTransaction.
 */
export async function fetchOnChainHistory(
  address: string,
  chain: WalletChain
): Promise<IndexedTransaction[]> {
  console.log(
    `[TxIndexer] Fetching on-chain history for ${chain} ${truncAddr(address)}`
  );
  const rpc = getRpcEndpoints();

  switch (chain) {
    case 'BTC':
      return fetchBTCHistory(address);
    case 'BCH':
      return fetchBCHHistory(address);
    case 'ETH':
      return fetchEVMNativeHistory(address, rpc.ETH, 'ETH');
    case 'POL':
      return fetchEVMNativeHistory(address, rpc.POL, 'POL');
    case 'SOL':
      return fetchSOLHistory(address, rpc.SOL);
    case 'DOGE':
      return fetchDOGEHistory(address);
    case 'XRP':
      return fetchXRPHistory(address);
    case 'ADA':
      return fetchADAHistory(address);
    case 'BNB':
      return fetchBNBHistory(address, rpc.BNB);
    case 'USDC_ETH':
      return fetchEVMUSDCHistory(address, rpc.ETH, 'USDC_ETH');
    case 'USDC_POL':
      return fetchEVMUSDCHistory(address, rpc.POL, 'USDC_POL');
    case 'USDC_SOL':
      return fetchUSDCSOLHistory(address, rpc.SOL);
    case 'USDT_ETH':
      return fetchUSDTEVMHistory(address, rpc.ETH, 'USDT_ETH');
    case 'USDT_POL':
      return fetchUSDTEVMHistory(address, rpc.POL, 'USDT_POL');
    case 'USDT_SOL':
      return fetchUSDTSOLHistory(address, rpc.SOL);
    default:
      return [];
  }
}

// ──────────────────────────────────────────────
// Sync to Database
// ──────────────────────────────────────────────

/**
 * Sync on-chain history for a wallet address into wallet_transactions.
 * Uses ON CONFLICT (chain, tx_hash) DO NOTHING to avoid duplicates.
 * Marks indexed transactions with metadata: { source: 'indexer' }.
 */
export async function syncAddressHistory(
  supabase: SupabaseClient,
  walletId: string,
  addressId: string,
  address: string,
  chain: WalletChain
): Promise<SyncResult> {
  const result: SyncResult = {
    newTransactions: 0,
    chain,
    address,
    errors: [],
  };

  let indexed: IndexedTransaction[];
  try {
    indexed = await fetchOnChainHistory(address, chain);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[TxIndexer] Failed to fetch history for ${chain} ${truncAddr(address)}: ${msg}`
    );
    result.errors.push(msg);
    return result;
  }

  if (indexed.length === 0) {
    return result;
  }

  console.log(
    `[TxIndexer] Found ${indexed.length} on-chain txs for ${chain} ${truncAddr(address)}`,
    indexed.length > 0 ? `(first: ${indexed[0].txHash.slice(0, 16)}...)` : ''
  );

  // Upsert each transaction
  for (const tx of indexed) {
    try {
      const direction: 'incoming' | 'outgoing' =
        tx.toAddress.toLowerCase() === address.toLowerCase()
          ? 'incoming'
          : 'outgoing';

      const record = {
        wallet_id: walletId,
        address_id: addressId,
        chain: tx.chain,
        tx_hash: tx.txHash,
        direction,
        status: tx.status === 'confirmed' ? 'confirmed' : 'pending',
        amount: parseFloat(tx.amount) || 0,
        from_address: tx.fromAddress,
        to_address: tx.toAddress,
        fee_amount: tx.fee ? parseFloat(tx.fee) : null,
        fee_currency: chain.includes('USDC') ? 'USDC' : chain.replace('USDC_', ''),
        confirmations: tx.confirmations,
        block_number: tx.blockNumber || null,
        block_timestamp: tx.timestamp,
        metadata: { source: 'indexer' },
      };

      const { error: upsertError } = await supabase
        .from('wallet_transactions')
        .upsert(record, {
          onConflict: 'chain,tx_hash',
          ignoreDuplicates: true,
        });

      if (!upsertError) {
        result.newTransactions++;
      }
      // If it's a duplicate (conflict), that's expected — we just skip
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[TxIndexer] Failed to upsert tx ${tx.txHash}: ${msg}`
      );
      result.errors.push(msg);
    }
  }

  return result;
}

/**
 * Sync on-chain history for all addresses of a wallet, optionally
 * filtered by chain.
 */
export async function syncWalletHistory(
  supabase: SupabaseClient,
  walletId: string,
  chain?: WalletChain
): Promise<{ newTransactions: number; results: SyncResult[] }> {
  // Fetch wallet addresses
  let query = supabase
    .from('wallet_addresses')
    .select('id, wallet_id, chain, address')
    .eq('wallet_id', walletId)
    .eq('is_active', true);

  if (chain) {
    query = query.eq('chain', chain);
  }

  const { data: addresses, error } = await query;

  if (error || !addresses || addresses.length === 0) {
    return { newTransactions: 0, results: [] };
  }

  const results: SyncResult[] = [];
  let totalNew = 0;

  // Process sequentially to avoid hammering APIs
  for (const addr of addresses) {
    const syncResult = await syncAddressHistory(
      supabase,
      walletId,
      addr.id,
      addr.address,
      addr.chain as WalletChain
    );
    results.push(syncResult);
    totalNew += syncResult.newTransactions;
  }

  return { newTransactions: totalNew, results };
}

// ──────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────

/**
 * Format a BigInt value with the given decimal places.
 */
function formatWei(value: bigint, decimals: number): string {
  if (value === 0n) return '0';
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const remainder = value % divisor;
  if (remainder === 0n) return whole.toString();
  const remainderStr = remainder.toString().padStart(decimals, '0');
  const trimmed = remainderStr.replace(/0+$/, '');
  return `${whole}.${trimmed}`;
}
