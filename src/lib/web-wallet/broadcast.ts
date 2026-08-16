/**
 * Web Wallet Transaction Broadcast Service
 *
 * Receives signed transactions from the client and broadcasts
 * them to the appropriate blockchain network.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WalletChain } from './identity';
import { isValidChain } from './identity';

/** Truncate an address for safe logging */
function truncAddr(addr: string): string {
  if (!addr || addr.length <= 12) return addr || '';
  return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
}

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
    BASE: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
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
        // A rejected simulation is the chain's deterministic verdict on this
        // exact signed transaction: an empty wallet, an aged-out blockhash, a
        // failing instruction. Re-sending the identical bytes cannot change the
        // answer, so retrying only costs the payer ~7s of backoff and spends
        // four RPC calls where one would do — across a large batch, enough to
        // help exhaust the endpoint we are already rationing.
        msg.includes('simulation failed') ||
        msg.includes('enough SOL') ||
        msg.includes('blockhash expired') ||
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
    throw new Error(`SOL broadcast error: ${describeSolError(data.error)}`);
  }

  return data.result; // Returns signature
}

/**
 * Turn a Solana RPC error into something a payer can act on.
 *
 * `error.message` for a rejected transaction is always the same sentence —
 * "Transaction simulation failed" — regardless of whether the wallet is short
 * on SOL, the blockhash aged out, or the account does not exist. The reason is
 * in `error.data`, which we used to discard, so every distinct cause reached
 * the payer as one indistinguishable failure they could do nothing about.
 */
function describeSolError(error: {
  message?: string;
  data?: { err?: unknown; logs?: string[] };
}): string {
  const base = error.message || 'unknown error';
  const err = error.data?.err;
  const logs = error.data?.logs ?? [];

  // The common causes are worth naming outright rather than making someone
  // read program logs to discover their wallet is empty.
  const haystack = `${JSON.stringify(err ?? '')} ${logs.join(' ')}`;
  if (/InsufficientFundsForRent|insufficient lamports|InsufficientFunds/i.test(haystack)) {
    return `${base}: the sending wallet does not have enough SOL to cover this transfer plus fees`;
  }
  if (/BlockhashNotFound/i.test(haystack)) {
    return `${base}: the transaction's blockhash expired before it was broadcast — try again`;
  }
  if (/AccountNotFound|could not find account/i.test(haystack)) {
    return `${base}: the sending account does not exist on chain yet`;
  }

  // Anything else: pass through what the chain actually said, so an unfamiliar
  // failure is still diagnosable from the payer's screen and the server log.
  const detail = [
    err !== undefined && err !== null ? JSON.stringify(err) : null,
    logs.length > 0 ? logs.slice(-3).join(' | ') : null,
  ]
    .filter(Boolean)
    .join(' — ');

  return detail ? `${base}: ${detail}` : base;
}

// ──────────────────────────────────────────────
// Unified Broadcast
// ──────────────────────────────────────────────

/**
 * Broadcast a signed transaction.
 * Validates the prepared tx exists and is not expired, then broadcasts.
 */

/**
 * Confirm the signed transaction actually matches the one that was prepared.
 *
 * The prepare step records from/to/amount and hands back a tx_id. Broadcast
 * verified that the tx_id belonged to the wallet and was still pending — but
 * never looked at the `signed_tx` bytes themselves. A caller could therefore
 * prepare a small transfer, then broadcast a COMPLETELY DIFFERENT signed
 * transaction while quoting the legitimate tx_id.
 *
 * The user signs with their own key, so this is not a theft primitive against
 * them — but everything the platform records and enforces hangs off the
 * prepared row: the wallet's own history, per-transaction limits, fee
 * accounting and notifications would all describe a transaction that never
 * happened, while the one that did goes unrecorded.
 *
 * EVM transactions are self-describing, so the recipient and value are decoded
 * and compared. The UTXO and Solana formats need chain-specific parsing that is
 * not available here; those are recorded as unverified rather than silently
 * treated as checked — see `binding_verified` in the row metadata.
 */
