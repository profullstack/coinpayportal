/**
 * Web Wallet Client-Side Transaction Signing
 *
 * Signs unsigned transactions prepared by the server.
 * This module is designed to run CLIENT-SIDE — private keys never leave the client.
 *
 * Supported chains:
 *   - EVM (ETH, POL, USDC_ETH, USDC_POL): RLP-encoded EIP-1559 transactions
 *   - BTC/BCH: P2PKH transaction signing
 *   - SOL: Ed25519 transaction signing
 *
 * After signing, private key material is zeroed from memory.
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3.js';
import type {
  UnsignedTransactionData,
  EVMUnsignedTx,
  BTCUnsignedTx,
  SOLUnsignedTx,
} from './prepare-tx';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface SignTransactionInput {
  /** Unsigned transaction data from prepare-tx */
  unsigned_tx: UnsignedTransactionData;
  /** Private key in hex format */
  privateKey: string;
}

export interface SignTransactionResult {
  /** Signed transaction hex (EVM/BTC) or base64 (SOL) */
  signed_tx: string;
  /** Format of the signed output */
  format: 'hex' | 'base64';
}

// ──────────────────────────────────────────────
// Memory Clearing
// ──────────────────────────────────────────────

/**
 * Zero out a Uint8Array to clear private key material from memory.
 */
export function clearMemory(buf: Uint8Array): void {
  buf.fill(0);
}

/**
 * Zero out a Buffer to clear private key material from memory.
 */
function clearBuffer(buf: Buffer): void {
  buf.fill(0);
}

// ──────────────────────────────────────────────
// Unified Signing Interface
// ──────────────────────────────────────────────

/**
 * Sign an unsigned transaction with the given private key.
 * After signing, the private key buffer is zeroed.
 */
export async function signTransaction(
  input: SignTransactionInput
): Promise<SignTransactionResult> {
  const { unsigned_tx, privateKey } = input;
  const keyBytes = Buffer.from(privateKey, 'hex');

  try {
    switch (unsigned_tx.type) {
      case 'evm':
        return signEVMTransaction(unsigned_tx, keyBytes);
      case 'btc':
      case 'bch':
        return signBTCTransaction(unsigned_tx, keyBytes);
      case 'sol':
        return await signSOLTransaction(unsigned_tx, keyBytes);
      default:
        throw new Error(`Unsupported transaction type: ${(unsigned_tx as any).type}`);
    }
  } finally {
    // Always clear private key material
    clearBuffer(keyBytes);
  }
}

// ──────────────────────────────────────────────
// EVM Transaction Signing (EIP-1559)
// ──────────────────────────────────────────────

/**
 * Sign an EVM transaction (EIP-1559 / Type 2).
 *
 * Encoding: 0x02 || RLP([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas,
 *                         gasLimit, to, value, data, accessList])
 * Then sign the keccak256 hash.
 * Final: 0x02 || RLP([...fields, v, r, s])
 */
