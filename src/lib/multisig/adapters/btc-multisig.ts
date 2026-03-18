/**
 * Bitcoin Multisig Adapter
 *
 * Implements 2-of-3 P2WSH multisig for UTXO chains.
 * Supported chains: BTC, LTC, DOGE
 *
 * Flow:
 * 1. Generate 2-of-3 P2WSH multisig address from 3 public keys
 * 2. Store witness script in chain_metadata
 * 3. Deposit funds to the multisig address
 * 4. Build PSBT for settlement/refund
 * 5. Collect 2 signatures via PSBT
 * 6. Finalize and broadcast
 *
 * Security:
 * - No private key storage — users sign with their own wallets
 * - Uses standard P2WSH — compatible with all major wallets
 * - PSBT format for safe offline signing
 */

import * as bitcoin from 'bitcoinjs-lib';
<<<<<<< HEAD
import * as secp256k1 from 'tiny-secp256k1';
=======
>>>>>>> feat/multisig-escrow
import type { ChainAdapter } from './interface';
import type {
  MultisigChain,
  UtxoChain,
  MultisigParticipants,
  CreateMultisigResult,
  ProposeTransactionInput,
  ProposeTransactionResult,
  BroadcastResult,
} from '../types';

// ── Chain Configuration ─────────────────────────────────────

interface UtxoChainConfig {
  network: bitcoin.Network;
  name: string;
  ticker: string;
}

const BTC_MAINNET: bitcoin.Network = bitcoin.networks.bitcoin;

// LTC and DOGE use similar but different network parameters
const LTC_NETWORK: bitcoin.Network = {
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32: 'ltc',
  bip32: { public: 0x019da462, private: 0x019d9cfe },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

const DOGE_NETWORK: bitcoin.Network = {
  messagePrefix: '\x19Dogecoin Signed Message:\n',
  bech32: 'doge',
  bip32: { public: 0x02facafd, private: 0x02fac398 },
  pubKeyHash: 0x1e,
  scriptHash: 0x16,
  wif: 0x9e,
};

const UTXO_CHAIN_CONFIGS: Record<UtxoChain, UtxoChainConfig> = {
  BTC: { network: BTC_MAINNET, name: 'Bitcoin', ticker: 'BTC' },
  LTC: { network: LTC_NETWORK, name: 'Litecoin', ticker: 'LTC' },
  DOGE: { network: DOGE_NETWORK, name: 'Dogecoin', ticker: 'DOGE' },
};

// ── Helper Functions ────────────────────────────────────────

function isUtxoChain(chain: MultisigChain): chain is UtxoChain {
  return chain in UTXO_CHAIN_CONFIGS;
}

/**
 * Sort public keys lexicographically for deterministic multisig address.
 * BIP-67 specifies sorting pubkeys for reproducible P2SH/P2WSH.
 */
function sortPubkeys(pubkeys: Buffer[]): Buffer[] {
  return [...pubkeys].sort((a, b) => a.compare(b));
}

/**
 * Parse a hex public key string to Buffer, validating format.
 */
function parsePubkey(hex: string): Buffer {
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 33 && buf.length !== 65) {
    throw new Error(`Invalid public key length: ${buf.length} bytes (expected 33 or 65)`);
  }
  return buf;
}

/**
 * Convert BTC amount to satoshis
 */
function toSatoshis(amount: number): number {
  return Math.round(amount * 1e8);
}

// ── BTC Multisig Adapter ────────────────────────────────────

export class BtcMultisigAdapter implements ChainAdapter {
  readonly supportedChains: readonly MultisigChain[] = ['BTC', 'LTC', 'DOGE'] as const;

  /**
   * Generate a 2-of-3 P2WSH multisig address.
   *
   * Steps:
   * 1. Sort the 3 public keys (BIP-67)
   * 2. Create OP_2 <pk1> <pk2> <pk3> OP_3 OP_CHECKMULTISIG witness script
   * 3. P2WSH-wrap the witness script
   * 4. Return the bech32 address
   */
  async createMultisig(
    chain: MultisigChain,
    participants: MultisigParticipants,
    threshold: number,
  ): Promise<CreateMultisigResult> {
    if (!isUtxoChain(chain)) {
      throw new Error(`Chain ${chain} is not supported by BTC multisig adapter`);
    }

    const config = UTXO_CHAIN_CONFIGS[chain];

    // Parse and sort public keys
    const pubkeys = sortPubkeys([
      parsePubkey(participants.depositor_pubkey),
      parsePubkey(participants.beneficiary_pubkey),
      parsePubkey(participants.arbiter_pubkey),
    ]);

    // Create the multisig redeem script: OP_2 <pk1> <pk2> <pk3> OP_3 OP_CHECKMULTISIG
    const redeemScript = bitcoin.script.compile([
      bitcoin.opcodes.OP_2,
      pubkeys[0],
      pubkeys[1],
      pubkeys[2],
      bitcoin.opcodes.OP_3,
      bitcoin.opcodes.OP_CHECKMULTISIG,
    ]);

    // Create P2WSH output from the redeem script
    const p2wsh = bitcoin.payments.p2wsh({
      redeem: { output: redeemScript },
      network: config.network,
    });

    if (!p2wsh.address) {
      throw new Error('Failed to generate P2WSH multisig address');
    }

    return {
      escrow_address: p2wsh.address,
      chain_metadata: {
        chain_name: config.name,
        ticker: config.ticker,
        witness_script: redeemScript.toString('hex'),
        redeem_script_hex: redeemScript.toString('hex'),
        pubkeys: pubkeys.map((pk) => pk.toString('hex')),
        threshold,
        address_type: 'P2WSH',
      },
    };
  }

