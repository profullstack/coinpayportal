/**
 * Same recovery phrase in, same addresses out — extension vs the CoinPay web
 * wallet.
 *
 * If these two ever diverge, importing your web-wallet phrase into the
 * extension shows unfamiliar addresses and an empty-looking wallet, which reads
 * exactly like "my funds are gone". They are not gone in that scenario — they
 * sit at the addresses the OTHER derivation produces — but the only way to be
 * sure the extension is not inventing addresses is to run both and compare.
 *
 * A live differential test over the real reference (`src/lib/web-wallet/keys.ts`),
 * in the same spirit as signing.diff.test.ts — not golden strings that could be
 * copied from the wrong implementation.
 */
import { createRequire } from 'node:module';
import { describe, it, expect, beforeAll } from 'vitest';

import { deriveAllAddresses, seedFromMnemonic } from '../derivation.js';
import { deriveIdentityKey } from '../private-keys.js';
import { compressedPublicKey } from '../api.js';
import { deriveKeyForChain, deriveWalletBundle } from '../../../../../src/lib/web-wallet/keys.ts';

beforeAll(() => {
  (globalThis as any).require ??= createRequire(import.meta.url);
});

// BIP-39 standard test vector, plus a second phrase so a single lucky match
// cannot pass for agreement.
const PHRASES = [
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  'legal winner thank year wave sausage worth useful legal winner thank yellow',
];

describe('extension and web wallet derive the same addresses', () => {
  for (const mnemonic of PHRASES) {
    const label = `${mnemonic.split(' ')[0]}…`;

    it(`agrees on every chain for "${label}"`, async () => {
      const seed = seedFromMnemonic(mnemonic);
      const extension = deriveAllAddresses(seed, ['BTC', 'BCH', 'ETH', 'POL', 'SOL'], 0);

      for (const derived of extension) {
        const reference = await deriveKeyForChain(mnemonic, derived.chain as any, 0);
        expect(
          derived.address,
          `${derived.chain} disagrees: extension ${derived.address} vs web wallet ${reference.address}`,
        ).toBe(reference.address);
      }
    });

    it(`agrees on the second account for "${label}"`, async () => {
      // Account switching must not silently walk off the web wallet's path.
      const seed = seedFromMnemonic(mnemonic);
      const extension = deriveAllAddresses(seed, ['BTC', 'ETH', 'SOL'], 1);

      for (const derived of extension) {
        const reference = await deriveKeyForChain(mnemonic, derived.chain as any, 1);
        expect(derived.address, `${derived.chain} account 1 disagrees`).toBe(reference.address);
      }
    });
  }

  /**
   * Identity, not just addresses. The portal looks a wallet up by
   * `public_key_secp256k1`, so if these disagree the same seed becomes two
   * wallet rows — and the second one's addresses collide with the first's on
   * the unique (address, chain) index and vanish.
   */
  for (const mnemonic of PHRASES) {
    it(`registers the same public key as the web wallet for "${mnemonic.split(' ')[0]}…"`, async () => {
      const extension = compressedPublicKey(deriveIdentityKey(seedFromMnemonic(mnemonic)));
      const bundle = await deriveWalletBundle(mnemonic, ['ETH']);

      expect(extension).toBe(bundle.publicKeySecp256k1);
    });
  }

  it('gives different addresses for different phrases', async () => {
    // Guards the test itself: if derivation ignored the phrase, everything
    // above would pass trivially.
    const a = deriveAllAddresses(seedFromMnemonic(PHRASES[0]!), ['ETH'], 0)[0]!;
    const b = deriveAllAddresses(seedFromMnemonic(PHRASES[1]!), ['ETH'], 0)[0]!;

    expect(a.address).not.toBe(b.address);
  });
});