function signEVMTransaction(tx: EVMUnsignedTx, privateKey: Buffer): SignTransactionResult {
  const chainId = BigInt(tx.chainId);
  const nonce = BigInt(tx.nonce);
  const maxPriorityFeePerGas = BigInt(tx.maxPriorityFeePerGas);
  const maxFeePerGas = BigInt(tx.maxFeePerGas);
  const gasLimit = BigInt(tx.gasLimit);
  const to = tx.to;
  const value = BigInt(tx.value);
  const data = tx.data ? hexToBytes(tx.data) : new Uint8Array(0);
  const accessList: any[] = [];

  // Build the unsigned transaction fields for RLP encoding
  const unsignedFields = [
    encodeBigInt(chainId),
    encodeBigInt(nonce),
    encodeBigInt(maxPriorityFeePerGas),
    encodeBigInt(maxFeePerGas),
    encodeBigInt(gasLimit),
    hexToBytes(to),
    encodeBigInt(value),
    data,
    accessList,
  ];

  // Encode unsigned tx: 0x02 || RLP(fields)
  const rlpUnsigned = rlpEncode(unsignedFields);
  const typedUnsigned = new Uint8Array([2, ...rlpUnsigned]);

  // Hash with keccak256
  const hash = keccak_256(typedUnsigned);

  // Sign with secp256k1 (v2.0 API: prehash: false since we already hashed with keccak256)
  // 'recovered' format returns 65 bytes: [recovery_bit, ...r(32), ...s(32)]
  const sigBytes = secp256k1.sign(hash, new Uint8Array(privateKey), {
    format: 'recovered',
    prehash: false,
  });
  const recoveryBit = sigBytes[0];
  const rBytes = sigBytes.slice(1, 33);
  const sBytes = sigBytes.slice(33, 65);

  // Strip leading zeros for RLP encoding (minimal encoding)
  const r = stripLeadingZeros(rBytes);
  const s = stripLeadingZeros(sBytes);
  const v = recoveryBit === 0 ? new Uint8Array(0) : new Uint8Array([recoveryBit]);

  // Build signed transaction
  const signedFields = [
    encodeBigInt(chainId),
    encodeBigInt(nonce),
    encodeBigInt(maxPriorityFeePerGas),
    encodeBigInt(maxFeePerGas),
    encodeBigInt(gasLimit),
    hexToBytes(to),
    encodeBigInt(value),
    data,
    accessList,
    v,
    r,
    s,
  ];

  const rlpSigned = rlpEncode(signedFields);
  const typedSigned = new Uint8Array([2, ...rlpSigned]);

  return {
    signed_tx: '0x' + Buffer.from(typedSigned).toString('hex'),
    format: 'hex',
  };
}

// ──────────────────────────────────────────────
// BTC / BCH Transaction Signing (P2PKH)
// ──────────────────────────────────────────────

/**
 * Sign a BTC/BCH transaction.
 * Builds a simple P2PKH transaction and signs each input.
 *
 * Output: raw transaction hex ready for broadcast.
 */
function signBTCTransaction(tx: BTCUnsignedTx, privateKey: Buffer): SignTransactionResult {
  const { createHash } = require('crypto');
  const publicKey = Buffer.from(secp256k1.getPublicKey(new Uint8Array(privateKey), true));

  // Build the raw transaction
  const isBCH = tx.type === 'bch';

  // Version (4 bytes LE)
  const version = Buffer.alloc(4);
  version.writeUInt32LE(isBCH ? 2 : 1, 0);

  // Number of inputs (varint)
  const inputCount = encodeVarint(tx.inputs.length);

  // Build output buffers
  const outputBuffers: Buffer[] = [];
  for (const output of tx.outputs) {
    const valueBuf = Buffer.alloc(8);
    valueBuf.writeBigUInt64LE(BigInt(output.value), 0);

    const scriptPubKey = addressToScriptPubKey(output.address, isBCH);
    const scriptLen = encodeVarint(scriptPubKey.length);

    outputBuffers.push(Buffer.concat([valueBuf, scriptLen, scriptPubKey]));
  }

  const outputCount = encodeVarint(tx.outputs.length);
  const outputs = Buffer.concat([outputCount, ...outputBuffers]);

  // Locktime (4 bytes LE)
  const locktime = Buffer.alloc(4);

  // Sign each input
  const signedInputs: Buffer[] = [];

  for (let i = 0; i < tx.inputs.length; i++) {
    const input = tx.inputs[i];

    // Build the P2PKH script for the signer's address
    const pubKeyHash = hash160(publicKey);
    const scriptPubKey = Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]), // OP_DUP OP_HASH160 PUSH20
      pubKeyHash,
      Buffer.from([0x88, 0xac]),        // OP_EQUALVERIFY OP_CHECKSIG
    ]);

    // Build pre-image for signing
    let preimage: Buffer;

    if (isBCH) {
      // BIP143 (BCH uses sighash algorithm from BIP143)
      preimage = buildBIP143Preimage(tx, i, scriptPubKey, input.value);
    } else {
      // Legacy sighash: replace scriptSig with scriptPubKey for the input being signed
      preimage = buildLegacyPreimage(tx, i, scriptPubKey, version, outputs, locktime);
    }

    // Double SHA256 for sighash
    const hash1 = createHash('sha256').update(preimage).digest();
    const sighash = createHash('sha256').update(hash1).digest();

    // Sign with secp256k1 (v2.0 API: prehash: false since we already double-SHA256'd)
    // 'der' format returns DER-encoded signature directly
    const derSig = secp256k1.sign(new Uint8Array(sighash), new Uint8Array(privateKey), {
      format: 'der',
      prehash: false,
    });

    // scriptSig: <sig + sighash_type> <pubkey>
    const sighashType = isBCH ? 0x41 : 0x01; // BCH uses SIGHASH_ALL | SIGHASH_FORKID
    const sigWithType = Buffer.concat([Buffer.from(derSig), Buffer.from([sighashType])]);
    const scriptSig = Buffer.concat([
      Buffer.from([sigWithType.length]),
      sigWithType,
      Buffer.from([publicKey.length]),
      publicKey,
    ]);

    // Build input buffer
    const txidBuf = Buffer.from(input.txid, 'hex').reverse(); // LE
    const voutBuf = Buffer.alloc(4);
    voutBuf.writeUInt32LE(input.vout, 0);
    const scriptSigLen = encodeVarint(scriptSig.length);
    const sequence = Buffer.from([0xff, 0xff, 0xff, 0xff]);

    signedInputs.push(Buffer.concat([txidBuf, voutBuf, scriptSigLen, scriptSig, sequence]));
  }

  // Assemble final transaction
  const rawTx = Buffer.concat([
    version,
    inputCount,
    ...signedInputs,
    outputs,
    locktime,
  ]);

  return {
    signed_tx: rawTx.toString('hex'),
    format: 'hex',
  };
}

