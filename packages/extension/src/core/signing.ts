/**
 * Browser-native transaction signing for the CoinPay extension.
 *
 * This is a faithful port of the CoinPay web wallet's signer
 * (`src/lib/web-wallet/signing.ts`) made safe for an MV3 service worker:
 *   - `Buffer`            → the `buffer` polyfill (identical API)
 *   - `require('crypto')` → `@noble/hashes` (sha256 / ripemd160)
 *   - `require('tweetnacl')` (ed25519) → `@noble/curves/ed25519`
 *
 * The serialization logic is kept byte-for-byte identical to the web wallet so
 * signed transactions are interchangeable. This equivalence is enforced by a
 * differential test (`__tests__/signing.diff.test.ts`) that runs this signer and
 * the web wallet's original against shared vectors and asserts equal output —
 * per PRD P0-4.
 *
 * Supported chains: EVM (ETH/POL, native + ERC-20), BTC/BCH (legacy P2PKH), SOL.
 * After signing, private key material is zeroed from memory.
 */

import { Buffer } from 'buffer';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { ripemd160 as nobleRipemd160 } from '@noble/hashes/legacy.js';

// ── Unsigned-tx shapes (mirror src/lib/web-wallet/prepare-tx.ts) ──────────────

export interface EVMUnsignedTx {
  type: 'evm';
  chainId: number;
  nonce: number;
  to: string;
  value: string; // hex wei
  gasLimit: number;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  data?: string;
  contractAddress?: string;
}

export interface UTXOInput {
  txid: string;
  vout: number;
  value: number; // satoshis
  scriptPubKey?: string;
}

export interface TxOutput {
  address: string;
  value: number; // satoshis
}

export interface BTCUnsignedTx {
  type: 'btc' | 'bch';
  inputs: UTXOInput[];
  outputs: TxOutput[];
  feeRate?: number;
}

export interface SOLInstruction {
  programId: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; // base64
}

export interface SOLUnsignedTx {
  type: 'sol';
  recentBlockhash: string;
  feePayer: string;
  instructions: SOLInstruction[];
  tokenMint?: string;
}

export type UnsignedTransactionData = EVMUnsignedTx | BTCUnsignedTx | SOLUnsignedTx;

export interface SignTransactionInput {
  unsigned_tx: UnsignedTransactionData;
  privateKey: string; // hex
}

export interface SignTransactionResult {
  signed_tx: string;
  format: 'hex' | 'base64';
}

// ── Hashing (browser-safe replacements for node:crypto) ───────────────────────

function sha256(data: Uint8Array): Buffer {
  return Buffer.from(nobleSha256(data));
}

function doubleSha256(data: Uint8Array): Buffer {
  return sha256(sha256(data));
}

/** Hash160 (SHA256 + RIPEMD160) for BTC address/script derivation. */
function hash160(data: Uint8Array): Buffer {
  return Buffer.from(nobleRipemd160(nobleSha256(data)));
}

// ── Memory clearing ───────────────────────────────────────────────────────────

export function clearMemory(buf: Uint8Array): void {
  buf.fill(0);
}

function clearBuffer(buf: Buffer): void {
  buf.fill(0);
}

// ── Unified entry point ───────────────────────────────────────────────────────

export async function signTransaction(input: SignTransactionInput): Promise<SignTransactionResult> {
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
    clearBuffer(keyBytes);
  }
}

// ── EVM (EIP-1559 / Type 2) ───────────────────────────────────────────────────

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

  const rlpUnsigned = rlpEncode(unsignedFields);
  const typedUnsigned = new Uint8Array([2, ...rlpUnsigned]);
  const hash = keccak_256(typedUnsigned);

  const sigBytes = secp256k1.sign(hash, new Uint8Array(privateKey), {
    format: 'recovered',
    prehash: false,
  });
  const recoveryBit = sigBytes[0];
  const rBytes = sigBytes.slice(1, 33);
  const sBytes = sigBytes.slice(33, 65);

  const r = stripLeadingZeros(rBytes);
  const s = stripLeadingZeros(sBytes);
  const v = recoveryBit === 0 ? new Uint8Array(0) : new Uint8Array([recoveryBit]);

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

  return { signed_tx: '0x' + Buffer.from(typedSigned).toString('hex'), format: 'hex' };
}

