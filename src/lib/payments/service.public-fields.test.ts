import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPaymentPublic } from './service';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The public payment endpoint is the only way an unauthenticated integrator can
 * read a payment — the list endpoint requires a user JWT. Both parties to a
 * payment need the transaction hashes to verify settlement on a block explorer,
 * so the selected columns are a contract, not an implementation detail.
 */

function mockSupabase(row: Record<string, unknown>) {
  const selected: string[] = [];
  const client = {
    from: vi.fn(() => client),
    select: vi.fn((fields: string) => {
      selected.push(fields);
      return client;
    }),
    eq: vi.fn(() => client),
    single: vi.fn(async () => ({ data: row, error: null })),
  } as unknown as SupabaseClient;

  return { client, selected };
}

describe('getPaymentPublic field contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('selects the transaction hashes so integrators can link to a block explorer', async () => {
    const { client, selected } = mockSupabase({ id: 'pay_1' });

    await getPaymentPublic(client, 'pay_1');

    const fields = selected[0]!.split(',');
    expect(fields).toContain('tx_hash');
    expect(fields).toContain('forward_tx_hash');
  });

  it('still withholds the fields that are genuinely private', async () => {
    const { client, selected } = mockSupabase({ id: 'pay_1' });

    await getPaymentPublic(client, 'pay_1');

    const fields = selected[0]!.split(',');
    expect(fields).not.toContain('business_id');
    expect(fields).not.toContain('merchant_wallet_address');
    expect(fields).not.toContain('metadata');
  });

  it('returns the hashes on the payment', async () => {
    const { client } = mockSupabase({
      id: 'pay_1',
      status: 'forwarded',
      tx_hash: 'deposit-hash',
      forward_tx_hash: 'forward-hash',
    });

    const result = await getPaymentPublic(client, 'pay_1');

    expect(result.success).toBe(true);
    expect(result.payment?.tx_hash).toBe('deposit-hash');
    expect(result.payment?.forward_tx_hash).toBe('forward-hash');
  });

  it('reports a lookup failure', async () => {
    const client = {
      from: vi.fn(() => client),
      select: vi.fn(() => client),
      eq: vi.fn(() => client),
      single: vi.fn(async () => ({ data: null, error: { message: 'not found' } })),
    } as unknown as SupabaseClient;

    const result = await getPaymentPublic(client, 'missing');

    expect(result.success).toBe(false);
    expect(result.error).toBe('not found');
  });
});
