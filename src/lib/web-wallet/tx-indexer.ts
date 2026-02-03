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
  };
}

// USDC contract addresses (same as balance.ts)
const USDC_CONTRACTS: Record<string, string> = {
  USDC_ETH: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDC_POL: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
};

const USDC_SOL_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

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

async function fetchEVMNativeHistory(
  address: string,
  rpcUrl: string,
  chain: 'ETH' | 'POL'
): Promise<IndexedTransaction[]> {
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

  const blockData: { result?: string; error?: { message: string } } =
    await blockResp.json();
  if (blockData.error) {
    throw new Error(`${chain} RPC error: ${blockData.error.message}`);
  }

  const latestBlock = parseInt(blockData.result || '0x0', 16);
  // Scan last ~5000 blocks for native transfers via logs
  const fromBlock = Math.max(0, latestBlock - 5000);

  const paddedAddress =
    '0x' + address.toLowerCase().replace('0x', '').padStart(64, '0');

  // Fetch incoming Transfer events (ERC-20 style — native transfers aren't in logs)
  // For native ETH/POL, we look at internal transactions via trace or just
  // look for ERC-20 transfers as a proxy. Full native tx history requires
  // an explorer API. We scan Transfer events to/from the address.
  const results: IndexedTransaction[] = [];

  // Incoming token transfers
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

  // Outgoing token transfers
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
        const toAddr = '0x' + (log.topics?.[2] || '').slice(26);
        const rawAmount = BigInt(log.data || '0x0');
        const blockNum = parseInt(log.blockNumber || '0x0', 16);
        const confirmations = latestBlock - blockNum;

        // Avoid duplicates (same tx may appear in incoming and outgoing)
        if (!results.some((r) => r.txHash === log.transactionHash)) {
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
    case 'USDC_ETH':
      return fetchEVMUSDCHistory(address, rpc.ETH, 'USDC_ETH');
    case 'USDC_POL':
      return fetchEVMUSDCHistory(address, rpc.POL, 'USDC_POL');
    case 'USDC_SOL':
      return fetchUSDCSOLHistory(address, rpc.SOL);
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
    `[TxIndexer] Found ${indexed.length} on-chain txs for ${chain} ${truncAddr(address)}`
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