// ── BTC / BCH (legacy P2PKH) ──────────────────────────────────────────────────

function signBTCTransaction(tx: BTCUnsignedTx, privateKey: Buffer): SignTransactionResult {
  const publicKey = Buffer.from(secp256k1.getPublicKey(new Uint8Array(privateKey), true));
  const isBCH = tx.type === 'bch';

  const version = Buffer.alloc(4);
  version.writeUInt32LE(isBCH ? 2 : 1, 0);

  const inputCount = encodeVarint(tx.inputs.length);

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

  const locktime = Buffer.alloc(4);

  const signedInputs: Buffer[] = [];
  for (let i = 0; i < tx.inputs.length; i++) {
    const input = tx.inputs[i];

    const pubKeyHash = hash160(publicKey);
    const scriptPubKey = Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]),
      pubKeyHash,
      Buffer.from([0x88, 0xac]),
    ]);

    let preimage: Buffer;
    if (isBCH) {
      preimage = buildBIP143Preimage(tx, i, scriptPubKey, input.value);
    } else {
      preimage = buildLegacyPreimage(tx, i, scriptPubKey, version, outputs, locktime);
    }

    const sighash = doubleSha256(preimage);

    const derSig = secp256k1.sign(new Uint8Array(sighash), new Uint8Array(privateKey), {
      format: 'der',
      prehash: false,
    });

    const sighashType = isBCH ? 0x41 : 0x01;
    const sigWithType = Buffer.concat([Buffer.from(derSig), Buffer.from([sighashType])]);
    const scriptSig = Buffer.concat([
      Buffer.from([sigWithType.length]),
      sigWithType,
      Buffer.from([publicKey.length]),
      publicKey,
    ]);

    const txidBuf = Buffer.from(input.txid, 'hex').reverse();
    const voutBuf = Buffer.alloc(4);
    voutBuf.writeUInt32LE(input.vout, 0);
    const scriptSigLen = encodeVarint(scriptSig.length);
    const sequence = Buffer.from([0xff, 0xff, 0xff, 0xff]);

    signedInputs.push(Buffer.concat([txidBuf, voutBuf, scriptSigLen, scriptSig, sequence]));
  }

  const rawTx = Buffer.concat([version, inputCount, ...signedInputs, outputs, locktime]);
  return { signed_tx: rawTx.toString('hex'), format: 'hex' };
}

function buildLegacyPreimage(
  tx: BTCUnsignedTx,
  signIdx: number,
  scriptPubKey: Buffer,
  version: Buffer,
  serializedOutputs: Buffer,
  locktime: Buffer,
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
      parts.push(txidBuf, voutBuf, Buffer.from([0x00]));
    }
    parts.push(Buffer.from([0xff, 0xff, 0xff, 0xff]));
  }

  parts.push(serializedOutputs);
  parts.push(locktime);

  const sighashType = Buffer.alloc(4);
  sighashType.writeUInt32LE(0x01, 0);
  parts.push(sighashType);

  return Buffer.concat(parts);
}