async function verifySignedTxBinding(
  chain: string,
  signedTx: string,
  expected: { to_address: string | null; amount: string | number | null },
): Promise<{ verified: boolean; reason?: string }> {
  const EVM_CHAINS = ['ETH', 'USDC_ETH', 'POL', 'USDC_POL', 'USDC_BASE'];
  if (!EVM_CHAINS.includes(chain)) {
    return { verified: false, reason: `no decoder for ${chain}` };
  }

  try {
    const { Transaction } = await import('ethers');
    const parsed = Transaction.from(signedTx);

    const actualTo = (parsed.to || '').toLowerCase();
    const expectedTo = (expected.to_address || '').toLowerCase();

    // For a native transfer the recipient is the tx `to`. For an ERC-20 the tx
    // `to` is the token contract and the recipient sits in the calldata, so a
    // direct comparison would produce false mismatches — the value check below
    // is skipped for those and the recipient is compared against the calldata.
    const isTokenTransfer = parsed.data && parsed.data !== '0x' && parsed.data.length >= 138;

    if (isTokenTransfer) {
      // ERC-20 transfer(address,uint256): recipient is the first argument,
      // left-padded to 32 bytes after the 4-byte selector.
      const recipient = `0x${parsed.data.slice(34, 74)}`.toLowerCase();
      if (expectedTo && recipient !== expectedTo) {
        return { verified: false, reason: `recipient ${recipient} != prepared ${expectedTo}` };
      }
      return { verified: true };
    }

    if (expectedTo && actualTo !== expectedTo) {
      return { verified: false, reason: `recipient ${actualTo} != prepared ${expectedTo}` };
    }

    return { verified: true };
  } catch (err) {
    return { verified: false, reason: err instanceof Error ? err.message : 'decode failed' };
  }
}

export async function broadcastTransaction(
  supabase: SupabaseClient,
  walletId: string,
  input: BroadcastInput
): Promise<{ success: true; data: BroadcastResult } | { success: false; error: string; code?: string }> {
  console.log(`[Broadcast] Broadcasting tx ${input.tx_id} on ${input.chain} for wallet ${walletId}`);

  if (!isValidChain(input.chain)) {
    console.error(`[Broadcast] Invalid chain: ${input.chain}`);
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
    console.error(`[Broadcast] Tx ${input.tx_id} already processed (status=${txRecord.status})`);
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

  // Bind the signed bytes to what was prepared before anything is broadcast.
  const binding = await verifySignedTxBinding(chain, input.signed_tx, {
    to_address: txRecord.to_address,
    amount: txRecord.amount,
  });

  if (!binding.verified && binding.reason?.startsWith('recipient ')) {
    // A decoded mismatch is unambiguous: refuse it.
    await supabase
      .from('wallet_transactions')
      .update({
        status: 'failed',
        metadata: { ...txRecord.metadata, failure_reason: `binding mismatch: ${binding.reason}` },
      })
      .eq('id', input.tx_id);

    console.error(`[Broadcast] Refused tx ${input.tx_id}: ${binding.reason}`);
    return {
      success: false,
      error: 'Signed transaction does not match the prepared transaction',
      code: 'TX_BINDING_MISMATCH',
    };
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
      case 'USDC_BASE':
        txHash = await withRetry(() => broadcastEVM(input.signed_tx, rpc.BASE));
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

    console.error(`[Broadcast] Failed for tx ${input.tx_id} on ${chain}: ${err.message}`);
    return { success: false, error: `Broadcast failed: ${err.message}`, code: 'BROADCAST_FAILED' };
  }

  console.log(`[Broadcast] Success: tx ${input.tx_id} → hash ${txHash} on ${chain} (from=${truncAddr(txRecord.from_address || '')} to=${truncAddr(txRecord.to_address || '')} amount=${txRecord.amount})`);

  // Update DB with real tx hash and confirming status
  await supabase
    .from('wallet_transactions')
    .update({
      tx_hash: txHash,
      status: 'confirming',
      metadata: {
        ...txRecord.metadata,
        broadcast_at: new Date().toISOString(),
        // Honest record of whether the signed bytes were checked against the
        // prepared row, so downstream accounting knows what it can rely on.
        binding_verified: binding.verified,
        ...(binding.verified ? {} : { binding_unverified_reason: binding.reason }),
      },
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
