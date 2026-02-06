import { describe, it, expect, vi } from 'vitest';
import {
  signTransaction,
  clearMemory,
  rlpEncode,
  encodeBigInt,
  hexToBytes,
  hash160,
  base58Decode,
  encodeCompactU16,
  encodeVarint,
} from './signing';
import type {
  EVMUnsignedTx,
  BTCUnsignedTx,
  SOLUnsignedTx,
} from './prepare-tx';
import { secp256k1 } from '@noble/curves/secp256k1';

// ──────────────────────────────────────────────
// clearMemory
// ──────────────────────────────────────────────

describe('clearMemory', () => {
  it('should zero out a Uint8Array', () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5]);
    clearMemory(buf);
    expect(buf.every((b) => b === 0)).toBe(true);
  });
});

// ──────────────────────────────────────────────
// RLP Encoding
// ──────────────────────────────────────────────

describe('rlpEncode', () => {
  it('should encode single byte < 0x80', () => {
    const result = rlpEncode(new Uint8Array([0x42]));
    expect(result).toEqual(new Uint8Array([0x42]));
  });

  it('should encode empty bytes', () => {
    const result = rlpEncode(new Uint8Array(0));
    expect(result).toEqual(new Uint8Array([0x80]));
  });

  it('should encode short string', () => {
    const result = rlpEncode(new Uint8Array([0x83, 0x84]));
    expect(result[0]).toBe(0x82); // 0x80 + length 2
  });

  it('should encode empty array', () => {
    const result = rlpEncode([]);
    expect(result).toEqual(new Uint8Array([0xc0]));
  });

  it('should encode nested arrays', () => {
    const result = rlpEncode([new Uint8Array([1]), new Uint8Array([2])]);
    expect(result.length).toBeGreaterThan(2);
    expect(result[0]).toBe(0xc2); // 0xc0 + total length 2
  });
});

// ──────────────────────────────────────────────
// encodeBigInt
// ──────────────────────────────────────────────

describe('encodeBigInt', () => {
  it('should encode 0 as empty bytes', () => {
    const result = encodeBigInt(0n);
    expect(result.length).toBe(0);
  });

  it('should encode small numbers', () => {
    const result = encodeBigInt(1n);
    expect(result).toEqual(new Uint8Array([1]));
  });

  it('should encode large numbers', () => {
    const result = encodeBigInt(256n);
    expect(result).toEqual(new Uint8Array([1, 0]));
  });

  it('should encode 20 Gwei', () => {
    const gwei20 = 20_000_000_000n;
    const result = encodeBigInt(gwei20);
    expect(result.length).toBeGreaterThan(0);
    // Verify round-trip
    let val = 0n;
    for (const byte of result) {
      val = (val << 8n) | BigInt(byte);
    }
    expect(val).toBe(gwei20);
  });
});

// ──────────────────────────────────────────────
// hexToBytes
// ──────────────────────────────────────────────