function buildBIP143Preimage(
  tx: BTCUnsignedTx,
  signIdx: number,
  scriptCode: Buffer,
  value: number,
): Buffer {
  const prevouts = Buffer.concat(
    tx.inputs.map((inp) => {
      const txid = Buffer.from(inp.txid, 'hex').reverse();
      const vout = Buffer.alloc(4);
      vout.writeUInt32LE(inp.vout, 0);
      return Buffer.concat([txid, vout]);
    }),
  );
  const hashPrevouts = doubleSha256(prevouts);

  const sequences = Buffer.concat(tx.inputs.map(() => Buffer.from([0xff, 0xff, 0xff, 0xff])));
  const hashSequence = doubleSha256(sequences);

  const outputParts: Buffer[] = [];
  for (const out of tx.outputs) {
    const valueBuf = Buffer.alloc(8);
    valueBuf.writeBigUInt64LE(BigInt(out.value), 0);
    const script = addressToScriptPubKey(out.address, true);
    outputParts.push(Buffer.concat([valueBuf, encodeVarint(script.length), script]));
  }
  const hashOutputs = doubleSha256(Buffer.concat(outputParts));

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

// ── SOL (ed25519) ─────────────────────────────────────────────────────────────

async function signSOLTransaction(tx: SOLUnsignedTx, privateKey: Buffer): Promise<SignTransactionResult> {
  const seed = new Uint8Array(privateKey);
  const publicKey = ed25519.getPublicKey(seed);
  const message = buildSolanaMessage(tx, publicKey);
  const signature = ed25519.sign(new Uint8Array(message), seed);

  const numSignatures = Buffer.from([1]);
  const signatureBuf = Buffer.from(signature);
  const serializedTx = Buffer.concat([numSignatures, signatureBuf, message]);

  return { signed_tx: serializedTx.toString('base64'), format: 'base64' };
}

function buildSolanaMessage(tx: SOLUnsignedTx, _signerPubKey: Uint8Array): Buffer {
  const accountMap = new Map<string, { isSigner: boolean; isWritable: boolean }>();
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

  const entries = Array.from(accountMap.entries());
  entries.sort((a, b) => {
    if (a[0] === tx.feePayer) return -1;
    if (b[0] === tx.feePayer) return 1;
    const aScore = (a[1].isSigner ? 2 : 0) + (a[1].isWritable ? 1 : 0);
    const bScore = (b[1].isSigner ? 2 : 0) + (b[1].isWritable ? 1 : 0);
    return bScore - aScore;
  });

  const accountKeys = entries.map(([key]) => key);
  const accountMetas = entries.map(([, meta]) => meta);

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

  const header = Buffer.from([
    numRequiredSignatures,
    numReadonlySignedAccounts,
    numReadonlyUnsignedAccounts,
  ]);

  const numAccounts = encodeCompactU16(accountKeys.length);
  const keyBuffers = accountKeys.map((key) => base58Decode(key));

  const blockhash = base58Decode(tx.recentBlockhash);

  const numInstructions = encodeCompactU16(tx.instructions.length);
  const instructionBuffers: Buffer[] = [];
  for (const ix of tx.instructions) {
    const programIdIndex = accountKeys.indexOf(ix.programId);
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

// ── RLP ───────────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripLeadingZeros(bytes: Uint8Array): Uint8Array {
  let i = 0;
  while (i < bytes.length && bytes[i] === 0) i++;
  return bytes.slice(i);
}

function encodeBigInt(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array(0);
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  return hexToBytes('0x' + hex);
}

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

function addressToScriptPubKey(address: string, isBCH: boolean): Buffer {
  if (isBCH && address.includes(':')) {
    const decoded = decodeCashAddress(address);
    return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), decoded, Buffer.from([0x88, 0xac])]);
  }

  const decoded = base58CheckDecode(address);
  return Buffer.concat([
    Buffer.from([0x76, 0xa9, 0x14]),
    decoded.slice(1),
    Buffer.from([0x88, 0xac]),
  ]);
}

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

function encodeCompactU16(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x4000) {
    return Buffer.from([(n & 0x7f) | 0x80, (n >> 7) & 0x7f]);
  }
  return Buffer.from([(n & 0x7f) | 0x80, ((n >> 7) & 0x7f) | 0x80, (n >> 14) & 0x03]);
}

function base58Decode(str: string): Buffer {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const base = BigInt(ALPHABET.length);

  let num = 0n;
  for (const char of str) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base58 character: ${char}`);
    num = num * base + BigInt(idx);
  }

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

function base58CheckDecode(address: string): Buffer {
  const decoded = base58Decode(address);
  return decoded.slice(0, -4);
}

function decodeCashAddress(address: string): Buffer {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

  const parts = address.split(':');
  const payload = parts[parts.length - 1];

  const data: number[] = [];
  for (const char of payload) {
    const idx = CHARSET.indexOf(char.toLowerCase());
    if (idx === -1) throw new Error(`Invalid CashAddr character: ${char}`);
    data.push(idx);
  }

  const values = data.slice(0, -8);
  const converted = convertBits5to8(values);
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
