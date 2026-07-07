/**
 * PRD P0-4 acceptance: the extension's browser-safe signer must produce
 * byte-for-byte identical signed transactions to the CoinPay web wallet's
 * original signer for every supported chain. This runs BOTH signers over shared
 * vectors and asserts equality — a live differential test, not golden strings.
 *
 * The reference (`src/lib/web-wallet/signing.ts`) lazily `require()`s
 * crypto/tweetnacl inside its signing functions, so we install a CJS `require`
 * shim before invoking it. Its static `@noble/*` imports resolve via vite.
 */
import { createRequire } from 'node:module';
import { describe, it, expect, beforeAll } from 'vitest';
import { signTransaction as extSign, type UnsignedTransactionData } from '../signing.js';
import { signTransaction as refSign } from '../../../../../src/lib/web-wallet/signing.ts';

beforeAll(() => {
  // The reference calls require('crypto') / require('tweetnacl') at sign time.
  (globalThis as any).require ??= createRequire(import.meta.url);
});

// base58 of a byte array — builds valid 32-byte Solana pubkeys/blockhash.
function b58(bytes: number[]): string {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let out = '';
  while (num > 0n) { out = A[Number(num % 58n)] + out; num /= 58n; }
  for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
  return out || '1';
}
const key32 = (seed: number) => Array.from({ length: 32 }, (_, i) => (seed * 31 + i * 7) & 0xff);

const PRIV = 'e9873d79c6d87dc0fb6a5778633389f4453213303da61f20bd67fc233aa33262';
const btcAddr = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
const btcAddr2 = '12higDjoCCNXSA95xZMWUdPvXNmkAduhWv';

const vectors: Record<string, UnsignedTransactionData> = {
  evm_native: {
    type: 'evm', chainId: 1, nonce: 5, to: '0x' + 'ab'.repeat(20),
    value: '0x' + (10n ** 17n).toString(16), gasLimit: 21000,
    maxFeePerGas: '30000000000', maxPriorityFeePerGas: '1500000000',
  },
  evm_erc20: {
    type: 'evm', chainId: 137, nonce: 0, to: '0x' + 'cd'.repeat(20),
    value: '0x0', gasLimit: 60000, maxFeePerGas: '50000000000', maxPriorityFeePerGas: '2000000000',
    data: '0xa9059cbb' + '00'.repeat(12) + 'ef'.repeat(20) + '0'.repeat(63) + '1',
  },
  btc: {
    type: 'btc',
    inputs: [
      { txid: 'a'.repeat(64), vout: 0, value: 100000 },
      { txid: 'b'.repeat(64), vout: 2, value: 50000 },
    ],
    outputs: [{ address: btcAddr, value: 120000 }, { address: btcAddr2, value: 25000 }],
  },
  bch: {
    type: 'bch',
    inputs: [{ txid: 'c'.repeat(64), vout: 1, value: 200000 }],
    outputs: [{ address: btcAddr, value: 190000 }],
  },
  sol: {
    type: 'sol',
    recentBlockhash: b58(key32(9)),
    feePayer: b58(key32(1)),
    instructions: [{
      programId: '11111111111111111111111111111111',
      keys: [
        { pubkey: b58(key32(1)), isSigner: true, isWritable: true },
        { pubkey: b58(key32(2)), isSigner: false, isWritable: true },
      ],
      data: Buffer.from([2, 0, 0, 0, 64, 66, 15, 0, 0, 0, 0, 0]).toString('base64'),
    }],
  },
};

describe('signer parity vs web wallet (signing.ts)', () => {
  for (const [name, unsigned_tx] of Object.entries(vectors)) {
    it(`${name}: extension port matches reference byte-for-byte`, async () => {
      const ref = await refSign({ unsigned_tx: unsigned_tx as any, privateKey: PRIV });
      const ext = await extSign({ unsigned_tx, privateKey: PRIV });
      expect(ext.format).toBe(ref.format);
      expect(ext.signed_tx).toBe(ref.signed_tx);
    });
  }
});