function buildLegacyPreimage(
  tx: BTCUnsignedTx,
  signIdx: number,
  scriptPubKey: Buffer,
  version: Buffer,
  serializedOutputs: Buffer,
  locktime: Buffer
): Buffer {
  const parts: Buffer[] = [version];
  parts.push(encodeVarint(tx.inputs.length));

  for (let i = 0; i < tx.inputs.length; i++) {
    const input = tx.inputs[i];
    const txidBuf = Buffer.from(input.txid, 'hex').reverse();
    const voutBuf = Buffer.alloc(4);
    voutBuf.writeUInt32LE(input.vout, 0);

    if (i === signIdx) {
      parts.push(txidBuf, voutBuf, encodeVarint(scriptPubKey.length), scriptPubKey);
    } else {
      parts.push(txidBuf, voutBuf, Buffer.from([0x00])); // Empty scriptSig
    }
    parts.push(Buffer.from([0xff, 0xff, 0xff, 0xff])); // sequence
  }

  parts.push(serializedOutputs);
  parts.push(locktime);

  // SIGHASH_ALL (4 bytes LE)
  const sighashType = Buffer.alloc(4);
  sighashType.writeUInt32LE(0x01, 0);
  parts.push(sighashType);

  return Buffer.concat(parts);
}

function buildBIP143Preimage(
  tx: BTCUnsignedTx,
  signIdx: number,
  scriptCode: Buffer,
  value: number
): Buffer {
  const { createHash } = require('crypto');

  // hashPrevouts
  const prevouts = Buffer.concat(
    tx.inputs.map((inp) => {
      const txid = Buffer.from(inp.txid, 'hex').reverse();
      const vout = Buffer.alloc(4);
      vout.writeUInt32LE(inp.vout, 0);
      return Buffer.concat([txid, vout]);
    })
  );
  const hashPrevouts = doubleSha256(prevouts);

  // hashSequence
  const sequences = Buffer.concat(
    tx.inputs.map(() => Buffer.from([0xff, 0xff, 0xff, 0xff]))
  );
  const hashSequence = doubleSha256(sequences);

  // hashOutputs
  const outputParts: Buffer[] = [];
  for (const out of tx.outputs) {
    const valueBuf = Buffer.alloc(8);
    valueBuf.writeBigUInt64LE(BigInt(out.value), 0);
    const script = addressToScriptPubKey(out.address, true);
    outputParts.push(Buffer.concat([valueBuf, encodeVarint(script.length), script]));
  }
  const hashOutputs = doubleSha256(Buffer.concat(outputParts));

  // Build preimage
  const version = Buffer.alloc(4);
  version.writeUInt32LE(2, 0);

  const input = tx.inputs[signIdx];
  const outpoint = Buffer.concat([
    Buffer.from(input.txid, 'hex').reverse(),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(input.vout, 0); return b; })(),
  ]);

  const scriptCodeWithLen = Buffer.concat([encodeVarint(scriptCode.length), scriptCode]);

  const valueBuf = Buffer.alloc(8);
  valueBuf.writeBigUInt64LE(BigInt(value), 0);

  const sequence = Buffer.from([0xff, 0xff, 0xff, 0xff]);
  const locktime = Buffer.alloc(4);

  // SIGHASH_ALL | SIGHASH_FORKID for BCH
  const sighashType = Buffer.alloc(4);
  sighashType.writeUInt32LE(0x41, 0);

  return Buffer.concat([
    version,
    hashPrevouts,
    hashSequence,
    outpoint,
    scriptCodeWithLen,
    valueBuf,
    sequence,
    hashOutputs,
    locktime,
    sighashType,
  ]);
}

