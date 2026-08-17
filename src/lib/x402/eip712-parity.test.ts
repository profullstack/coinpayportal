/**
 * Parity between the extension's hand-rolled EIP-712 and ethers.
 *
 * The extension cannot depend on ethers — it would add megabytes to the bundle
 * for one hash and one signature — so `packages/extension/src/core/eip712.ts`
 * implements the encoding itself on @noble primitives. That is only safe if it
 * is byte-identical to a reference implementation, because a subtly wrong
 * encoding still produces a well-formed signature: it just recovers to some
 * other address, and the only symptom is an authorization nobody can spend.
 *
 * So every case here is checked against ethers rather than against a constant
 * this file made up.
 */
import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import {
  encodeType,
  hashDomain,
  hashStruct,
  eip712Digest,
  signTypedData,
  bytesToHex,
} from '../../../packages/extension/src/core/eip712';
import { TRANSFER_WITH_AUTHORIZATION_TYPES } from './v2';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAYEE = '0x1111111111111111111111111111111111111111';

const PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const wallet = new ethers.Wallet(PRIVATE_KEY);
const privateKeyBytes = ethers.getBytes(PRIVATE_KEY);

// The real USDC-on-Base domain, as read from the deployed contract.
const DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: USDC_BASE,
};

function authorization(overrides: Record<string, string> = {}) {
  return {
    from: wallet.address,
    to: PAYEE,
    value: '6000',
    validAfter: '0',
    validBefore: '1800000000',
    nonce: '0x' + 'ab'.repeat(32),
    ...overrides,
  };
}

describe('encodeType', () => {
  it('matches the canonical EIP-3009 type string', () => {
    expect(encodeType('TransferWithAuthorization', TRANSFER_WITH_AUTHORIZATION_TYPES)).toBe(
      'TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)',
    );
  });
});

describe('hashDomain', () => {
  it('matches ethers for the real USDC domain', () => {
    expect(bytesToHex(hashDomain(DOMAIN))).toBe(ethers.TypedDataEncoder.hashDomain(DOMAIN));
  });

  it('matches ethers for a salt-based domain with no chainId', () => {
    // Polygon's bridged tokens use this shape.
    const salted = {
      name: 'USD Coin (PoS)',
      version: '1',
      verifyingContract: USDC_BASE,
      salt: ethers.zeroPadValue(ethers.toBeHex(137), 32),
    };
    expect(bytesToHex(hashDomain(salted))).toBe(ethers.TypedDataEncoder.hashDomain(salted));
  });

  it('matches ethers when version is absent', () => {
    const partial = { name: 'Token', chainId: 1, verifyingContract: USDC_BASE };
    expect(bytesToHex(hashDomain(partial))).toBe(ethers.TypedDataEncoder.hashDomain(partial));
  });

  it('refuses an empty domain rather than hashing nothing', () => {
    expect(() => hashDomain({})).toThrow(/empty/i);
  });
});

describe('hashStruct', () => {
  it('matches ethers for an EIP-3009 authorization', () => {
    const auth = authorization();
    expect(bytesToHex(hashStruct('TransferWithAuthorization', TRANSFER_WITH_AUTHORIZATION_TYPES, auth))).toBe(
      ethers.TypedDataEncoder.hashStruct(
        'TransferWithAuthorization',
        TRANSFER_WITH_AUTHORIZATION_TYPES,
        auth,
      ),
    );
  });

  it('matches across a range of values, including the extremes', () => {
    const cases = [
      authorization({ value: '0' }),
      authorization({ value: '1' }),
      // Max uint256 — where a naive bit-shift encoder overflows.
      authorization({
        value: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
      }),
      authorization({ validAfter: '1', validBefore: '2' }),
      authorization({ nonce: '0x' + '00'.repeat(32) }),
      authorization({ nonce: '0x' + 'ff'.repeat(32) }),
      // Mixed-case (checksummed) addresses must encode the same as lowercase.
      authorization({ to: PAYEE.toUpperCase().replace('0X', '0x') }),
    ];

    for (const auth of cases) {
      expect(
        bytesToHex(hashStruct('TransferWithAuthorization', TRANSFER_WITH_AUTHORIZATION_TYPES, auth)),
      ).toBe(
        ethers.TypedDataEncoder.hashStruct(
          'TransferWithAuthorization',
          TRANSFER_WITH_AUTHORIZATION_TYPES,
          auth,
        ),
      );
    }
  });

  it('matches ethers for string, bool and dynamic bytes fields', () => {
    const types = {
      Mixed: [
        { name: 'label', type: 'string' },
        { name: 'flag', type: 'bool' },
        { name: 'blob', type: 'bytes' },
        { name: 'who', type: 'address' },
      ],
    };
    const value = {
      label: 'café — 支払い',
      flag: true,
      blob: '0xdeadbeef',
      who: PAYEE,
    };

    expect(bytesToHex(hashStruct('Mixed', types, value))).toBe(
      ethers.TypedDataEncoder.hashStruct('Mixed', types, value),
    );
  });
});

