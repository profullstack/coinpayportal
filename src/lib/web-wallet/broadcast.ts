/**
 * Web Wallet Transaction Broadcast Service
 *
 * Receives signed transactions from the client and broadcasts
 * them to the appropriate blockchain network.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WalletChain } from './identity';
import { isValidChain } from './identity';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface BroadcastInput {
  /** ID of the prepared transaction */
  tx_id: string;
  /** Signed transaction hex (EVM/BTC) or base64 (SOL) */
  signed_tx: string;
  chain: string;
}

export interface BroadcastResult {
  tx_hash: string;
  chain: WalletChain;
  status: 'pending' | 'confirming';
  explorer_url: string;
}

// ──────────────────────────────────────────────
// Explorer URLs
// ──────────────────────────────────────────────

const EXPLORER_URLS: Record<string, string> = {
  BTC: 'https://blockstream.info/tx/',
  BCH: 'https://blockchair.com/bitcoin-cash/transaction/',
  ETH: 'https://etherscan.io/tx/',
  POL: 'https://polygonscan.com/tx/',
  SOL: 'https://explorer.solana.com/tx/',
  USDC_ETH: 'https://etherscan.io/tx/',
  USDC_POL: 'https://polygonscan.com/tx/',
  USDC_SOL: 'https://explorer.solana.com/tx/',
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
// Retry Logic
// ──────────────────────────────────────────────

/** Max number of broadcast retries */
const MAX_RETRIES = 3;

/** Base delay between retries (ms). Doubled on each retry. */
const RETRY_BASE_DELAY_MS = 1000;

/**
 * Retry an async operation with exponential backoff.
 * Only retries on transient errors (network failures, 5xx).
 * Does NOT retry on validation errors (4xx, RPC errors like "nonce too low").
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const msg = err.message || '';
      // Don't retry validation / permanent errors
      if (
        msg.includes('nonce too low') ||
        msg.includes('already known') ||
        msg.includes('insufficient funds') ||
        msg.includes('TATUM_API_KEY required') ||
        msg.includes('Invalid transaction') ||
        attempt === retries
      ) {
        throw err;
      }
      // Wait with exponential backoff
      await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

// ──────────────────────────────────────────────
// Chain-specific Broadcasters
// ──────────────────────────────────────────────

/**
 * Broadcast a signed BTC transaction via Blockstream API.
 */
async function broadcastBTC(signedTxHex: string): Promise<string> {
  const resp = await fetch('https://blockstream.info/api/tx', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: signedTxHex,
  });

  if (!resp.ok) {
    const error = await resp.text();
    throw new Error(`BTC broadcast failed: ${error}`);
  }

  return await resp.text(); // Returns txid
}

/**
 * Broadcast a signed BCH transaction via Tatum API.
 */
async function broadcastBCH(signedTxHex: string): Promise<string> {
  const tatumKey = process.env.TATUM_API_KEY;
  if (!tatumKey) {
    throw new Error('TATUM_API_KEY required for BCH broadcast');
  }

  const resp = await fetch('https://api.tatum.io/v3/bcash/broadcast', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': tatumKey,
    },
    body: JSON.stringify({ txData: signedTxHex }),
  });

  if (!resp.ok) {
    const error = await resp.text();
    throw new Error(`BCH broadcast failed: ${error}`);
  }

  const data = await resp.json();
  return data.txId;
}

/**
 * Broadcast a signed EVM transaction via eth_sendRawTransaction.
 */
async function broadcastEVM(signedTxHex: string, rpcUrl: string): Promise<string> {
  // Ensure 0x prefix
  const txHex = signedTxHex.startsWith('0x') ? signedTxHex : '0x' + signedTxHex;

  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_sendRawTransaction',
      params: [txHex],
      id: 1,
    }),
  });

  if (!resp.ok) {
    throw new Error(`EVM broadcast failed: ${resp.status}`);
  }

  const data = await resp.json();
  if (data.error) {
    throw new Error(`EVM broadcast error: ${data.error.message}`);
  }

  return data.result; // Returns tx hash
}

/**
 * Broadcast a signed SOL transaction via sendTransaction.
 */
