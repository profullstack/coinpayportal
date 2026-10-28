import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Self-serve PayPal client secrets are sealed to the business owner's secrets
 * vault (2026-10-28). Locked: fall back to partner onboarding when the
 * business has it, else 423 "PayPal locked". Partner-only businesses (no
 * stored secret) never touch the vault, so their checkout is unchanged.
 */

const tables = vi.hoisted(() => ({ rows: {} as Record<string, any[]> }));

function client() {
  return {
    from: (name: string) => {
      const filters: Array<(r: any) => boolean> = [];
      let patch: any = null;
      const run = () => {
        const hit = (tables.rows[name] ?? []).filter((r) => filters.every((f) => f(r)));
        if (patch) hit.forEach((r) => Object.assign(r, patch));
        return hit;
      };
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        update: (p: any) => ((patch = p), q),
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        single: async () => ({ data: run()[0] ?? null, error: null }),
        insert: async (row: any) => ((tables.rows[name] ??= []).push(row), { error: null }),
        then: (res: any, rej: any) => Promise.resolve({ data: run(), error: null }).then(res, rej),
      };
      return q;
    },
  } as any;
}

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => client() }));

const { resolvePaypalContext, sealPaypalSecret, PAYPAL_LOCKED_MESSAGE } = await import('./accounts');
const sv = await import('@/lib/vault/sealed-vault');
const svc = await import('@/lib/vault/vault-service');
const { resetUnlockStore } = await import('@/lib/vault/unlock-store');

let n = 0;
let merchant = '';
let dek: Uint8Array;

beforeEach(async () => {
  resetUnlockStore();
  merchant = `m-${++n}`;
  tables.rows = { businesses: [{ id: 'biz', merchant_id: merchant }], secret_vaults: [] };
  const v = await sv.createVault('correct horse battery', 'merchant', merchant);
  await svc.createVault('merchant', merchant, v.record);
  dek = v.dek;
  tables.rows.paypal_accounts = [
    {
      business_id: 'biz',
      connection_mode: 'self_serve',
      paypal_client_id: 'client-id',
      paypal_client_secret_encrypted: await sealPaypalSecret('the-client-secret', 'biz'),
      merchant_id_in_paypal: null,
      payments_receivable: null,
      environment: 'sandbox',
      connected: true,
    },
  ];
});
afterEach(() => vi.unstubAllEnvs());

describe('PayPal REST secret sealed to the owner vault', () => {
  it('is stored sealed, never in the clear', () => {
    expect(tables.rows.paypal_accounts[0].paypal_client_secret_encrypted).toMatch(/^cpv1\./);
  });

  it('works while unlocked', async () => {
    await svc.unlockVault('merchant', merchant, sv.bytesToBase64(dek), 3600_000);
    const ctx = await resolvePaypalContext(client(), 'biz');
    expect('error' in ctx).toBe(false);
    if (!('error' in ctx)) {
      expect(ctx.mode).toBe('self_serve');
      expect(ctx.creds.clientSecret).toBe('the-client-secret');
    }
  });

  it('locked and no partner onboarding: 423 PayPal locked', async () => {
    const ctx = await resolvePaypalContext(client(), 'biz');
    expect(ctx).toEqual({ error: PAYPAL_LOCKED_MESSAGE, status: 423, code: 'paypal_locked' });
  });

  it('locked with partner onboarding: falls back to the platform credentials', async () => {
    vi.stubEnv('PAYPAL_PLATFORM_CLIENT_ID', 'platform-id');
    vi.stubEnv('PAYPAL_PLATFORM_CLIENT_SECRET', 'platform-secret');
    vi.stubEnv('PAYPAL_PARTNER_MERCHANT_ID', 'PARTNER');
    Object.assign(tables.rows.paypal_accounts[0], { merchant_id_in_paypal: 'MERCHANT-PP', payments_receivable: true });
    const ctx = await resolvePaypalContext(client(), 'biz');
    expect('error' in ctx).toBe(false);
    if (!('error' in ctx)) {
      expect(ctx.mode).toBe('partner');
      expect(ctx.payeeMerchantId).toBe('MERCHANT-PP');
      expect(ctx.creds.clientId).toBe('platform-id');
    }
  });

  it('partner-mode businesses never need the vault', async () => {
    vi.stubEnv('PAYPAL_PLATFORM_CLIENT_ID', 'platform-id');
    vi.stubEnv('PAYPAL_PLATFORM_CLIENT_SECRET', 'platform-secret');
    vi.stubEnv('PAYPAL_PARTNER_MERCHANT_ID', 'PARTNER');
    tables.rows.paypal_accounts[0] = {
      business_id: 'biz',
      connection_mode: 'partner',
      paypal_client_id: null,
      paypal_client_secret_encrypted: null,
      merchant_id_in_paypal: 'MERCHANT-PP',
      payments_receivable: true,
      environment: 'live',
      connected: true,
    };
    const ctx = await resolvePaypalContext(client(), 'biz');
    expect('error' in ctx ? ctx.status : ctx.mode).toBe('partner');
  });
});