function doubleSha256(data: Buffer): Buffer {
  const { createHash } = require('crypto');
  const h1 = createHash('sha256').update(data).digest();
  return createHash('sha256').update(h1).digest();
}

// ──────────────────────────────────────────────
// SOL Transaction Signing
// ──────────────────────────────────────────────

/**
 * Sign a Solana transaction using Ed25519.
 * Output: base64-encoded signed transaction.
 */
async function signSOLTransaction(tx: SOLUnsignedTx, privateKey: Buffer): Promise<SignTransactionResult> {
  const nacl = require('tweetnacl');

  // Derive Ed25519 keypair from seed (32 bytes)
  const keyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(privateKey));

  // Build the Solana transaction message
  const message = buildSolanaMessage(tx, keyPair.publicKey);

  // Sign the message
  const signature = nacl.sign.detached(message, keyPair.secretKey);

  // Build the serialized transaction
  // Format: [num_signatures, ...signatures, message]
  const numSignatures = Buffer.from([1]);
  const signatureBuf = Buffer.from(signature);

  const serializedTx = Buffer.concat([numSignatures, signatureBuf, message]);

  // Clear the secret key
  clearMemory(keyPair.secretKey);

  return {
    signed_tx: serializedTx.toString('base64'),
    format: 'base64',
  };
}

/**
 * Build a Solana transaction message for signing.
 * Format: [header, account_keys, recent_blockhash, instructions]
 */
