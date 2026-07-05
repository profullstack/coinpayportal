import { describe, it, expect } from 'vitest';
import { deriveAddress } from '@profullstack/coinpay/wallet';
import { seedFromMnemonic, deriveChainAddress, deriveAllAddresses } from '../derivation.js';
import { DEFAULT_CHAINS } from '../chains.js';

// Standard BIP-39 test vector.
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Regression fixture — the addresses the CoinPay web wallet / SDK produce for
// the vector above. Captured from `@profullstack/coinpay` deriveAddress().
// The ETH value is the canonical m/44'/60'/0'/0/0 address for this mnemonic,
// which cross-checks BIP-44 derivation against standard tooling.
const EXPECTED: Record<string, string> = {
  BTC: '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA', // legacy P2PKH (1...), NOT segwit
  BCH: 'bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6',
  ETH: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
  POL: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94', // same key path as ETH
  SOL: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk',
};

describe('derivation parity with CoinPay web wallet', () => {
  it('produces a deterministic 64-byte seed (no passphrase)', () => {
    const a = seedFromMnemonic(TEST_MNEMONIC);
    const b = seedFromMnemonic('  ' + TEST_MNEMONIC + '  ');
    expect(a).toHaveLength(64);
    expect([...a]).toEqual([...b]); // trimming matches SDK behaviour
  });

  it('matches the known-good address fixture for every default chain', () => {
    const seed = seedFromMnemonic(TEST_MNEMONIC);
    for (const chain of DEFAULT_CHAINS) {
      expect(deriveChainAddress(seed, chain)).toBe(EXPECTED[chain]);
    }
  });

  it('BTC is a legacy P2PKH (1...) address, matching the web wallet', () => {
    const seed = seedFromMnemonic(TEST_MNEMONIC);
    expect(deriveChainAddress(seed, 'BTC').startsWith('1')).toBe(true);
  });

  it('wraps the SDK exactly (no divergence from deriveAddress)', () => {
    const seed = seedFromMnemonic(TEST_MNEMONIC);
    for (const chain of DEFAULT_CHAINS) {
      expect(deriveChainAddress(seed, chain)).toBe(deriveAddress(seed, chain, 0));
    }
  });

  it('deriveAllAddresses surfaces USDC on ETH/POL/SOL only', () => {
    const seed = seedFromMnemonic(TEST_MNEMONIC);
    const all = deriveAllAddresses(seed);
    const usdcChains = all.filter((a) => a.tokens.includes('USDC')).map((a) => a.chain).sort();
    expect(usdcChains).toEqual(['ETH', 'POL', 'SOL']);
  });
});
