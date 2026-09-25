/**
 * Web Wallet Transaction Preparation Service
 *
 * Builds unsigned transactions for all supported chains.
 * The server assembles the transaction data (nonce, UTXOs, blockhash, etc.)
 * and sends it to the client for signing. Private keys never touch the server.
 *
 * Unsigned transactions are stored in DB with a 5-minute TTL.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WalletChain } from './identity';
import { isValidChain, validateAddress } from './identity';
import { estimateFees, type FeeEstimate } from './fees';
import { evmRpcCall } from './evm-rpc';
import { fetchBalance } from './balance';
import { checkSpendable } from './spendable';

/** Truncate an address for safe logging */
function truncAddr(addr: string): string {
  if (!addr || addr.length <= 12) return addr || '';
  return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
}

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface PrepareTransactionInput {
  from_address: string;
  to_address: string;
  chain: string;
  amount: string;
  priority?: 'low' | 'medium' | 'high';
}

export interface PreparedTransaction {
  /** Unique ID for this prepared tx (stored in DB) */
  tx_id: string;
  chain: WalletChain;
  from_address: string;
  to_address: string;
  amount: string;
  /** Fee estimate used */
  fee: FeeEstimate;
  /** Expires at (ISO timestamp) */
  expires_at: string;
  /** Chain-specific unsigned transaction data for client-side signing */
  unsigned_tx: UnsignedTransactionData;
}

/** Chain-specific unsigned transaction data */
export type UnsignedTransactionData =
  | EVMUnsignedTx
  | BTCUnsignedTx
  | SOLUnsignedTx;

export interface EVMUnsignedTx {
  type: 'evm';
  chainId: number;
  nonce: number;
  to: string;
  value: string; // Hex wei
  gasLimit: number;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  /** For ERC-20: encoded transfer(to, amount) calldata */
  data?: string;
  /** For ERC-20: contract address */
  contractAddress?: string;
}

export interface BTCUnsignedTx {
  type: 'btc' | 'bch';
  inputs: UTXOInput[];
  outputs: TxOutput[];
  feeRate: number;
}

export interface UTXOInput {
  txid: string;
  vout: number;
  value: number; // satoshis
  scriptPubKey: string;
}

export interface TxOutput {
  address: string;
  value: number; // satoshis
}

export interface SOLUnsignedTx {
  type: 'sol';
  recentBlockhash: string;
  feePayer: string;
  instructions: SOLInstruction[];
  /** For SPL transfers */
  tokenMint?: string;
}