function buildSolanaMessage(tx: SOLUnsignedTx, signerPubKey: Uint8Array): Buffer {
  // Collect all accounts
  const accountMap = new Map<string, { isSigner: boolean; isWritable: boolean }>();

  // Fee payer is always first, always signer + writable
  accountMap.set(tx.feePayer, { isSigner: true, isWritable: true });

  for (const ix of tx.instructions) {
    if (!accountMap.has(ix.programId)) {
      accountMap.set(ix.programId, { isSigner: false, isWritable: false });
    }
    for (const key of ix.keys) {
      const existing = accountMap.get(key.pubkey);
      if (existing) {
        existing.isSigner = existing.isSigner || key.isSigner;
        existing.isWritable = existing.isWritable || key.isWritable;
      } else {
        accountMap.set(key.pubkey, { isSigner: key.isSigner, isWritable: key.isWritable });
      }
    }
  }

  // Sort accounts: signers+writable, signers+readonly, non-signers+writable, non-signers+readonly
  const entries = Array.from(accountMap.entries());
  entries.sort((a, b) => {
    // Fee payer always first
    if (a[0] === tx.feePayer) return -1;
    if (b[0] === tx.feePayer) return 1;

    const aScore = (a[1].isSigner ? 2 : 0) + (a[1].isWritable ? 1 : 0);
    const bScore = (b[1].isSigner ? 2 : 0) + (b[1].isWritable ? 1 : 0);
    return bScore - aScore;
  });

  const accountKeys = entries.map(([key]) => key);
  const accountMetas = entries.map(([, meta]) => meta);

  // Count header values
  let numRequiredSignatures = 0;
  let numReadonlySignedAccounts = 0;
  let numReadonlyUnsignedAccounts = 0;

  for (const meta of accountMetas) {
    if (meta.isSigner) {
      numRequiredSignatures++;
      if (!meta.isWritable) numReadonlySignedAccounts++;
    } else {
      if (!meta.isWritable) numReadonlyUnsignedAccounts++;
    }
  }

  // Header (3 bytes)
  const header = Buffer.from([
    numRequiredSignatures,
    numReadonlySignedAccounts,
    numReadonlyUnsignedAccounts,
  ]);

  // Account keys (compact-u16 length + 32-byte keys)
  const numAccounts = encodeCompactU16(accountKeys.length);
  const keyBuffers = accountKeys.map((key) => base58Decode(key));

  // Recent blockhash (32 bytes)
  const blockhash = base58Decode(tx.recentBlockhash);

  // Instructions
  const numInstructions = encodeCompactU16(tx.instructions.length);
  const instructionBuffers: Buffer[] = [];

  for (const ix of tx.instructions) {
    const programIdIndex = accountKeys.indexOf(ix.programId);

    // Account indices
    const accountIndices = ix.keys.map((key) => accountKeys.indexOf(key.pubkey));

    const ixBuf = Buffer.concat([
      Buffer.from([programIdIndex]),
      encodeCompactU16(accountIndices.length),
      Buffer.from(accountIndices),
      encodeCompactU16(Buffer.from(ix.data, 'base64').length),
      Buffer.from(ix.data, 'base64'),
    ]);

    instructionBuffers.push(ixBuf);
  }

  return Buffer.concat([
    header,
    numAccounts,
    ...keyBuffers,
    blockhash,
    numInstructions,
    ...instructionBuffers,
  ]);
}

// ──────────────────────────────────────────────
// RLP Encoding (minimal implementation for EVM)
// ──────────────────────────────────────────────

function rlpEncode(input: any): Uint8Array {
  if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length === 1 && bytes[0] < 0x80) {
      return bytes;
    }
    return new Uint8Array([...rlpEncodeLength(bytes.length, 0x80), ...bytes]);
  }

  if (Array.isArray(input)) {
    const encoded = input.map((item) => rlpEncode(item));
    const totalLen = encoded.reduce((sum, e) => sum + e.length, 0);
    const concat = new Uint8Array(totalLen);
    let offset = 0;
    for (const e of encoded) {
      concat.set(e, offset);
      offset += e.length;
    }
    return new Uint8Array([...rlpEncodeLength(totalLen, 0xc0), ...concat]);
  }

  throw new Error(`Cannot RLP encode: ${typeof input}`);
}

function rlpEncodeLength(len: number, offset: number): number[] {
  if (len < 56) {
    return [offset + len];
  }
  const hexLen = len.toString(16);
  const lenBytes = hexLen.length % 2 === 0 ? hexLen : '0' + hexLen;
  const numBytes = lenBytes.length / 2;
  return [offset + 55 + numBytes, ...hexToArray(lenBytes)];
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Strip leading zero bytes from a Uint8Array. */
function stripLeadingZeros(bytes: Uint8Array): Uint8Array {
  let i = 0;
  while (i < bytes.length && bytes[i] === 0) i++;
  return bytes.slice(i);
}

/** Encode a BigInt as a minimal byte array (no leading zeros). */
function encodeBigInt(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array(0);
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  return hexToBytes('0x' + hex);
}

/** Convert hex string to bytes. */
function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length === 0) return new Uint8Array(0);
  const padded = h.length % 2 !== 0 ? '0' + h : h;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function hexToArray(hex: string): number[] {
  const result: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    result.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return result;
}

