import { describe, it, expect } from 'vitest';
import { normalizeAddressForNetwork, addressesEqual } from './address';

// Real mainnet-shaped addresses. Case matters for all but the EVM ones.
const BTC_BECH32 = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const BTC_BASE58 = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
const BCH_ADDR = 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a';
const SOL_ADDR = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const EVM_ADDR = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

describe('normalizeAddressForNetwork', () => {
  it('lowercases EVM addresses, which are case-insensitive hex', () => {
    for (const network of ['ethereum', 'polygon', 'base']) {
      expect(normalizeAddressForNetwork(network, EVM_ADDR)).toBe(EVM_ADDR.toLowerCase());
    }
  });

  it('preserves the exact case of Bitcoin, BCH and Solana addresses', () => {
    expect(normalizeAddressForNetwork('bitcoin', BTC_BASE58)).toBe(BTC_BASE58);
    expect(normalizeAddressForNetwork('bitcoin', BTC_BECH32)).toBe(BTC_BECH32);
    expect(normalizeAddressForNetwork('bitcoin-cash', BCH_ADDR)).toBe(BCH_ADDR);
    expect(normalizeAddressForNetwork('solana', SOL_ADDR)).toBe(SOL_ADDR);
  });

  it('preserves case for unknown networks rather than guessing', () => {
    expect(normalizeAddressForNetwork('some-new-chain', SOL_ADDR)).toBe(SOL_ADDR);
  });

  it('trims and tolerates missing values', () => {
    expect(normalizeAddressForNetwork('bitcoin', `  ${BTC_BASE58}  `)).toBe(BTC_BASE58);
    expect(normalizeAddressForNetwork('bitcoin', null)).toBe('');
    expect(normalizeAddressForNetwork('bitcoin', undefined)).toBe('');
    expect(normalizeAddressForNetwork(null, null)).toBe('');
  });
});

describe('addressesEqual', () => {
  it('matches EVM addresses across checksum casing', () => {
    expect(addressesEqual('base', EVM_ADDR, EVM_ADDR.toLowerCase())).toBe(true);
    expect(addressesEqual('base', EVM_ADDR, EVM_ADDR.toUpperCase().replace('0X', '0x'))).toBe(true);
  });

  it('does NOT match a Bitcoin address against a lowercased copy', () => {
    // The regression: `/verify` stored addresses lowercased, so settlement
    // compared a real payee against a corrupted one and never found the output.
    expect(addressesEqual('bitcoin', BTC_BASE58, BTC_BASE58.toLowerCase())).toBe(false);
  });

  it('does NOT match a Solana pubkey against a lowercased copy', () => {
    expect(addressesEqual('solana', SOL_ADDR, SOL_ADDR.toLowerCase())).toBe(false);
  });

  it('matches identical non-EVM addresses', () => {
    expect(addressesEqual('bitcoin', BTC_BECH32, BTC_BECH32)).toBe(true);
    expect(addressesEqual('solana', SOL_ADDR, SOL_ADDR)).toBe(true);
    expect(addressesEqual('bitcoin-cash', BCH_ADDR, BCH_ADDR)).toBe(true);
  });

  it('treats empty as unequal, so a missing payee never matches', () => {
    expect(addressesEqual('bitcoin', '', '')).toBe(false);
    expect(addressesEqual('bitcoin', null, undefined)).toBe(false);
    expect(addressesEqual('ethereum', '', EVM_ADDR)).toBe(false);
  });

  it('distinguishes different addresses on the same network', () => {
    expect(addressesEqual('bitcoin', BTC_BASE58, BTC_BECH32)).toBe(false);
  });
});