export interface SOLInstruction {
  programId: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; // base64
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

/** Transaction expiration TTL (5 minutes) */
const TX_EXPIRATION_MS = 5 * 60 * 1000;

/** EVM Chain IDs */
const CHAIN_IDS: Record<string, number> = {
  ETH: 1,
  POL: 137,
  USDT_ETH: 1,
  USDT_POL: 137,
  USDC_ETH: 1,
  USDC_POL: 137,
  USDC_BASE: 8453,
};

/** ERC-20 contract addresses */
const TOKEN_CONTRACTS: Record<string, string> = {
  USDT_ETH: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  USDT_POL: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  USDC_ETH: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDC_POL: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  USDC_BASE: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
};
const USDC_CONTRACTS = {
  USDC_ETH: TOKEN_CONTRACTS.USDC_ETH,
  USDC_POL: TOKEN_CONTRACTS.USDC_POL,
  USDC_BASE: TOKEN_CONTRACTS.USDC_BASE,
};

/** SPL token mints on Solana */
const TOKEN_MINTS: Record<'USDT_SOL' | 'USDC_SOL', string> = {
  USDT_SOL: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  USDC_SOL: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

/** ERC-20 transfer function signature */
const ERC20_TRANSFER_SELECTOR = '0xa9059cbb';

/** Solana System Program ID */
const SOL_SYSTEM_PROGRAM = '11111111111111111111111111111111';

/** Solana Token Program ID */
const SOL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// ──────────────────────────────────────────────
// RPC Endpoints
// ──────────────────────────────────────────────

function getRpcEndpoints(): Record<string, string> {
  return {
    BTC: process.env.BITCOIN_RPC_URL || 'https://blockstream.info/api',
    ETH: process.env.ETHEREUM_RPC_URL || 'https://ethereum-rpc.publicnode.com',
    POL: process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com',
    SOL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  };
}

// ──────────────────────────────────────────────
// EVM Transaction Preparation
// ──────────────────────────────────────────────

async function prepareEVMTransaction(
  from: string,
  to: string,
  amount: string,
  chain: WalletChain,
  fee: FeeEstimate
): Promise<EVMUnsignedTx> {
  const isToken = chain.startsWith('USDC_') || chain.startsWith('USDT_');

  // Never fall back to a default chain id. `|| 1` used to quietly stamp
  // Ethereum onto any chain missing from CHAIN_IDS, which is the same failure
  // evm-rpc.ts guards against on the read side: it does not error, it signs a
  // valid transaction for the WRONG network. Refusing is the only safe answer.
  const chainId = CHAIN_IDS[chain];
  if (!chainId) {
    throw new Error(`No EVM chain id mapped for ${chain}`);
  }

  // Get nonce. Goes through the failover client, so a single broken provider
  // no longer makes every send on this chain impossible.
  const nonceData = await evmRpcCall(chain, 'eth_getTransactionCount', [from, 'pending']);
  if (nonceData.error) {
    throw new Error(`Nonce RPC error: ${nonceData.error.message}`);
  }

  const nonce = parseInt(nonceData.result as string, 16);

  if (isToken) {
    // ERC-20 transfer(address, uint256)
    const contractAddress = TOKEN_CONTRACTS[chain];
    // USDT/USDC use 6 decimals
    const tokenAmount = BigInt(Math.round(parseFloat(amount) * 1e6));
    const paddedTo = to.toLowerCase().replace('0x', '').padStart(64, '0');
    const paddedAmount = tokenAmount.toString(16).padStart(64, '0');
    const data = ERC20_TRANSFER_SELECTOR + paddedTo + paddedAmount;

    return {
      type: 'evm',
      chainId,
      nonce,
      to: contractAddress,
      value: '0x0',
      gasLimit: fee.gasLimit || 65_000,
      maxFeePerGas: fee.maxFeePerGas || fee.gasPrice || '0',
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas || '0',
      data,
      contractAddress,
    };
  }

  // Native transfer
  const valueWei = BigInt(Math.round(parseFloat(amount) * 1e18));

  return {
    type: 'evm',
    chainId,
    nonce,
    to,
    value: '0x' + valueWei.toString(16),
    gasLimit: fee.gasLimit || 21_000,
    maxFeePerGas: fee.maxFeePerGas || fee.gasPrice || '0',
    maxPriorityFeePerGas: fee.maxPriorityFeePerGas || '0',
  };
}

// ──────────────────────────────────────────────
// BTC / BCH Transaction Preparation
// ──────────────────────────────────────────────

async function prepareBTCTransaction(
  from: string,
  to: string,
  amount: string,
  chain: WalletChain,
  fee: FeeEstimate
): Promise<BTCUnsignedTx> {
  // Fetch UTXOs via Blockstream (BTC) or other APIs
  const utxos = await fetchUTXOs(from, chain);

  if (utxos.length === 0) {
    throw new Error('No UTXOs available for this address');
  }

  const amountSats = Math.round(parseFloat(amount) * 1e8);
  const feeRate = fee.feeRate || 10;

  // Select UTXOs (simple: use all available, let client optimize)
  const totalInput = utxos.reduce((sum, u) => sum + u.value, 0);

  // Estimate fee
  const estimatedSize = utxos.length * 148 + 2 * 34 + 10; // P2PKH estimate
  const estimatedFee = estimatedSize * feeRate;

  if (totalInput < amountSats + estimatedFee) {
    throw new Error(`Insufficient funds: need ${amountSats + estimatedFee} sats, have ${totalInput} sats`);
  }

  const changeAmount = totalInput - amountSats - estimatedFee;
  const outputs: TxOutput[] = [{ address: to, value: amountSats }];

  // Add change output if above dust threshold (546 sats)
  if (changeAmount > 546) {
    outputs.push({ address: from, value: changeAmount });
  }

  return {
    type: chain === 'BCH' ? 'bch' : 'btc',
    inputs: utxos,
    outputs,
    feeRate,
  };
}

async function fetchUTXOs(address: string, chain: WalletChain): Promise<UTXOInput[]> {
  if (chain === 'BTC') {
    const resp = await fetch(`https://blockstream.info/api/address/${address}/utxo`);
    if (!resp.ok) throw new Error(`UTXO fetch failed: ${resp.status}`);
    const data = await resp.json();
    return data.map((u: any) => ({
      txid: u.txid,
      vout: u.vout,
      value: u.value,
      scriptPubKey: '', // Client will fill from raw tx
    }));
  }

  // BCH: try Tatum
  const tatumKey = process.env.TATUM_API_KEY;
  if (tatumKey) {
    const resp = await fetch(`https://api.tatum.io/v3/bcash/address/utxo/${address}`, {
      headers: { 'x-api-key': tatumKey },
    });
    if (resp.ok) {
      const data = await resp.json();
      return data.map((u: any) => ({
        txid: u.txid || u.hash,
        vout: u.index ?? u.vout,
        value: Math.round((u.value || 0) * 1e8),
        scriptPubKey: u.script || '',
      }));
    }
  }

  throw new Error(`No UTXO source available for ${chain}`);
}

// ──────────────────────────────────────────────
// SOL Transaction Preparation
// ──────────────────────────────────────────────

/**
 * Shared recent-blockhash fetch.
 *
 * Preparing a batch of payments used to call `getLatestBlockhash` once per
 * transaction. An 80-payment run therefore fired 80 back-to-back RPC requests,
 * which public Solana endpoints answer with 429 and then refuse outright — the
 * whole batch failed with "Failed to get blockhash: 429" followed by "Failed to
 * fetch".
 *
 * A blockhash stays valid for ~150 slots (about a minute), so one is good for
 * every transaction in a batch. Two things make that safe under concurrency:
 *
 *   - a short TTL cache, so a batch costs one RPC call rather than N, and
 *   - an in-flight promise, so N *simultaneous* misses collapse into a single
 *     request instead of all stampeding the endpoint at once.
 *
 * The TTL is deliberately far below the real expiry: a slightly stale blockhash
 * still confirms, but one that has aged out makes the transaction silently
 * un-landable, which is much worse than an extra RPC call.
 */
const BLOCKHASH_TTL_MS = 20_000;
const BLOCKHASH_RETRIES = 3;

interface CachedBlockhash {
  value: string;
  fetchedAt: number;
}

const blockhashCache = new Map<string, CachedBlockhash>();
const blockhashInFlight = new Map<string, Promise<string>>();

/** Test seam: forget any cached blockhash. */
export function resetBlockhashCache(): void {
  blockhashCache.clear();
  blockhashInFlight.clear();
}

async function fetchBlockhash(rpcUrl: string): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= BLOCKHASH_RETRIES; attempt++) {
    try {
      const resp = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'getLatestBlockhash',
          params: [{ commitment: 'finalized' }],
          id: 1,
        }),
      });

      if (resp.status === 429 || resp.status >= 500) {
        // Transient by definition — the endpoint is busy, not the request bad.
        const retryAfter = Number(resp.headers?.get?.('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 250 * 2 ** (attempt - 1);
        lastError = new Error(`Failed to get blockhash: ${resp.status}`);
        if (attempt < BLOCKHASH_RETRIES) {
          await new Promise((r) => setTimeout(r, Math.min(wait, 4000)));
          continue;
        }
        throw lastError;
      }

      if (!resp.ok) {
        throw new Error(`Failed to get blockhash: ${resp.status}`);
      }

      const data = await resp.json();
      if (data.error) {
        throw new Error(`Blockhash RPC error: ${data.error.message}`);
      }

      const blockhash = data.result?.value?.blockhash;
      if (!blockhash) {
        throw new Error('Failed to get recent blockhash');
      }
      return blockhash;
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // A dropped connection mid-batch is as transient as a 429.
      const isLast = attempt >= BLOCKHASH_RETRIES;
      if (isLast) throw lastError;
      await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
    }
  }

  throw lastError ?? new Error('Failed to get recent blockhash');
}