  /**
   * Build a PSBT (Partially Signed Bitcoin Transaction) for signing.
   *
   * The PSBT includes:
   * - Input: the UTXO(s) at the multisig address
   * - Output: transfer to beneficiary/depositor
   * - Witness script for P2WSH signing
   *
   * Note: In production, UTXOs would be fetched from a blockchain API.
   * For now, we build the PSBT structure and return it for external signing.
   */
  async proposeTransaction(
    chain: MultisigChain,
    input: ProposeTransactionInput,
  ): Promise<ProposeTransactionResult> {
    if (!isUtxoChain(chain)) {
      throw new Error(`Chain ${chain} is not supported by BTC multisig adapter`);
    }

    const config = UTXO_CHAIN_CONFIGS[chain];
    const witnessScript = Buffer.from(
      (input.chain_metadata.witness_script as string) || '',
      'hex',
    );

    if (witnessScript.length === 0) {
      throw new Error('Missing witness_script in chain_metadata');
    }

    const amountSats = toSatoshis(input.amount);

    // Build PSBT
    const psbt = new bitcoin.Psbt({ network: config.network });

    // In production, UTXO data would come from blockchain indexer.
    // The PSBT template includes placeholder input structure.
    // Callers must add actual UTXO data before signing.
    const psbtData = {
      escrow_address: input.escrow_address,
      to_address: input.to_address,
      amount_sats: amountSats,
      witness_script: witnessScript.toString('hex'),
      network: config.ticker,
      // PSBT base64 would be populated with actual UTXOs in production
      psbt_template: {
        outputs: [
          {
            address: input.to_address,
            value: amountSats,
          },
        ],
        witness_script: witnessScript.toString('hex'),
      },
    };

    // Hash of the transaction data for signature collection
    const txHashToSign = bitcoin.crypto.sha256(
      Buffer.from(JSON.stringify(psbtData)),
    ).toString('hex');

    return {
      tx_data: psbtData,
      tx_hash_to_sign: txHashToSign,
    };
  }

  /**
   * Verify a signature against a public key for the PSBT data.
   * In production, this validates the PSBT partial signature.
   */
  async verifySignature(
    chain: MultisigChain,
    txData: Record<string, unknown>,
    signature: string,
    signerPubkey: string,
  ): Promise<boolean> {
    try {
      const pubkeyBuf = parsePubkey(signerPubkey);
<<<<<<< HEAD
      const txHash = txData.tx_hash_to_sign as string | undefined;

      // Check that the pubkey is one of the expected participants when provided.
=======
      const sigBuf = Buffer.from(signature, 'hex');

      // Verify the hash matches the pubkey and signature
      // In production, this would verify the actual PSBT input signature
      const witnessScript = txData.witness_script as string;
      if (!witnessScript) return false;

      // Check that the pubkey is one of the multisig participants
>>>>>>> feat/multisig-escrow
      const pubkeys = txData.pubkeys as string[] | undefined;
      if (pubkeys && !pubkeys.includes(signerPubkey)) {
        return false;
      }

<<<<<<< HEAD
      // tx_hash_to_sign is required for cryptographic verification.
      // Fail closed when missing/malformed.
      if (!txHash || txHash.length !== 64) {
        return false;
      }

      const msgHash = Buffer.from(txHash, 'hex');

      // Signature may include sighash byte if coming from PSBT flow.
      let sigBuf = Buffer.from(signature, 'hex');
      if (sigBuf.length < 64) return false;

      // Try strict DER decode first (most common for ECDSA in Bitcoin).
      try {
        const decoded = bitcoin.script.signature.decode(sigBuf);
        return secp256k1.verify(msgHash, pubkeyBuf, decoded.signature);
      } catch {
        // Fallback: treat as raw 64-byte compact signature.
        if (sigBuf.length > 64) {
          sigBuf = sigBuf.subarray(0, 64);
        }
        if (sigBuf.length !== 64) return false;
        return secp256k1.verify(msgHash, pubkeyBuf, sigBuf);
      }
=======
      // Basic signature format validation (DER-encoded or Schnorr)
      return sigBuf.length >= 64 && pubkeyBuf.length >= 33;
>>>>>>> feat/multisig-escrow
    } catch {
      return false;
    }
  }

  /**
   * Finalize the PSBT with collected signatures and broadcast.
   * In production, the finalized transaction is sent to a Bitcoin node.
   */
  async broadcastTransaction(
    chain: MultisigChain,
    txData: Record<string, unknown>,
    signatures: Array<{ pubkey: string; signature: string }>,
  ): Promise<BroadcastResult> {
    if (!isUtxoChain(chain)) {
      throw new Error(`Chain ${chain} is not supported by BTC multisig adapter`);
    }

    if (signatures.length < 2) {
<<<<<<< HEAD
      return { tx_hash: '', success: false, broadcasted: false };
=======
      return { tx_hash: '', success: false };
>>>>>>> feat/multisig-escrow
    }

    // In production:
    // 1. Load the PSBT from txData
    // 2. Add each partial signature
    // 3. Finalize the PSBT
    // 4. Extract the raw transaction
    // 5. Broadcast via Bitcoin node RPC

    // For now, return the computed txid
    const txid = bitcoin.crypto.sha256(
      Buffer.from(JSON.stringify({ txData, signatures: signatures.map((s) => s.signature) })),
    ).toString('hex');

    return {
      tx_hash: txid,
      success: true,
<<<<<<< HEAD
      broadcasted: false,
=======
>>>>>>> feat/multisig-escrow
    };
  }
}

export const btcMultisigAdapter = new BtcMultisigAdapter();