async function broadcastSOL(signedTxBase64: string, rpcUrl: string): Promise<string> {
  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'sendTransaction',
      params: [
        signedTxBase64,
        { encoding: 'base64', preflightCommitment: 'confirmed' },
      ],
      id: 1,
    }),
  });

  if (!resp.ok) {
    throw new Error(`SOL broadcast failed: ${resp.status}`);
  }

  const data = await resp.json();
  if (data.error) {
    throw new Error(`SOL broadcast error: ${data.error.message}`);
  }

  return data.result; // Returns signature
}

// ──────────────────────────────────────────────
// Unified Broadcast
// ──────────────────────────────────────────────

/**
 * Broadcast a signed transaction.
 * Validates the prepared tx exists and is not expired, then broadcasts.
 */
export async function broadcastTransaction(
  supabase: SupabaseClient,
  walletId: string,
  input: BroadcastInput
): Promise<{ success: true; data: BroadcastResult } | { success: false; error: string; code?: string }> {
  if (!isValidChain(input.chain)) {
    return { success: false, error: `Unsupported chain: ${input.chain}`, code: 'INVALID_CHAIN' };
  }
  const chain = input.chain as WalletChain;

  if (!input.signed_tx || typeof input.signed_tx !== 'string') {
    return { success: false, error: 'signed_tx is required', code: 'MISSING_SIGNED_TX' };
  }

  // Verify the prepared transaction exists and belongs to this wallet
  const { data: txRecord, error: txError } = await supabase
    .from('wallet_transactions')
    .select('id, wallet_id, chain, status, metadata, from_address, to_address, amount')
    .eq('id', input.tx_id)
    .eq('wallet_id', walletId)
    .single();

  if (txError || !txRecord) {
    return { success: false, error: 'Prepared transaction not found', code: 'TX_NOT_FOUND' };
  }

  if (txRecord.status !== 'pending') {
    return { success: false, error: 'Transaction already broadcast or failed', code: 'TX_ALREADY_PROCESSED' };
  }

  // Check expiration
  const expiresAt = txRecord.metadata?.expires_at;
  if (expiresAt && new Date(expiresAt) < new Date()) {
    await supabase
      .from('wallet_transactions')
      .update({ status: 'failed', metadata: { ...txRecord.metadata, failure_reason: 'expired' } })
      .eq('id', input.tx_id);
    return { success: false, error: 'Transaction expired', code: 'TX_EXPIRED' };
  }

  // Broadcast to the network
  const rpc = getRpcEndpoints();
  let txHash: string;

  try {
    switch (chain) {
      case 'BTC':
        txHash = await withRetry(() => broadcastBTC(input.signed_tx));
        break;
      case 'BCH':
        txHash = await withRetry(() => broadcastBCH(input.signed_tx));
        break;
      case 'ETH':
      case 'USDC_ETH':
        txHash = await withRetry(() => broadcastEVM(input.signed_tx, rpc.ETH));
        break;
      case 'POL':
      case 'USDC_POL':
        txHash = await withRetry(() => broadcastEVM(input.signed_tx, rpc.POL));
        break;
      case 'SOL':
      case 'USDC_SOL':
        txHash = await withRetry(() => broadcastSOL(input.signed_tx, rpc.SOL));
        break;
      default:
        return { success: false, error: `Unsupported chain: ${chain}`, code: 'UNSUPPORTED_CHAIN' };
    }
  } catch (err: any) {
    // Update DB with failure
    await supabase
      .from('wallet_transactions')
      .update({
        status: 'failed',
        metadata: { ...txRecord.metadata, failure_reason: err.message },
      })
      .eq('id', input.tx_id);

    return { success: false, error: `Broadcast failed: ${err.message}`, code: 'BROADCAST_FAILED' };
  }

  // Update DB with real tx hash and confirming status
  await supabase
    .from('wallet_transactions')
    .update({
      tx_hash: txHash,
      status: 'confirming',
      metadata: { ...txRecord.metadata, broadcast_at: new Date().toISOString() },
    })
    .eq('id', input.tx_id);

  const explorerBase = EXPLORER_URLS[chain] || '';

  return {
    success: true,
    data: {
      tx_hash: txHash,
      chain,
      status: 'confirming',
      explorer_url: explorerBase + txHash,
    },
  };
}

// Export for testing
export { EXPLORER_URLS, withRetry, MAX_RETRIES, RETRY_BASE_DELAY_MS };
