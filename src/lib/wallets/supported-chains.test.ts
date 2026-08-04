/**
 * Keeps the public chain list honest against what the gateway actually settles.
 *
 * The homepage claim is only useful if it cannot drift. Adding a coin to
 * CRYPTO_NAMES without describing it here should fail, not quietly leave the
 * landing page under-selling the product.
 */

import { describe, it, expect } from 'vitest';
import { CRYPTO_NAMES } from './supported-coins';
import {
  SUPPORTED_CHAINS,
  STABLECOIN_RAILS,
  SETTLEMENT_ASSET_COUNT,
  isTokenVariant,
} from './supported-chains';

describe('SUPPORTED_CHAINS', () => {
  it('only advertises networks the gateway can actually settle', () => {
    for (const chain of SUPPORTED_CHAINS) {
      expect(CRYPTO_NAMES, `${chain.name} (${chain.symbol}) is advertised but not settleable`)
        .toHaveProperty(chain.symbol);
    }
  });

  it('advertises every native network the gateway settles', () => {
    const natives = Object.keys(CRYPTO_NAMES).filter(s => !isTokenVariant(s));
    const advertised = new Set(SUPPORTED_CHAINS.map(c => c.symbol));

    for (const symbol of natives) {
      expect(
        advertised.has(symbol),
        `${symbol} is settleable but missing from SUPPORTED_CHAINS — the homepage would under-sell it`,
      ).toBe(true);
    }
  });

  it('lists no duplicates', () => {
    const symbols = SUPPORTED_CHAINS.map(c => c.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('covers more than EVM, which is the question the homepage has to answer', () => {
    const nonEvm = SUPPORTED_CHAINS.filter(c => !c.evm).map(c => c.name);
    expect(nonEvm).toEqual(expect.arrayContaining(['Bitcoin', 'Solana']));
    expect(SUPPORTED_CHAINS.some(c => c.evm)).toBe(true);
  });
});

describe('STABLECOIN_RAILS', () => {
  it('claims a rail only where that asset/chain pair exists', () => {
    const chainSuffix: Record<string, string> = {
      Ethereum: 'ETH',
      Polygon: 'POL',
      Solana: 'SOL',
      Base: 'BASE',
    };

    for (const rail of STABLECOIN_RAILS) {
      for (const chain of rail.chains) {
        const symbol = `${rail.asset}_${chainSuffix[chain]}`;
        expect(CRYPTO_NAMES, `${rail.asset} on ${chain} is advertised but not settleable`)
          .toHaveProperty(symbol);
      }
    }
  });
});

describe('SETTLEMENT_ASSET_COUNT', () => {
  it('supports the "15+ assets" claim the hero makes', () => {
    expect(SETTLEMENT_ASSET_COUNT).toBeGreaterThanOrEqual(15);
  });
});
