// @vitest-environment node
/**
 * Regression tests for the "Failed to store payment address after retries
 * — all derived addresses already exist" bug from POST /api/payments/create.
 *
 * Root cause: every EVM cryptocurrency shares the same HD seed AND the
 * same derivation path m/44'/60'/0'/0/i, so they share an address space.
 * The system_wallet_indexes counter was previously keyed per-cryptocurrency,
 * so USDC_POL (counter=0) collided with addresses already minted under
 * ETH (counter=N>0) and the 5-attempt insert retry loop gave up.
 *
 * These tests exercise the family-scoped index allocation in isolation
 * (no ethers/bitcoinjs imports → no ws transitive load → no test runner
 * transform errors).
 */

import { describe, it, expect } from 'vitest';
import {
  acquireFamilyIndex,
  bumpFamilyIndex,
  getDerivationFamily,
  getFamilyMembers,
  getMaxFamilyIndex,
} from './derivation-family';

/**
 * In-memory mock that emulates just enough of the supabase query builder
 * for the system_wallet_indexes / payment_addresses paths exercised by
 * the family-index helpers. Compare-and-swap and unique constraints are
 * faithfully enforced so concurrency bugs surface in tests.
 */
function makeMockSupabase(seedRows: Array<{ cryptocurrency: string; derivation_index: number }> = []) {
  const indexes = new Map<string, number>(); // family → next_index
  const addressRows = [...seedRows];

  function selectChain(table: string) {
    let filterCrypto: string | null = null;
    let filterIn: string[] | null = null;
    let orderField: string | null = null;
    let orderDesc = false;
    let limitN = Infinity;

    const chain: any = {
      select() { return chain; },
      eq(col: string, val: any) {
        if (table === 'system_wallet_indexes' && col === 'cryptocurrency') filterCrypto = val;
        return chain;
      },
      in(_col: string, vals: string[]) { filterIn = vals; return chain; },
      order(field: string, opts: { ascending: boolean }) {
        orderField = field;
        orderDesc = !opts.ascending;
        return chain;
      },
      limit(n: number) { limitN = n; return chain; },
      single() {
        if (table === 'system_wallet_indexes') {
          const v = indexes.get(filterCrypto!);
          if (v === undefined) {
            return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'not found' } });
          }
          return Promise.resolve({ data: { next_index: v }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve: any) {
        if (table === 'payment_addresses') {
          let result = addressRows.filter((r) => (filterIn ? filterIn.includes(r.cryptocurrency) : true));
          if (orderField) {
            result = [...result].sort((a: any, b: any) =>
              orderDesc ? b[orderField!] - a[orderField!] : a[orderField!] - b[orderField!]
            );
          }
          if (limitN !== Infinity) result = result.slice(0, limitN);
          resolve({ data: result, error: null });
          return;
        }
        resolve({ data: null, error: null });
      },
    };
    return chain;
  }

  const supabase: any = {
    indexes,
    addressRows,
    from(table: string) {
      return {
        select: () => selectChain(table),
        insert(row: any) {
          if (table === 'system_wallet_indexes') {
            if (indexes.has(row.cryptocurrency)) {
              return Promise.resolve({ error: { code: '23505', message: 'duplicate' } });
            }
            indexes.set(row.cryptocurrency, row.next_index);
            return Promise.resolve({ error: null });
          }
          return Promise.resolve({ error: null });
        },
        update(patch: any) {
          let casCol: string | null = null;
          let casVal: any = null;
          let crypto: string | null = null;
          let ltVal: number | null = null;
          const updateChain: any = {
            eq(col: string, val: any) {
              if (col === 'cryptocurrency') crypto = val;
              else { casCol = col; casVal = val; }
              return updateChain;
            },
            lt(_col: string, val: number) { ltVal = val; return updateChain; },
            select() { return updateChain; },
            single() {
              if (table === 'system_wallet_indexes') {
                const cur = indexes.get(crypto!);
                if (cur === undefined) {
                  return Promise.resolve({ data: null, error: { message: 'not found' } });
                }
                if (casCol && cur !== casVal) {
                  return Promise.resolve({ data: null, error: { message: 'cas miss' } });
                }
                indexes.set(crypto!, patch.next_index);
                return Promise.resolve({ data: { next_index: patch.next_index }, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            },
            then(resolve: any) {
              if (table === 'system_wallet_indexes' && crypto) {
                const cur = indexes.get(crypto) ?? -1;
                if (ltVal !== null && cur >= ltVal) {
                  resolve({ error: null });
                  return;
                }
                indexes.set(crypto, patch.next_index);
              }
              resolve({ error: null });
            },
          };
          return updateChain;
        },
      };
    },
  };
  return supabase;
}

describe('getDerivationFamily', () => {
  it('groups every EVM cryptocurrency into the EVM family', () => {
    expect(getDerivationFamily('ETH')).toBe('EVM');
    expect(getDerivationFamily('POL')).toBe('EVM');
    expect(getDerivationFamily('BNB')).toBe('EVM');
    expect(getDerivationFamily('USDT')).toBe('EVM');
    expect(getDerivationFamily('USDC')).toBe('EVM');
    expect(getDerivationFamily('USDT_ETH')).toBe('EVM');
    expect(getDerivationFamily('USDT_POL')).toBe('EVM');
    expect(getDerivationFamily('USDC_ETH')).toBe('EVM');
    expect(getDerivationFamily('USDC_POL')).toBe('EVM');
  });

  it('groups every Solana token into the SOL family', () => {
    expect(getDerivationFamily('SOL')).toBe('SOL');
    expect(getDerivationFamily('USDT_SOL')).toBe('SOL');
    expect(getDerivationFamily('USDC_SOL')).toBe('SOL');
  });

  it('keeps non-shared chains in their own family', () => {
    expect(getDerivationFamily('BTC')).toBe('BTC');
    expect(getDerivationFamily('BCH')).toBe('BCH');
    expect(getDerivationFamily('DOGE')).toBe('DOGE');
    expect(getDerivationFamily('XRP')).toBe('XRP');
    expect(getDerivationFamily('ADA')).toBe('ADA');
  });

  it('getFamilyMembers returns every member of a family', () => {
    expect(getFamilyMembers('EVM').sort()).toEqual(
      ['BNB', 'ETH', 'POL', 'USDC', 'USDC_ETH', 'USDC_POL', 'USDT', 'USDT_ETH', 'USDT_POL'].sort()
    );
    expect(getFamilyMembers('SOL').sort()).toEqual(['SOL', 'USDC_SOL', 'USDT_SOL'].sort());
    expect(getFamilyMembers('BTC')).toEqual(['BTC']);
  });
});

describe('getMaxFamilyIndex', () => {
  it('returns -1 when no addresses exist for the family', async () => {
    const supabase = makeMockSupabase();
    expect(await getMaxFamilyIndex(supabase, 'USDC_POL')).toBe(-1);
  });

  it('finds the highest index across every member of the family', async () => {
    // ETH at 5, USDC_POL at 12, BTC at 99 — USDC_POL query should ignore BTC
    const supabase = makeMockSupabase([
      { cryptocurrency: 'ETH', derivation_index: 5 },
      { cryptocurrency: 'USDC_POL', derivation_index: 12 },
      { cryptocurrency: 'BTC', derivation_index: 99 },
    ]);
    expect(await getMaxFamilyIndex(supabase, 'USDC_POL')).toBe(12);
    expect(await getMaxFamilyIndex(supabase, 'BTC')).toBe(99);
  });
});

describe('acquireFamilyIndex', () => {
  it('initializes the family counter from -1 when no row exists', async () => {
    const supabase = makeMockSupabase();
    const idx = await acquireFamilyIndex(supabase, 'USDC_POL');
    expect(idx).toBe(0);
    // Counter should now sit at 1 so the next caller gets 1.
    const next = await acquireFamilyIndex(supabase, 'USDC_POL');
    expect(next).toBe(1);
  });

  it('seeds a fresh USDC_POL counter past existing ETH addresses (regression for d0rz)', async () => {
    // 3 ETH payments already minted addresses at indexes 0,1,2.
    const supabase = makeMockSupabase([
      { cryptocurrency: 'ETH', derivation_index: 0 },
      { cryptocurrency: 'ETH', derivation_index: 1 },
      { cryptocurrency: 'ETH', derivation_index: 2 },
    ]);
    const idx = await acquireFamilyIndex(supabase, 'USDC_POL');
    expect(idx).toBe(3); // first free index in EVM space
    // ETH payments should reuse the same family counter — never go back to 0
    const eth = await acquireFamilyIndex(supabase, 'ETH');
    expect(eth).toBe(4);
  });

  it('returns 5 distinct sequential indexes for back-to-back USDC_POL calls', async () => {
    const supabase = makeMockSupabase();
    const got: number[] = [];
    for (let i = 0; i < 5; i++) {
      got.push(await acquireFamilyIndex(supabase, 'USDC_POL'));
    }
    expect(got).toEqual([0, 1, 2, 3, 4]);
  });

  it('returns 10 distinct indexes under concurrent acquisition (Promise.all)', async () => {
    const supabase = makeMockSupabase();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => acquireFamilyIndex(supabase, 'USDC_POL'))
    );
    expect(new Set(results).size).toBe(10);
    // Final counter should be 10
    expect(supabase.indexes.get('EVM')).toBe(10);
  });

  it('shares the EVM counter across mixed-coin requests so no two callers get the same index', async () => {
    const supabase = makeMockSupabase();
    const cryptos: any[] = ['ETH', 'POL', 'USDC_POL', 'USDT_ETH', 'USDC_ETH', 'BNB', 'USDC', 'USDT', 'USDT_POL', 'USDC_SOL'];
    const results = await Promise.all(cryptos.map((c) => acquireFamilyIndex(supabase, c)));
    // 9 EVM + 1 SOL → EVM should produce 9 distinct indexes 0..8, SOL should produce 0
    const evmResults = results.slice(0, 9);
    expect(new Set(evmResults).size).toBe(9);
    expect(results[9]).toBe(0); // USDC_SOL has its own counter
  });
});

describe('bumpFamilyIndex', () => {
  it('moves the family counter forward but never backward', async () => {
    const supabase = makeMockSupabase();
    await acquireFamilyIndex(supabase, 'USDC_POL'); // counter → 1
    await acquireFamilyIndex(supabase, 'USDC_POL'); // counter → 2

    // Try to regress (newIndex=0 → would set counter to 1, but current=2)
    await bumpFamilyIndex(supabase, 'USDC_POL', 0);
    expect(supabase.indexes.get('EVM')).toBe(2);

    // Move forward
    await bumpFamilyIndex(supabase, 'USDC_POL', 9);
    expect(supabase.indexes.get('EVM')).toBe(10);
  });
});
