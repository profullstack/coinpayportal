import { describe, it, expect } from 'vitest';

import {
  toPayChain,
  signingChain,
  nonceQueueKey,
  isPayChain,
  payChainLabel,
  PAY_CHAINS,
} from '../pay-chains.js';
import { CHAINS } from '../chains.js';

describe('toPayChain', () => {
  it('accepts the lowercase currency codes CoinPay payments use', () => {
    expect(toPayChain('usdc_pol')).toBe('USDC_POL');
    expect(toPayChain('btc')).toBe('BTC');
    expect(toPayChain('sol')).toBe('SOL');
  });

  it('accepts already-normalized chain names', () => {
    expect(toPayChain('USDC_SOL')).toBe('USDC_SOL');
  });

  it('normalizes separators and case', () => {
    expect(toPayChain('usdc-pol')).toBe('USDC_POL');
    expect(toPayChain('  Usdc Pol ')).toBe('USDC_POL');
  });

  it('maps MATIC to POL', () => {
    expect(toPayChain('MATIC')).toBe('POL');
  });

  it('resolves bare USDC/USDT to Solana, matching CoinPay', () => {
    // preferredCoinToPaymentCurrency() in ugig.net does the same, so a bare
    // "USDC" invoice and this wallet agree on which chain is meant.
    expect(toPayChain('USDC')).toBe('USDC_SOL');
    expect(toPayChain('USDT')).toBe('USDT_SOL');
  });

  it('returns null for anything unsignable rather than guessing', () => {
    // Guessing a chain here would send real funds to the wrong network.
    expect(toPayChain('DOGE')).toBeNull();
    expect(toPayChain('XRP')).toBeNull();
    expect(toPayChain('')).toBeNull();
    expect(toPayChain(null)).toBeNull();
    expect(toPayChain(undefined)).toBeNull();
  });
});

describe('signingChain', () => {
  it('signs tokens with their base chain key', () => {
    expect(signingChain('USDC_POL')).toBe('POL');
    expect(signingChain('USDC_ETH')).toBe('ETH');
    expect(signingChain('USDC_SOL')).toBe('SOL');
    expect(signingChain('USDT_ETH')).toBe('ETH');
  });

  it('signs native chains with their own key', () => {
    expect(signingChain('BTC')).toBe('BTC');
    expect(signingChain('SOL')).toBe('SOL');
  });

  it('only ever names a chain the wallet actually derives', () => {
    for (const chain of PAY_CHAINS) {
      expect(CHAINS).toHaveProperty(signingChain(chain));
    }
  });
});

describe('nonceQueueKey', () => {
  it('puts a token and its base chain in one queue', () => {
    // They share an account, so two concurrent sends would collide on a nonce.
    expect(nonceQueueKey('USDC_ETH')).toBe(nonceQueueKey('ETH'));
    expect(nonceQueueKey('USDC_SOL')).toBe(nonceQueueKey('SOL'));
  });

  it('keeps ETH and POL in separate queues despite the shared address', () => {
    // Same address, independent networks — independent nonces.
    expect(nonceQueueKey('ETH')).not.toBe(nonceQueueKey('POL'));
  });
});

describe('isPayChain / payChainLabel', () => {
  it('recognizes exactly the supported set', () => {
    expect(isPayChain('USDC_POL')).toBe(true);
    expect(isPayChain('DOGE')).toBe(false);
  });

  it('labels every supported chain', () => {
    for (const chain of PAY_CHAINS) {
      expect(payChainLabel(chain)).toBeTruthy();
    }
  });
});