/** Hash160 (SHA256 + RIPEMD160) for BTC address derivation. */
function hash160(data: Buffer): Buffer {
  const { createHash } = require('crypto');
  const sha256 = createHash('sha256').update(data).digest();
  return createHash('ripemd160').update(sha256).digest();
}

/** Convert a BTC/BCH address to a scriptPubKey (P2PKH). */
function addressToScriptPubKey(address: string, isBCH: boolean): Buffer {
  // For BCH CashAddr format, decode the address
  if (isBCH && address.includes(':')) {
    const decoded = decodeCashAddress(address);
    return Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]),
      decoded,
      Buffer.from([0x88, 0xac]),
    ]);
  }

  // Legacy P2PKH: base58check decode, extract hash160
  const decoded = base58CheckDecode(address);
  return Buffer.concat([
    Buffer.from([0x76, 0xa9, 0x14]),
    decoded.slice(1), // Remove version byte
    Buffer.from([0x88, 0xac]),
  ]);
}

/** Encode integer as Bitcoin-style varint. */
function encodeVarint(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const buf = Buffer.alloc(3);
    buf[0] = 0xfd;
    buf.writeUInt16LE(n, 1);
    return buf;
  }
  const buf = Buffer.alloc(5);
  buf[0] = 0xfe;
  buf.writeUInt32LE(n, 1);
  return buf;
}

/** Encode as Solana compact-u16. */
function encodeCompactU16(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x4000) {
    return Buffer.from([
      (n & 0x7f) | 0x80,
      (n >> 7) & 0x7f,
    ]);
  }
  return Buffer.from([
    (n & 0x7f) | 0x80,
    ((n >> 7) & 0x7f) | 0x80,
    (n >> 14) & 0x03,
  ]);
}

/** Base58 decode (for Solana addresses). */
function base58Decode(str: string): Buffer {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const base = BigInt(ALPHABET.length);

  let num = 0n;
  for (const char of str) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base58 character: ${char}`);
    num = num * base + BigInt(idx);
  }

  // Count leading zeros (base58 '1' = zero byte)
  let leadingZeros = 0;
  for (const char of str) {
    if (char === '1') leadingZeros++;
    else break;
  }

  if (num === 0n) {
    return Buffer.alloc(leadingZeros);
  }

  let hex = num.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;

  const bytes = Buffer.from(hex, 'hex');
  if (leadingZeros > 0) {
    return Buffer.concat([Buffer.alloc(leadingZeros), bytes]);
  }
  return bytes;
}

/** Base58Check decode (for Bitcoin addresses). */
function base58CheckDecode(address: string): Buffer {
  const decoded = base58Decode(address);
  // Remove 4-byte checksum
  return decoded.slice(0, -4);
}

/** Decode BCH CashAddr format to hash160. */
function decodeCashAddress(address: string): Buffer {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

  const parts = address.split(':');
  const payload = parts[parts.length - 1]; // Handle with or without prefix

  const data: number[] = [];
  for (const char of payload) {
    const idx = CHARSET.indexOf(char.toLowerCase());
    if (idx === -1) throw new Error(`Invalid CashAddr character: ${char}`);
    data.push(idx);
  }

  // Remove 8-byte checksum (last 8 5-bit values)
  const values = data.slice(0, -8);

  // Convert from 5-bit to 8-bit
  const converted = convertBits5to8(values);
  // First byte is version, rest is hash
  return Buffer.from(converted.slice(1));
}

function convertBits5to8(data: number[]): number[] {
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  const maxv = 0xff;

  for (const value of data) {
    acc = (acc << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      result.push((acc >> bits) & maxv);
    }
  }

  return result;
}

// Export for testing
export {
  rlpEncode,
  encodeBigInt,
  hexToBytes,
  hash160,
  base58Decode,
  encodeCompactU16,
  encodeVarint,
};
