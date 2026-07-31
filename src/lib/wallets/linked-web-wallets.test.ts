import { describe, expect, it } from 'vitest';
import { listWalletAccountLinks, getLinkedWebWalletAddress } from './linked-web-wallets';

type LinkRow = {
  id: string;
  wallet_id: string;
  merchant_id: string;
  business_id: string | null;
  label: string | null;
  is_default: boolean;
  created_at: string;
};

type AddressRow = {
  wallet_id: string;
  chain: string;
  address: string;
  derivation_index: number;
  is_active: boolean;
};

/**
 * Minimal stand-in for the two queries these helpers make. Filters are applied
 * in the same order the real client would, so ordering assertions are meaningful.
 */
function fakeSupabase(links: LinkRow[], addresses: AddressRow[]) {
  return {
    from(table: string) {
      if (table === 'wallet_account_links') {
        return {
          select: () => ({
            eq: (_col: string, value: string) => ({
              data: links.filter((l) => l.merchant_id === value),
              error: null,
            }),
          }),
        };
      }

      // wallet_addresses
      let rows = addresses;
      const builder = {
        select: () => builder,
        in: (_col: string, values: string[]) => {
          rows = rows.filter((r) => values.includes(r.wallet_id));
          return builder;
        },
        eq: (col: string, value: unknown) => {
          rows = rows.filter((r) => (r as unknown as Record<string, unknown>)[col] === value);
          return builder;
        },
        order: () => ({
          data: [...rows].sort((a, b) => a.derivation_index - b.derivation_index),
          error: null,
        }),
      };
      return builder;
    },
  } as never;
}

function link(overrides: Partial<LinkRow> & { id: string; wallet_id: string }): LinkRow {
  return {
    merchant_id: 'merchant-1',
    business_id: null,
    label: null,
    is_default: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function address(overrides: Partial<AddressRow> & { wallet_id: string; address: string }): AddressRow {
  return {
    chain: 'ETH',
    derivation_index: 0,
    is_active: true,
    ...overrides,
  };
}

describe('listWalletAccountLinks', () => {
  it('returns account-level links plus links for the named business only', async () => {
    const supabase = fakeSupabase(
      [
        link({ id: 'l1', wallet_id: 'w1' }),
        link({ id: 'l2', wallet_id: 'w2', business_id: 'biz-1' }),
        link({ id: 'l3', wallet_id: 'w3', business_id: 'biz-2' }),
      ],
      [],
    );

    const { links } = await listWalletAccountLinks(supabase, {
      merchantId: 'merchant-1',
      businessId: 'biz-1',
    });

    expect(links?.map((l) => l.id)).toEqual(['l2', 'l1']);
  });

  it('drops every business-scoped link when no business is given', async () => {
    const supabase = fakeSupabase(
      [link({ id: 'l1', wallet_id: 'w1' }), link({ id: 'l2', wallet_id: 'w2', business_id: 'biz-1' })],
      [],
    );

    const { links } = await listWalletAccountLinks(supabase, { merchantId: 'merchant-1' });

    expect(links?.map((l) => l.id)).toEqual(['l1']);
  });

  it('ranks business scope over account scope, then default, then age', async () => {
    const supabase = fakeSupabase(
      [
        link({ id: 'old', wallet_id: 'w1', created_at: '2026-01-01T00:00:00Z' }),
        link({ id: 'default', wallet_id: 'w2', is_default: true, created_at: '2026-05-01T00:00:00Z' }),
        link({ id: 'scoped', wallet_id: 'w3', business_id: 'biz-1', created_at: '2026-06-01T00:00:00Z' }),
      ],
      [],
    );

    const { links } = await listWalletAccountLinks(supabase, {
      merchantId: 'merchant-1',
      businessId: 'biz-1',
    });

    expect(links?.map((l) => l.id)).toEqual(['scoped', 'default', 'old']);
  });
});

describe('getLinkedWebWalletAddress', () => {
  it('returns the address from the highest-priority link that supports the chain', async () => {
    const supabase = fakeSupabase(
      [
        link({ id: 'account', wallet_id: 'w1' }),
        link({ id: 'scoped', wallet_id: 'w2', business_id: 'biz-1' }),
      ],
      [
        address({ wallet_id: 'w1', address: '0xaccount' }),
        address({ wallet_id: 'w2', address: '0xscoped' }),
      ],
    );

    const { address: found } = await getLinkedWebWalletAddress(supabase, {
      merchantId: 'merchant-1',
      businessId: 'biz-1',
      cryptocurrency: 'ETH',
    });

    expect(found?.address).toBe('0xscoped');
    expect(found?.businessScoped).toBe(true);
  });

  it('falls through to a lower-priority link when the preferred wallet lacks that chain', async () => {
    const supabase = fakeSupabase(
      [
        link({ id: 'scoped', wallet_id: 'w2', business_id: 'biz-1' }),
        link({ id: 'account', wallet_id: 'w1' }),
      ],
      [address({ wallet_id: 'w1', address: '0xaccount' })],
    );

    const { address: found } = await getLinkedWebWalletAddress(supabase, {
      merchantId: 'merchant-1',
      businessId: 'biz-1',
      cryptocurrency: 'ETH',
    });

    expect(found?.address).toBe('0xaccount');
  });

  it('prefers the lowest derivation index as the receive address', async () => {
    const supabase = fakeSupabase(
      [link({ id: 'account', wallet_id: 'w1' })],
      [
        address({ wallet_id: 'w1', address: '0xsecond', derivation_index: 3 }),
        address({ wallet_id: 'w1', address: '0xfirst', derivation_index: 0 }),
      ],
    );

    const { address: found } = await getLinkedWebWalletAddress(supabase, {
      merchantId: 'merchant-1',
      cryptocurrency: 'ETH',
    });

    expect(found?.address).toBe('0xfirst');
  });

  it('returns nothing when no linked wallet can receive that coin', async () => {
    const supabase = fakeSupabase(
      [link({ id: 'account', wallet_id: 'w1' })],
      [address({ wallet_id: 'w1', address: '0xeth', chain: 'ETH' })],
    );

    const result = await getLinkedWebWalletAddress(supabase, {
      merchantId: 'merchant-1',
      cryptocurrency: 'BTC',
    });

    expect(result.address).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it('returns nothing when the account has no linked wallets at all', async () => {
    const supabase = fakeSupabase([], []);

    const result = await getLinkedWebWalletAddress(supabase, {
      merchantId: 'merchant-1',
      cryptocurrency: 'ETH',
    });

    expect(result.address).toBeUndefined();
  });

  it('ignores inactive addresses', async () => {
    const supabase = fakeSupabase(
      [link({ id: 'account', wallet_id: 'w1' })],
      [address({ wallet_id: 'w1', address: '0xretired', is_active: false })],
    );

    const result = await getLinkedWebWalletAddress(supabase, {
      merchantId: 'merchant-1',
      cryptocurrency: 'ETH',
    });

    expect(result.address).toBeUndefined();
  });
});