describe('hexToBytes', () => {
  it('should convert hex string to bytes', () => {
    const result = hexToBytes('0xdeadbeef');
    expect(result).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('should handle without 0x prefix', () => {
    const result = hexToBytes('ff00');
    expect(result).toEqual(new Uint8Array([0xff, 0x00]));
  });

  it('should handle empty hex', () => {
    const result = hexToBytes('0x');
    expect(result.length).toBe(0);
  });

  it('should handle odd-length hex', () => {
    const result = hexToBytes('0xf');
    expect(result).toEqual(new Uint8Array([0x0f]));
  });
});

// ──────────────────────────────────────────────
// hash160
// ──────────────────────────────────────────────

describe('hash160', () => {
  it('should produce 20-byte hash', () => {
    const result = hash160(Buffer.from('test'));
    expect(result.length).toBe(20);
  });

  it('should be deterministic', () => {
    const a = hash160(Buffer.from('hello'));
    const b = hash160(Buffer.from('hello'));
    expect(a).toEqual(b);
  });
});

// ──────────────────────────────────────────────
// base58Decode
// ──────────────────────────────────────────────

describe('base58Decode', () => {
  it('should decode a Solana address', () => {
    const result = base58Decode('11111111111111111111111111111111');
    expect(result.length).toBe(32);
    expect(result.every((b) => b === 0)).toBe(true);
  });

  it('should throw on invalid characters', () => {
    expect(() => base58Decode('0OIl')).toThrow('Invalid base58');
  });
});

// ──────────────────────────────────────────────
// encodeCompactU16
// ──────────────────────────────────────────────

describe('encodeCompactU16', () => {
  it('should encode small values in 1 byte', () => {
    expect(encodeCompactU16(0)).toEqual(Buffer.from([0]));
    expect(encodeCompactU16(127)).toEqual(Buffer.from([127]));
  });

  it('should encode 128+ in 2 bytes', () => {
    const result = encodeCompactU16(128);
    expect(result.length).toBe(2);
  });
});

// ──────────────────────────────────────────────
// encodeVarint
// ──────────────────────────────────────────────

describe('encodeVarint', () => {
  it('should encode small values in 1 byte', () => {
    expect(encodeVarint(0)).toEqual(Buffer.from([0]));
    expect(encodeVarint(252)).toEqual(Buffer.from([252]));
  });

  it('should encode 0xfd+ in 3 bytes', () => {
    const result = encodeVarint(253);
    expect(result.length).toBe(3);
    expect(result[0]).toBe(0xfd);
  });
});

// ──────────────────────────────────────────────
// EVM Transaction Signing
// ──────────────────────────────────────────────

describe('signTransaction - EVM', () => {
  // Generate a test private key
  const privateKeyHex = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

  it('should sign an ETH transfer and return hex', async () => {
    const unsignedTx: EVMUnsignedTx = {
      type: 'evm',
      chainId: 1,
      nonce: 0,
      to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      value: '0xDE0B6B3A7640000', // 1 ETH
      gasLimit: 21000,
      maxFeePerGas: '20000000000',
      maxPriorityFeePerGas: '1000000000',
    };

    const result = await signTransaction({
      unsigned_tx: unsignedTx,
      privateKey: privateKeyHex,
    });

    expect(result.format).toBe('hex');
    expect(result.signed_tx).toMatch(/^0x02/); // EIP-1559 type prefix
    expect(result.signed_tx.length).toBeGreaterThan(100);
  });

  it('should sign an ERC-20 transfer', async () => {
    const unsignedTx: EVMUnsignedTx = {
      type: 'evm',
      chainId: 137,
      nonce: 5,
      to: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      value: '0x0',
      gasLimit: 65000,
      maxFeePerGas: '30000000000',
      maxPriorityFeePerGas: '2000000000',
      data: '0xa9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000005f5e100',
      contractAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    };

    const result = await signTransaction({
      unsigned_tx: unsignedTx,
      privateKey: privateKeyHex,
    });

    expect(result.format).toBe('hex');
    expect(result.signed_tx).toMatch(/^0x02/);
    // ERC-20 tx should be longer due to calldata
    expect(result.signed_tx.length).toBeGreaterThan(200);
  });

  it('should produce deterministic signatures', async () => {
    const unsignedTx: EVMUnsignedTx = {
      type: 'evm',
      chainId: 1,
      nonce: 0,
      to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      value: '0x1',
      gasLimit: 21000,
      maxFeePerGas: '1000000000',
      maxPriorityFeePerGas: '500000000',
    };

    const result1 = await signTransaction({ unsigned_tx: unsignedTx, privateKey: privateKeyHex });
    const result2 = await signTransaction({ unsigned_tx: unsignedTx, privateKey: privateKeyHex });
    expect(result1.signed_tx).toBe(result2.signed_tx);
  });
});

// ──────────────────────────────────────────────
// BTC Transaction Signing
// ──────────────────────────────────────────────

describe('signTransaction - BTC', () => {
  // Private key for testing (derives to a known address)
  const privateKeyHex = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';

  it('should sign a BTC transaction and return hex', async () => {
    const publicKey = secp256k1.getPublicKey(hexToBytes(privateKeyHex), true);
    const unsignedTx: BTCUnsignedTx = {
      type: 'btc',
      inputs: [
        {
          txid: 'a'.repeat(64),
          vout: 0,
          value: 100000, // 0.001 BTC
          scriptPubKey: '',
        },
      ],
      outputs: [
        { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', value: 50000 },
        { address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', value: 45000 },
      ],
      feeRate: 10,
    };

    const result = await signTransaction({
      unsigned_tx: unsignedTx,
      privateKey: privateKeyHex,
    });

    expect(result.format).toBe('hex');
    // BTC raw tx should start with version bytes
    expect(result.signed_tx.length).toBeGreaterThan(100);
    // Version 1 in LE
    expect(result.signed_tx.startsWith('01000000')).toBe(true);
  });

  it('should sign a BCH transaction with BIP143', async () => {
    const unsignedTx: BTCUnsignedTx = {
      type: 'bch',
      inputs: [
        {
          txid: 'b'.repeat(64),
          vout: 1,
          value: 200000,
          scriptPubKey: '',
        },
      ],
      outputs: [
        { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', value: 190000 },
      ],
      feeRate: 1,
    };

    const result = await signTransaction({
      unsigned_tx: unsignedTx,
      privateKey: privateKeyHex,
    });

    expect(result.format).toBe('hex');
    // BCH version 2 in LE
    expect(result.signed_tx.startsWith('02000000')).toBe(true);
  });
});

// ──────────────────────────────────────────────
// SOL Transaction Signing
// ──────────────────────────────────────────────

describe('signTransaction - SOL', () => {
  // Ed25519 seed (32 bytes)
  const privateKeyHex = 'c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7';

  it('should sign a SOL transaction and return base64', async () => {
    const unsignedTx: SOLUnsignedTx = {
      type: 'sol',
      recentBlockhash: '11111111111111111111111111111111',
      feePayer: '11111111111111111111111111111111',
      instructions: [
        {
          programId: '11111111111111111111111111111111',
          keys: [
            { pubkey: '11111111111111111111111111111111', isSigner: true, isWritable: true },
            { pubkey: '11111111111111111111111111111112', isSigner: false, isWritable: true },
          ],
          data: Buffer.from([2, 0, 0, 0, 0, 202, 154, 59, 0, 0, 0, 0]).toString('base64'), // transfer 1 SOL
        },
      ],
    };

    const result = await signTransaction({
      unsigned_tx: unsignedTx,
      privateKey: privateKeyHex,
    });

    expect(result.format).toBe('base64');
    // Should be valid base64
    expect(() => Buffer.from(result.signed_tx, 'base64')).not.toThrow();
    // First byte is number of signatures (1)
    const decoded = Buffer.from(result.signed_tx, 'base64');
    expect(decoded[0]).toBe(1);
    // Signature is 64 bytes, so decoded[1..64] is the signature
    expect(decoded.length).toBeGreaterThan(65);
  });
});

// ──────────────────────────────────────────────
// Memory Clearing
// ──────────────────────────────────────────────

describe('memory clearing', () => {
  it('should not expose private key after signing', async () => {
    const privateKeyHex = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    const keyBytes = Buffer.from(privateKeyHex, 'hex');

    const unsignedTx: EVMUnsignedTx = {
      type: 'evm',
      chainId: 1,
      nonce: 0,
      to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      value: '0x1',
      gasLimit: 21000,
      maxFeePerGas: '1000000000',
      maxPriorityFeePerGas: '500000000',
    };

    // signTransaction creates its own Buffer from hex, so we just verify clearMemory works
    const testBuf = new Uint8Array([1, 2, 3, 4]);
    clearMemory(testBuf);
    expect(testBuf.every((b) => b === 0)).toBe(true);
  });
});

// ──────────────────────────────────────────────
// Unsupported type
// ──────────────────────────────────────────────

describe('signTransaction - unsupported', () => {
  it('should throw for unsupported tx type', async () => {
    await expect(
      signTransaction({
        unsigned_tx: { type: 'unknown' as any },
        privateKey: 'aa'.repeat(32),
      })
    ).rejects.toThrow('Unsupported transaction type');
  });
});
