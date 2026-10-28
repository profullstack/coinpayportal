import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';

vi.mock('./derivation-family', async (orig) => ({
  ...(await orig<typeof import('./derivation-family')>()),
  acquireFamilyIndex: vi.fn(async () => 7),
  bumpFamilyIndex: vi.fn(async () => undefined),
  getMaxFamilyIndex: vi.fn(async () => 7),
}));

// No operator vault and nothing sealed: the pre-vault path (env mnemonic,
// ENCRYPTION_KEY per-row key) this test covers.
vi.mock('../supabase/server', () => ({
  getSupabaseAdmin: () => {
    const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) };
    return { from: () => q };
  },
}));

import { generatePaymentAddress } from './system-wallet';
import { mnemonicFingerprint } from './key-generation';

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function supabaseCapturing() {
  const inserts: Record<string, unknown>[] = [];
  const client = {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (table === 'payment_addresses') inserts.push(row);
        return { error: null };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  };
  return { client: client as any, inserts };
}

describe('generatePaymentAddress records the key generation', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.SYSTEM_MNEMONIC_ETH = TEST_MNEMONIC;
    process.env.PLATFORM_FEE_WALLET_ETH = '0x' + '1'.repeat(40);
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
    delete process.env.BLOCK_WALLET_CREATION_IN_TESTS;
    delete process.env.RETIRED_SYSTEM_MNEMONIC_FINGERPRINTS;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('stamps SYSTEM_KEY_GENERATION on the new row', async () => {
    process.env.SYSTEM_KEY_GENERATION = '2';
    const { client, inserts } = supabaseCapturing();
    const res = await generatePaymentAddress(client, 'pay-1', 'biz-1', 'ETH', '0x' + '2'.repeat(40), 1);
    expect(res.success).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].key_generation).toBe(2);
    expect(inserts[0].derivation_index).toBe(7);
  });

  it('defaults to generation 1 when unset', async () => {
    delete process.env.SYSTEM_KEY_GENERATION;
    const { client, inserts } = supabaseCapturing();
    const res = await generatePaymentAddress(client, 'pay-2', 'biz-1', 'ETH', '0x' + '2'.repeat(40), 1);
    expect(res.success).toBe(true);
    expect(inserts[0].key_generation).toBe(1);
  });

  it('refuses to mint from a retired seed and writes nothing', async () => {
    process.env.RETIRED_SYSTEM_MNEMONIC_FINGERPRINTS = mnemonicFingerprint(TEST_MNEMONIC);
    const { client, inserts } = supabaseCapturing();
    const res = await generatePaymentAddress(client, 'pay-3', 'biz-1', 'ETH', '0x' + '2'.repeat(40), 1);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/retired/);
    expect(inserts).toHaveLength(0);
  });
});
