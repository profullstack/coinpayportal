import { describe, expect, it } from 'vitest';
import {
  ONRAMP_ASSET_MAP,
  ONRAMP_SUPPORTED_ASSETS,
  addressFormatChain,
  isOnrampSupported,
  pricingSymbol,
  settlementChain,
} from './types';

describe('Base support', () => {
  it('can be bought into at all', () => {
    // x402 settles USDC on Base, so an agent wallet that cannot be funded on
    // Base cannot take part in machine payments.
    expect(isOnrampSupported('USDC_BASE')).toBe(true);
    expect(ONRAMP_SUPPORTED_ASSETS).toContain('USDC_BASE');
  });

  it('is priced as USDC, like every other USDC chain', () => {
    expect(pricingSymbol('USDC_BASE')).toBe('USDC');
  });

  it('settles on Base rather than Ethereum', () => {
    expect(settlementChain('USDC_BASE')).toBe('BASE');
    expect(ONRAMP_ASSET_MAP.USDC_BASE).toEqual({ asset: 'usdc', network: 'base' });
  });
});

describe('addressFormatChain', () => {
  it('validates a Base destination as an Ethereum address', () => {
    // Base is EVM: the settlement chain and the address format differ, and
    // conflating them is what let an unvalidatable chain skip the check.
    expect(addressFormatChain('USDC_BASE')).toBe('ETH');
  });

  it('agrees with the settlement chain everywhere that is not an L2', () => {
    for (const asset of ['BTC', 'BCH', 'ETH', 'POL', 'SOL', 'USDC_POL', 'USDT_SOL']) {
      expect(addressFormatChain(asset)).toBe(settlementChain(asset));
    }
  });

  it('returns null where there is no validator, rather than a wrong one', () => {
    // BNB, DOGE, XRP and ADA have no validator; saying so is what keeps the
    // route from validating them against the wrong format.
    for (const asset of ['BNB', 'DOGE', 'XRP', 'ADA']) {
      expect(settlementChain(asset)).not.toBeNull();
      expect(addressFormatChain(asset)).toBeNull();
    }
  });

  it('returns null for an asset we do not sell', () => {
    expect(addressFormatChain('NOT_AN_ASSET')).toBeNull();
    expect(settlementChain('NOT_AN_ASSET')).toBeNull();
  });
});

describe('the asset map as a whole', () => {
  it('gives every asset a settlement chain', () => {
    for (const asset of ONRAMP_SUPPORTED_ASSETS) {
      expect(settlementChain(asset), asset).not.toBeNull();
    }
  });

  it('prices every asset by its bare ticker', () => {
    for (const asset of ONRAMP_SUPPORTED_ASSETS) {
      expect(pricingSymbol(asset), asset).toBe(asset.split('_')[0]);
    }
  });
});
