/**
 * Explorer links. The failure that matters is a link that opens the WRONG
 * chain's explorer — it shows "not found" and reads as a lost transaction.
 */
import { describe, it, expect } from 'vitest';

import { explorerTxUrl, hasExplorer } from '../explorers.js';

describe('explorerTxUrl', () => {
  it('matches the portal for the chains it broadcasts', () => {
    // Same destinations as EXPLORER_URLS in src/lib/web-wallet/broadcast.ts, so
    // a hash opens the same page from either surface.
    expect(explorerTxUrl('BTC', 'abc')).toBe('https://blockstream.info/tx/abc');
    expect(explorerTxUrl('BCH', 'abc')).toBe('https://blockchair.com/bitcoin-cash/transaction/abc');
    expect(explorerTxUrl('ETH', '0xdead')).toBe('https://etherscan.io/tx/0xdead');
    expect(explorerTxUrl('POL', '0xdead')).toBe('https://polygonscan.com/tx/0xdead');
    expect(explorerTxUrl('SOL', 'sig')).toBe('https://explorer.solana.com/tx/sig');
  });

  it('sends a token to its host chain explorer', () => {
    // A USDC transfer is an ordinary transaction on Polygon; sending it to an
    // Ethereum explorer would show nothing.
    expect(explorerTxUrl('USDC_POL', '0x1')).toBe('https://polygonscan.com/tx/0x1');
    expect(explorerTxUrl('USDT_SOL', 'sig')).toBe('https://explorer.solana.com/tx/sig');
    expect(explorerTxUrl('USDC_BASE', '0x1')).toBe('https://basescan.org/tx/0x1');
  });

  it('covers the chains the extension lists but cannot send', () => {
    expect(explorerTxUrl('DOGE', 'h')).toContain('blockchair.com/dogecoin');
    expect(explorerTxUrl('XRP', 'h')).toContain('xrpscan.com');
    expect(explorerTxUrl('ADA', 'h')).toContain('cardanoscan.io');
    expect(explorerTxUrl('BNB', '0x1')).toContain('bscscan.com');
  });

  it('has no link for Lightning', () => {
    // Lightning payments never touch a chain — a link would be a dead end.
    expect(explorerTxUrl('LN', 'anything')).toBeNull();
    expect(hasExplorer('LN')).toBe(false);
  });

  it('returns null rather than a broken link', () => {
    expect(explorerTxUrl('ETH', '')).toBeNull();
    expect(explorerTxUrl('ETH', '   ')).toBeNull();
    expect(explorerTxUrl('NOPE', 'abc')).toBeNull();
  });

  it('escapes the hash instead of interpolating it raw', () => {
    expect(explorerTxUrl('ETH', 'a b')).toBe('https://etherscan.io/tx/a%20b');
  });

  it('is case-insensitive about the chain', () => {
    expect(explorerTxUrl('eth', '0x1')).toBe('https://etherscan.io/tx/0x1');
  });
});
