/**
 * EIP-712 typed-data hashing and signing.
 *
 * The wallet could sign transactions and nothing else, which is why it could
 * not pay an x402 invoice: the `exact` scheme is an EIP-3009
 * `TransferWithAuthorization`, and that is typed data, not a transaction.
 *
 * Built on the same primitives the rest of the wallet uses — `@noble/curves`
 * and `@noble/hashes` — rather than pulling in ethers, which would add
 * megabytes to an extension bundle for one hash function and one signature.
 *
 * Only the encodings EIP-3009 needs are implemented: atomic types plus
 * `string` and `bytes`. Nested structs and arrays throw rather than encode
 * wrongly, because a silently wrong encoding produces a signature that
 * recovers to some other address, and the only symptom is an authorization
 * nobody can spend.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

export interface TypedDataField {
  name: string;
  type: string;
}

export type TypedDataTypes = Record<string, TypedDataField[]>;

export interface TypedDataDomain {
  name?: string;
  version?: string;
  chainId?: number | bigint | string;
  verifyingContract?: string;
  salt?: string;
}

/** Fields of EIP712Domain, in the order the spec fixes. */
const DOMAIN_FIELDS: TypedDataField[] = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
  { name: 'salt', type: 'bytes32' },
];

const utf8 = new TextEncoder();

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error(`Odd-length hex: ${hex}`);
  if (clean.length > 0 && !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error(`Not hex: ${hex}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `0x${hex}`;
}

/** A 32-byte big-endian encoding of a non-negative integer. */
function encodeUint(value: unknown): Uint8Array {
  let n: bigint;
  try {
    n = BigInt(value as string | number | bigint);
  } catch {
    throw new Error(`Not an integer: ${String(value)}`);
  }
  if (n < 0n) throw new Error(`Negative value for an unsigned field: ${n}`);
  if (n >= 1n << 256n) throw new Error(`Value exceeds uint256: ${n}`);

  const out = new Uint8Array(32);
  for (let i = 31; i >= 0 && n > 0n; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

/** A 20-byte address, left-padded into a 32-byte word. */
function encodeAddress(value: unknown): Uint8Array {
  const bytes = hexToBytes(String(value));
  if (bytes.length !== 20) {
    throw new Error(`Address must be 20 bytes, got ${bytes.length}: ${String(value)}`);
  }
  const out = new Uint8Array(32);
  out.set(bytes, 12);
  return out;
}

/** Encode one field to its 32-byte EIP-712 representation. */
function encodeValue(type: string, value: unknown): Uint8Array {
  if (type === 'string') {
    return keccak_256(utf8.encode(String(value ?? '')));
  }
  if (type === 'bytes') {
    return keccak_256(hexToBytes(String(value ?? '0x')));
  }
  if (type === 'address') {
    return encodeAddress(value);
  }
  if (type === 'bool') {
    const out = new Uint8Array(32);
    out[31] = value ? 1 : 0;
    return out;
  }

  const fixedBytes = /^bytes([0-9]{1,2})$/.exec(type);
  if (fixedBytes) {
    const width = Number(fixedBytes[1]);
    if (width < 1 || width > 32) throw new Error(`Invalid fixed-bytes width: ${type}`);
    const bytes = hexToBytes(String(value));
    if (bytes.length !== width) {
      throw new Error(`${type} must be ${width} bytes, got ${bytes.length}`);
    }
    const out = new Uint8Array(32);
    out.set(bytes, 0); // fixed bytes are RIGHT-padded
    return out;
  }

  if (/^uint([0-9]{1,3})?$/.test(type)) {
    return encodeUint(value);
  }

  // Arrays and nested structs would need recursive encoding. Refusing is the
  // only safe response: a wrong encoding still yields a valid-looking
  // signature, for an authorization that recovers to the wrong signer.
  throw new Error(`Unsupported EIP-712 type: ${type}`);
}

/**
 * The canonical type string, e.g.
 * `TransferWithAuthorization(address from,address to,...)`.
 */
export function encodeType(primaryType: string, types: TypedDataTypes): string {
  const fields = types[primaryType];
  if (!fields) throw new Error(`Unknown type: ${primaryType}`);
  const args = fields.map((f) => `${f.type} ${f.name}`).join(',');
  return `${primaryType}(${args})`;
}

export function typeHash(primaryType: string, types: TypedDataTypes): Uint8Array {
  return keccak_256(utf8.encode(encodeType(primaryType, types)));
}

/** `keccak256(typeHash ‖ encodeData(...))`. */
export function hashStruct(
  primaryType: string,
  types: TypedDataTypes,
  data: Record<string, unknown>,
): Uint8Array {
  const fields = types[primaryType];
  if (!fields) throw new Error(`Unknown type: ${primaryType}`);

  const parts: Uint8Array[] = [typeHash(primaryType, types)];
  for (const field of fields) {
    parts.push(encodeValue(field.type, data[field.name]));
  }

  const buf = new Uint8Array(parts.length * 32);
  parts.forEach((p, i) => buf.set(p, i * 32));
  return keccak_256(buf);
}

/**
 * The domain separator.
 *
 * Only the fields actually present are included, and in the spec's order. A
 * domain that lists a field the token omits (or vice versa) hashes to a
 * different separator, and the signature is then rejected on-chain.
 */
export function hashDomain(domain: TypedDataDomain): Uint8Array {
  const present = DOMAIN_FIELDS.filter(
    (f) => domain[f.name as keyof TypedDataDomain] !== undefined,
  );
  if (present.length === 0) throw new Error('EIP-712 domain is empty');

  return hashStruct('EIP712Domain', { EIP712Domain: present }, domain as Record<string, unknown>);
}

/**
 * The 32-byte digest a signature is made over:
 * `keccak256(0x19 ‖ 0x01 ‖ domainSeparator ‖ hashStruct(message))`.
 */
export function eip712Digest(
  domain: TypedDataDomain,
  types: TypedDataTypes,
  primaryType: string,
  message: Record<string, unknown>,
): Uint8Array {
  const domainSeparator = hashDomain(domain);
  const structHash = hashStruct(primaryType, types, message);

  const preimage = new Uint8Array(2 + 32 + 32);
  preimage[0] = 0x19;
  preimage[1] = 0x01;
  preimage.set(domainSeparator, 2);
  preimage.set(structHash, 34);

  return keccak_256(preimage);
}

/**
 * Sign typed data, returning a 65-byte `r ‖ s ‖ v` signature as hex.
 *
 * `v` is 27/28 rather than 0/1. Both conventions exist, but Solidity's
 * `ecrecover` — which is what `transferWithAuthorization` calls — expects
 * 27/28, and a signature with a raw recovery bit simply recovers to the zero
 * address there.
 */
export function signTypedData(
  domain: TypedDataDomain,
  types: TypedDataTypes,
  primaryType: string,
  message: Record<string, unknown>,
  privateKey: Uint8Array,
): string {
  const digest = eip712Digest(domain, types, primaryType, message);

  // `format: 'recovered'` yields [recovery, r(32), s(32)]. `prehash: false`
  // because the digest is already the hash to sign — hashing it again would
  // sign the wrong thing.
  const signed = secp256k1.sign(digest, privateKey, { format: 'recovered', prehash: false });

  if (signed.length !== 65) {
    throw new Error(`Expected a 65-byte recovered signature, got ${signed.length}`);
  }
  const recovery = signed[0] as number;

  const out = new Uint8Array(65);
  out.set(signed.slice(1, 65), 0); // r ‖ s
  out[64] = recovery + 27;

  return bytesToHex(out);
}
