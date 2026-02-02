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
  USDC_ETH: 1,
  USDC_POL: 137,
};

/** USDC contract addresses */
const USDC_CONTRACTS: Record<string, string> = {
  USDC_ETH: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDC_POL: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
};

/** USDC on Solana */
const USDC_SOL_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

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
    ETH: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    POL: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
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
  fee: FeeEstimate,
  rpcUrl: string
): Promise<EVMUnsignedTx> {
  const isToken = chain.startsWith('USDC_');
  const chainId = CHAIN_IDS[chain] || 1;

  // Get nonce
  const nonceResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getTransactionCount',
      params: [from, 'pending'],
      id: 1,
    }),
  });

  if (!nonceResp.ok) {
    throw new Error(`Failed to get nonce: ${nonceResp.status}`);
  }

  const nonceData = await nonceResp.json();
  if (nonceData.error) {
    throw new Error(`Nonce RPC error: ${nonceData.error.message}`);
  }

  const nonce = parseInt(nonceData.result, 16);

  if (isToken) {
    // ERC-20 transfer(address, uint256)
    const contractAddress = USDC_CONTRACTS[chain];
    // USDC has 6 decimals
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

async function prepareSOLTransaction(
  from: string,
  to: string,
  amount: string,
  chain: WalletChain,
  rpcUrl: string
): Promise<SOLUnsignedTx> {
  // Get recent blockhash
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

  if (!resp.ok) {
    throw new Error(`Failed to get blockhash: ${resp.status}`);
  }

  const data = await resp.json();
  if (data.error) {
    throw new Error(`Blockhash RPC error: ${data.error.message}`);
  }

  const recentBlockhash = data.result?.value?.blockhash;
  if (!recentBlockhash) {
    throw new Error('Failed to get recent blockhash');
  }

  if (chain === 'USDC_SOL') {
    // SPL token transfer — client needs to build the full instruction
    // Server provides the blockhash and token mint info
    return {
      type: 'sol',
      recentBlockhash,
      feePayer: from,
      tokenMint: USDC_SOL_MINT,
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
  const { data: addrRecord, error: addrError } = await supabase
    .from('wallet_addresses')
    .select('id, address, chain')
    .eq('wallet_id', walletId)
    .eq('address', input.from_address)
    .eq('is_active', true)
    .single();

  if (addrError || !addrRecord) {
    return { success: false, error: 'From address not found in wallet', code: 'ADDRESS_NOT_FOUND' };
  }

  // Get fee estimate
  const priority = input.priority || 'medium';
  const feeEstimates = await estimateFees(chain);
  const fee = feeEstimates[priority];

  // Build unsigned transaction
  const rpc = getRpcEndpoints();
  let unsignedTx: UnsignedTransactionData;

  try {
    switch (chain) {
      case 'ETH':
      case 'USDC_ETH':
        unsignedTx = await prepareEVMTransaction(
          input.from_address, input.to_address, input.amount, chain, fee, rpc.ETH
        );
        break;
      case 'POL':
      case 'USDC_POL':
        unsignedTx = await prepareEVMTransaction(
          input.from_address, input.to_address, input.amount, chain, fee, rpc.POL
        );
        break;
      case 'BTC':
      case 'BCH':
        unsignedTx = await prepareBTCTransaction(
          input.from_address, input.to_address, input.amount, chain, fee
        );
        break;
      case 'SOL':
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