async function getRecentBlockhash(rpcUrl: string): Promise<string> {
  const cached = blockhashCache.get(rpcUrl);
  if (cached && Date.now() - cached.fetchedAt < BLOCKHASH_TTL_MS) {
    return cached.value;
  }

  // Collapse concurrent misses onto one request.
  const existing = blockhashInFlight.get(rpcUrl);
  if (existing) return existing;

  const pending = fetchBlockhash(rpcUrl)
    .then((value) => {
      blockhashCache.set(rpcUrl, { value, fetchedAt: Date.now() });
      return value;
    })
    .finally(() => {
      blockhashInFlight.delete(rpcUrl);
    });

  blockhashInFlight.set(rpcUrl, pending);
  return pending;
}

async function prepareSOLTransaction(
  from: string,
  to: string,
  amount: string,
  chain: WalletChain,
  rpcUrl: string
): Promise<SOLUnsignedTx> {
  const recentBlockhash = await getRecentBlockhash(rpcUrl);

  if (chain === 'USDC_SOL' || chain === 'USDT_SOL') {
    // SPL token transfer — client needs to build the full instruction
    // Server provides the blockhash and token mint info
    return {
      type: 'sol',
      recentBlockhash,
      feePayer: from,
      tokenMint: TOKEN_MINTS[chain],
      instructions: [], // Client builds SPL transfer instruction
    };
  }

  // Native SOL transfer
  const lamports = Math.round(parseFloat(amount) * 1e9);

  // Build SystemProgram.transfer instruction data
  // Instruction index 2 (transfer), followed by u64 lamports (little-endian)
  const instructionData = Buffer.alloc(12);
  instructionData.writeUInt32LE(2, 0); // instruction index
  instructionData.writeBigUInt64LE(BigInt(lamports), 4);

  return {
    type: 'sol',
    recentBlockhash,
    feePayer: from,
    instructions: [
      {
        programId: SOL_SYSTEM_PROGRAM,
        keys: [
          { pubkey: from, isSigner: true, isWritable: true },
          { pubkey: to, isSigner: false, isWritable: true },
        ],
        data: instructionData.toString('base64'),
      },
    ],
  };
}

