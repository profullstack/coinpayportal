import { describe, expect, it } from 'vitest';
import { getAccountManualDefaults } from './account-defaults';

function makeSupabase(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      const rows = tables[table] || [];
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        then: (resolve: any) => resolve({ data: rows, error: null }),
      };
      return builder;
    },
  } as any;
}

describe('getAccountManualDefaults', () => {
  it('lists every published manual method, filling in saved handles', async () => {
    const supabase = makeSupabase({
      payment_method_catalog: [
        { method_id: 'venmo', display_name: 'Venmo', sort_order: 40 },
        { method_id: 'zelle', display_name: 'Zelle', sort_order: 90 },
      ],
      merchant_payment_defaults: [{ method_id: 'venmo', config: { handle: '@me', instructions: 'note #' } }],
    });

    const result = await getAccountManualDefaults(supabase, 'merchant-1');
    expect(result).toEqual([
      { method_id: 'venmo', display_name: 'Venmo', handle: '@me', instructions: 'note #' },
      { method_id: 'zelle', display_name: 'Zelle', handle: '', instructions: '' },
    ]);
  });
});
