/**
 * Chain Adapter Interface
 *
 * Abstract interface for all multisig chain adapters.
 * Each adapter implements chain-specific multisig operations:
 * - EVM: Safe (Gnosis Safe) protocol
 * - BTC/UTXO: P2WSH 2-of-3 multisig with PSBT
 * - Solana: Squads-style multisig PDA
 */

import type {
  MultisigChain,
  MultisigParticipants,
  CreateMultisigResult,
  ProposeTransactionInput,
  ProposeTransactionResult,
  BroadcastResult,
} from '../types';

export interface ChainAdapter {
  /** Chain identifier(s) this adapter supports */
  readonly supportedChains: readonly MultisigChain[];

  /**
   * Create a new 2-of-3 multisig wallet/account on-chain.
   * Returns the escrow address and any chain-specific metadata.
   */
  createMultisig(
    chain: MultisigChain,
    participants: MultisigParticipants,
    threshold: number,
  ): Promise<CreateMultisigResult>;

  /**
   * Build a transaction proposal for the multisig.
   * Returns transaction data that signers need to sign.
   */
  proposeTransaction(
    chain: MultisigChain,
    input: ProposeTransactionInput,
  ): Promise<ProposeTransactionResult>;

  /**
   * Verify that a signature is valid for the given transaction data.
   * Returns true if the signature is valid and from an authorized signer.
   */
  verifySignature(
    chain: MultisigChain,
    txData: Record<string, unknown>,
    signature: string,
    signerPubkey: string,
  ): Promise<boolean>;

  /**
   * Combine signatures and broadcast the transaction on-chain.
   * Requires at least `threshold` valid signatures.
   */
  broadcastTransaction(
    chain: MultisigChain,
    txData: Record<string, unknown>,
    signatures: Array<{ pubkey: string; signature: string }>,
  ): Promise<BroadcastResult>;
}

/**
 * Determine adapter type from chain identifier
 */
export function getAdapterType(chain: MultisigChain): 'evm' | 'utxo' | 'solana' {
  const evmChains: MultisigChain[] = ['ETH', 'POL', 'BASE', 'ARB', 'OP', 'BNB', 'AVAX'];
  const utxoChains: MultisigChain[] = ['BTC', 'LTC', 'DOGE'];

  if (evmChains.includes(chain)) return 'evm';
  if (utxoChains.includes(chain)) return 'utxo';
  if (chain === 'SOL') return 'solana';

  throw new Error(`Unsupported multisig chain: ${chain}`);
}