// ──────────────────────────────────────────────
// Main Prepare Function
// ──────────────────────────────────────────────

/**
 * Prepare an unsigned transaction for signing by the client.
 * Stores the prepared tx in DB with a 5-minute TTL.
 */
export async function prepareTransaction(
  supabase: SupabaseClient,
  walletId: string,
  input: PrepareTransactionInput
): Promise<{ success: true; data: PreparedTransaction } | { success: false; error: string; code?: string }> {
  console.log(`[PrepareTx] Preparing ${input.chain} tx: ${truncAddr(input.from_address)} → ${truncAddr(input.to_address)}, amount=${input.amount}, priority=${input.priority || 'medium'}`);

  // Validate chain
  if (!isValidChain(input.chain)) {
    console.error(`[PrepareTx] Invalid chain: ${input.chain}`);
    return { success: false, error: `Unsupported chain: ${input.chain}`, code: 'INVALID_CHAIN' };
  }
  const chain = input.chain as WalletChain;

  // Validate addresses
  if (!validateAddress(input.to_address, chain)) {
    return { success: false, error: 'Invalid recipient address', code: 'INVALID_ADDRESS' };
  }

  // Validate amount
  const amount = parseFloat(input.amount);
  if (isNaN(amount) || amount <= 0) {
    return { success: false, error: 'Invalid amount', code: 'INVALID_AMOUNT' };
  }

  // Verify from_address belongs to this wallet
  // Filter by chain too — EVM addresses can be shared across ETH/POL/USDC_* chains
  const { data: addrRecord, error: addrError } = await supabase
    .from('wallet_addresses')
    .select('id, address, chain, cached_balance')
    .eq('wallet_id', walletId)
    .eq('address', input.from_address)
    .eq('chain', chain)
    .eq('is_active', true)
    .single();

  if (addrError || !addrRecord) {
    return { success: false, error: 'From address not found in wallet', code: 'ADDRESS_NOT_FOUND' };
  }

  const priority = input.priority || 'medium';

  // ── Affordability guard ──
  // A transfer spends one keypair, but the asset screen shows the sum of every
  // derived address on the chain, so an amount that looks funded can be backed
  // by a sibling address instead. Without this the only verdict came from the
  // node *after* the payer had signed, as an "insufficient funds" simulation
  // failure. Solana also rejects a transfer leaving the sender below the
  // rent-exempt floor, which surprises a payer the same way.
  //
  // The cached balance decides whether to look: a wallet that already believes
  // the address can pay is taken at its word, so the common path spends no RPC
  // call at all and a 25-payment batch still costs one request. Only a cache
  // that says the send is short earns a live lookup, and only live data can
  // refuse — a stale cache must never block a send the chain would accept.
  //
  // Scoped to native SOL: the BTC path already fails on its own UTXO total, and
  // a token transfer's fee comes from a native balance this does not read. The
  // send form's own check covers every chain before the payer ever signs.
  if (chain === 'SOL' && addrRecord.cached_balance !== null && addrRecord.cached_balance !== undefined) {
    const cachedVerdict = checkSpendable({
      chain,
      balance: String(addrRecord.cached_balance),
      amount: input.amount,
      fee: fee.fee,
    });

    if (!cachedVerdict.ok) {
      let liveBalance: string | null = null;
      try {
        liveBalance = await fetchBalance(input.from_address, chain);
      } catch (err: any) {
        // Confirmation unavailable: let it through rather than refuse on a
        // balance we could not verify. The node stays the final authority.
        console.warn(`[PrepareTx] SOL balance confirmation failed: ${err?.message || err}`);
      }

      if (liveBalance !== null) {
        const verdict = checkSpendable({
          chain,
          balance: liveBalance,
          amount: input.amount,
          fee: fee.fee,
        });
        if (!verdict.ok) {
          console.log(
            `[PrepareTx] Rejected ${chain} tx from ${truncAddr(input.from_address)}: ${verdict.code}`
          );
          return { success: false, error: verdict.message, code: verdict.code };
        }
      }
    }
  }

  // Build unsigned transaction
  const rpc = getRpcEndpoints();
  let unsignedTx: UnsignedTransactionData;
  let fee: FeeEstimate;

  // estimateFees() belongs INSIDE this try. It sat outside for a long time,
  // and because the route's outer catch answers `serverError()` with no
  // argument, every fee-estimation failure reached the caller as the bare
  // string "Internal server error" — no chain, no status, no cause. A dead
  // RPC provider looked identical to a bug in our own code, which is exactly
  // how a 403 from a misconfigured Infura project went unexplained: the
  // extension showed "Internal server error" and the reason was nowhere.
  // Inside the try it comes back as PREPARE_FAILED plus the real message.
  try {
    const feeEstimates = await estimateFees(chain);
    fee = feeEstimates[priority];

    switch (chain) {
      // Every EVM chain builds the same way now that the RPC endpoint is
      // resolved from the chain rather than passed in.
      case 'ETH':
      case 'USDT_ETH':
      case 'USDC_ETH':
      case 'POL':
      case 'USDT_POL':
      case 'USDC_POL':
      case 'USDC_BASE':
        unsignedTx = await prepareEVMTransaction(
          input.from_address, input.to_address, input.amount, chain, fee
        );
        break;
      case 'BTC':
      case 'BCH':
        unsignedTx = await prepareBTCTransaction(
          input.from_address, input.to_address, input.amount, chain, fee
        );
        break;
      case 'SOL':
      case 'USDT_SOL':
      case 'USDC_SOL':
        unsignedTx = await prepareSOLTransaction(
          input.from_address, input.to_address, input.amount, chain, rpc.SOL
        );
        break;
      default:
        return { success: false, error: `Unsupported chain: ${chain}`, code: 'UNSUPPORTED_CHAIN' };
    }
  } catch (err: any) {
    console.error(`[PrepareTx] Failed for ${chain}: ${err.message}`);
    return { success: false, error: err.message, code: 'PREPARE_FAILED' };
  }

  // Store in DB with TTL
  const expiresAt = new Date(Date.now() + TX_EXPIRATION_MS).toISOString();
  const { data: txRecord, error: insertError } = await supabase
    .from('wallet_transactions')
    .insert({
      wallet_id: walletId,
      address_id: addrRecord.id,
      chain,
      tx_hash: `pending:${crypto.randomUUID()}`, // Placeholder until broadcast
      direction: 'outgoing',
      status: 'pending',
      amount,
      from_address: input.from_address,
      to_address: input.to_address,
      fee_amount: parseFloat(fee.fee),
      fee_currency: fee.feeCurrency,
      metadata: {
        unsigned_tx: unsignedTx,
        priority,
        expires_at: expiresAt,
      },
    })
    .select('id')
    .single();

  if (insertError || !txRecord) {
    console.error(`[PrepareTx] DB insert failed for wallet ${walletId}:`, insertError?.message);
    return { success: false, error: 'Failed to store prepared transaction', code: 'DB_ERROR' };
  }

  console.log(`[PrepareTx] Prepared tx ${txRecord.id} on ${chain}, fee=${fee.fee} ${fee.feeCurrency}, expires ${expiresAt}`);

  return {
    success: true,
    data: {
      tx_id: txRecord.id,
      chain,
      from_address: input.from_address,
      to_address: input.to_address,
      amount: input.amount,
      fee,
      expires_at: expiresAt,
      unsigned_tx: unsignedTx,
    },
  };
}

// Export for testing
export { TX_EXPIRATION_MS, CHAIN_IDS, USDC_CONTRACTS, fetchUTXOs };