describe('eip712Digest', () => {
  it('matches ethers, including the 0x1901 prefix', () => {
    const auth = authorization();
    expect(
      bytesToHex(eip712Digest(DOMAIN, TRANSFER_WITH_AUTHORIZATION_TYPES, 'TransferWithAuthorization', auth)),
    ).toBe(ethers.TypedDataEncoder.hash(DOMAIN, TRANSFER_WITH_AUTHORIZATION_TYPES, auth));
  });
});

describe('signTypedData', () => {
  it('produces a signature ethers recovers to the right signer', async () => {
    const auth = authorization();
    const signature = signTypedData(
      DOMAIN,
      TRANSFER_WITH_AUTHORIZATION_TYPES,
      'TransferWithAuthorization',
      auth,
      privateKeyBytes,
    );

    const recovered = ethers.verifyTypedData(
      DOMAIN,
      TRANSFER_WITH_AUTHORIZATION_TYPES,
      auth,
      signature,
    );
    expect(recovered).toBe(wallet.address);
  });

  it('is byte-identical to what ethers itself would sign', async () => {
    const auth = authorization();
    const mine = signTypedData(
      DOMAIN,
      TRANSFER_WITH_AUTHORIZATION_TYPES,
      'TransferWithAuthorization',
      auth,
      privateKeyBytes,
    );
    const theirs = await wallet.signTypedData(
      DOMAIN,
      TRANSFER_WITH_AUTHORIZATION_TYPES,
      auth,
    );

    expect(mine).toBe(theirs);
  });

  it('emits v as 27 or 28, which is what Solidity ecrecover expects', () => {
    // A raw 0/1 recovery bit recovers to the zero address in Solidity, so this
    // is not cosmetic.
    for (let i = 0; i < 12; i++) {
      const signature = signTypedData(
        DOMAIN,
        TRANSFER_WITH_AUTHORIZATION_TYPES,
        'TransferWithAuthorization',
        authorization({ nonce: '0x' + i.toString(16).padStart(2, '0').repeat(32) }),
        privateKeyBytes,
      );
      const v = Number.parseInt(signature.slice(-2), 16);
      expect([27, 28]).toContain(v);
    }
  });

  it('is 65 bytes', () => {
    const signature = signTypedData(
      DOMAIN,
      TRANSFER_WITH_AUTHORIZATION_TYPES,
      'TransferWithAuthorization',
      authorization(),
      privateKeyBytes,
    );
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it('signs a low-s signature, as Ethereum requires', () => {
    // High-s signatures are malleable and rejected by EIP-2. ethers agreeing
    // byte-for-byte above already implies this, but it is asserted directly so
    // a regression names the actual problem.
    const signature = signTypedData(
      DOMAIN,
      TRANSFER_WITH_AUTHORIZATION_TYPES,
      'TransferWithAuthorization',
      authorization(),
      privateKeyBytes,
    );
    const s = BigInt('0x' + signature.slice(2 + 64, 2 + 128));
    const halfOrder = BigInt(
      '0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0',
    );
    expect(s <= halfOrder).toBe(true);
  });
});

describe('refusals', () => {
  it('rejects an unsupported type rather than encoding it wrongly', () => {
    expect(() =>
      hashStruct('Bad', { Bad: [{ name: 'xs', type: 'uint256[]' }] }, { xs: [1, 2] }),
    ).toThrow(/unsupported/i);
  });

  it('rejects a malformed address', () => {
    expect(() =>
      hashStruct('T', { T: [{ name: 'a', type: 'address' }] }, { a: '0x1234' }),
    ).toThrow(/20 bytes/i);
  });

  it('rejects a wrong-width bytes32', () => {
    expect(() =>
      hashStruct('T', { T: [{ name: 'n', type: 'bytes32' }] }, { n: '0xdeadbeef' }),
    ).toThrow(/32 bytes/i);
  });

  it('rejects a negative uint', () => {
    expect(() =>
      hashStruct('T', { T: [{ name: 'v', type: 'uint256' }] }, { v: '-1' }),
    ).toThrow(/negative/i);
  });

  it('rejects a value wider than uint256', () => {
    expect(() =>
      hashStruct('T', { T: [{ name: 'v', type: 'uint256' }] }, { v: (1n << 256n).toString() }),
    ).toThrow(/exceeds uint256/i);
  });
});
