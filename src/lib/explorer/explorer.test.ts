import { describe, expect, it } from 'vitest';
import { classifySearch, searchHref, getChain, EXPLORER_CHAINS } from './index';
import { fromBaseUnits, fromHex, sumBaseUnits } from './units';

describe('fromBaseUnits', () => {
  it('scales satoshis to BTC', () => {
    expect(fromBaseUnits(7699494803, 8)).toBe('76.99494803');
  });

  it('drops trailing zeros but keeps significant ones', () => {
    expect(fromBaseUnits(150000000, 8)).toBe('1.5');
    expect(fromBaseUnits(100000000, 8)).toBe('1');
  });

  it('renders zero without a decimal point', () => {
    expect(fromBaseUnits(0, 8)).toBe('0');
  });

  it('keeps sub-unit values below one', () => {
    expect(fromBaseUnits(1, 8)).toBe('0.00000001');
  });

  it('does not lose the low digits of an 18-decimal value', () => {
    // The reason this is BigInt arithmetic: as a double, this value rounds
    // and the trailing digits — the ones a reader is checking — disappear.
    expect(fromBaseUnits('1234567890123456789', 18)).toBe('1.234567890123456789');
  });

  it('handles negatives', () => {
    expect(fromBaseUnits(-150000000, 8)).toBe('-1.5');
  });

  it('returns 0 for unparseable input rather than throwing', () => {
    expect(fromBaseUnits('not a number', 8)).toBe('0');
  });
});

describe('sumBaseUnits', () => {
  it('sums and skips nullish entries', () => {
    expect(sumBaseUnits([1, 2, undefined, null, '3'])).toBe(6n);
  });

  it('is empty-safe', () => {
    expect(sumBaseUnits([])).toBe(0n);
  });
});

describe('fromHex', () => {
  it('parses a 0x quantity', () => {
    expect(fromHex('0x10')).toBe(16n);
  });

  it('returns 0n for anything that is not a hex quantity', () => {
    expect(fromHex(undefined)).toBe(0n);
    expect(fromHex('16')).toBe(0n);
    expect(fromHex(null)).toBe(0n);
  });
});

describe('classifySearch', () => {
  it('offers every EVM chain for a 0x transaction hash', () => {
    const out = classifySearch(`0x${'a'.repeat(64)}`);
    expect(out).toHaveLength(4);
    expect(out.every((c) => c.kind === 'tx')).toBe(true);
    expect(out.map((c) => c.chainId)).toEqual(['eth', 'pol', 'bnb', 'base']);
  });

  it('offers every EVM chain for a 0x address', () => {
    const out = classifySearch('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    expect(out).toHaveLength(4);
    expect(out.every((c) => c.kind === 'address')).toBe(true);
    // Normalized to lowercase so the URL is stable.
    expect(out[0].value).toBe('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
  });

  it('recognises a bech32 Bitcoin address', () => {
    const out = classifySearch('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    expect(out).toEqual([
      { chainId: 'btc', kind: 'address', value: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' },
    ]);
  });

  it('offers both Bitcoin and Bitcoin Cash for a legacy address', () => {
    // Bitcoin Cash inherited the legacy format at the fork, so the same
    // string is valid on both chains and guessing one would be wrong half
    // the time.
    const out = classifySearch('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
    expect(out.map((c) => c.chainId)).toEqual(['btc', 'bch']);
  });

  it('strips the bitcoincash: prefix', () => {
    const out = classifySearch('bitcoincash:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy');
    expect(out).toEqual([
      { chainId: 'bch', kind: 'address', value: 'qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy' },
    ]);
  });

  it('recognises a Dogecoin address', () => {
    const out = classifySearch('DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L');
    expect(out).toEqual([
      { chainId: 'doge', kind: 'address', value: 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L' },
    ]);
  });

  it('recognises an XRP address', () => {
    const out = classifySearch('rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh');
    expect(out).toEqual([
      { chainId: 'xrp', kind: 'address', value: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh' },
    ]);
  });

  it('recognises a Cardano address', () => {
    const out = classifySearch('addr1qy2jt0qpqz2z2z9zx5w4xemekkce7yderz53kjue53lpqv90lkfa9');
    expect(out[0].chainId).toBe('ada');
    expect(out[0].kind).toBe('address');
  });

  it('puts XRP first for an uppercase 64-hex hash', () => {
    // XRP renders its transaction hashes uppercase, so case is the only
    // signal available to rank an otherwise ambiguous string.
    const out = classifySearch('A'.repeat(64));
    expect(out[0].chainId).toBe('xrp');
  });

  it('puts Bitcoin first for a lowercase 64-hex hash', () => {
    const out = classifySearch('a'.repeat(64));
    expect(out[0].chainId).toBe('btc');
  });

  it('treats a bare number as a block height on every chain', () => {
    const out = classifySearch('800000');
    expect(out).toHaveLength(EXPLORER_CHAINS.length);
    expect(out.every((c) => c.kind === 'block')).toBe(true);
  });

  it('returns nothing for junk', () => {
    expect(classifySearch('hello world')).toEqual([]);
    expect(classifySearch('')).toEqual([]);
    expect(classifySearch('   ')).toEqual([]);
  });

  it('ignores surrounding whitespace', () => {
    const out = classifySearch('  DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L  ');
    expect(out[0].chainId).toBe('doge');
  });
});

describe('searchHref', () => {
  it('builds a route and escapes the value', () => {
    expect(searchHref({ chainId: 'btc', kind: 'tx', value: 'abc' })).toBe('/explorer/btc/tx/abc');
  });
});

describe('getChain', () => {
  it('is case-insensitive', () => {
    expect(getChain('BTC')?.name).toBe('Bitcoin');
  });

  it('returns undefined for an unknown chain', () => {
    expect(getChain('dogecoin')).toBeUndefined();
  });

  it('gives every chain the fields the pages read', () => {
    for (const chain of EXPLORER_CHAINS) {
      expect(chain.id).toMatch(/^[a-z0-9]+$/);
      expect(chain.name.length).toBeGreaterThan(0);
      expect(chain.symbol.length).toBeGreaterThan(0);
      expect(chain.decimals).toBeGreaterThan(0);
    }
  });
});
