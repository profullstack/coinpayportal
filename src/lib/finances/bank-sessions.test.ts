import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
const vaultRows = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../supabase/server', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const f: Record<string, string> = {};
      const q: any = {
        select: () => q,
        eq: (c: string, v: string) => ((f[c] = v), q),
        maybeSingle: async () => {
          const r = vaultRows.get(`${f.subject_type}:${f.subject_id}`);
          return { data: r ? { record: r } : null, error: null };
        },
      };
      return q;
    },
  }),
}));
vi.mock('./files', () => ({ putObject: vi.fn(), getObject: vi.fn(), deleteObject: vi.fn() }));
vi.mock('./audit', () => ({ auditFinance: vi.fn() }));

import { openLegacyState, openState, resetSessionKey, sealLegacyState, sealState, type SessionState } from './bank-sessions';
import { bytesToBase64, createVault } from '../vault/sealed-vault';
import { lockVault, unlockVault, VaultLockedError, VaultMissingError } from '../vault/vault-service';
import { resetUnlockStore } from '../vault/unlock-store';

const state: SessionState = {
  version: 1,
  savedAt: '2026-10-04T12:00:00.000Z',
  userAgent: 'Mozilla/5.0 Chrome/141',
  cookies: [{ name: 'sid', value: 'secret-session', domain: '.chase.com', path: '/', httpOnly: true, secure: true }],
  storage: { 'https://secure.chase.com': [['deviceId', 'abc']] },
};

let dek: Uint8Array;
let m = 0;
let merchant = '';

beforeEach(async () => {
  process.env.FINANCES_BANK_SESSION_KEY = 'a'.repeat(64);
  resetSessionKey();
  resetUnlockStore();
  merchant = `merchant-${++m}`;
  const v = await createVault('correct horse battery', 'merchant', merchant);
  vaultRows.set(`merchant:${merchant}`, v.record);
  dek = v.dek;
  await unlockVault('merchant', merchant, bytesToBase64(dek), 3600_000);
});

describe('bank sessions sealed to the merchant vault', () => {
  it('round-trips and never contains the cookie in the clear', async () => {
    const sealed = await sealState(state, merchant, 'chase');
    expect(sealed.toString('latin1')).not.toContain('secret-session');
    expect(await openState(sealed, merchant, 'chase')).toEqual(state);
  });

  it('will not open for another bank (bound by AAD)', async () => {
    const sealed = await sealState(state, merchant, 'chase');
    await expect(openState(sealed, merchant, 'citi')).rejects.toThrow();
  });

  it('seals while locked, opens only while unlocked', async () => {
    lockVault('merchant', merchant);
    const sealed = await sealState(state, merchant, 'chase');
    await expect(openState(sealed, merchant, 'chase')).rejects.toBeInstanceOf(VaultLockedError);
    await unlockVault('merchant', merchant, bytesToBase64(dek), 3600_000);
    expect(await openState(sealed, merchant, 'chase')).toEqual(state);
  });

  it('the server key alone opens nothing (no env fallback)', async () => {
    const sealed = await sealState(state, merchant, 'chase');
    resetUnlockStore(); // a restart
    await expect(openState(sealed, merchant, 'chase')).rejects.toBeInstanceOf(VaultLockedError);
  });

  it('a merchant without a vault cannot save a session', async () => {
    await expect(sealState(state, 'no-vault', 'chase')).rejects.toBeInstanceOf(VaultMissingError);
  });
});

describe('legacy (CPBS1) sessions', () => {
  it('open only while unlocked', async () => {
    const legacy = sealLegacyState(state, merchant, 'chase');
    expect(await openState(legacy, merchant, 'chase')).toEqual(state);
    lockVault('merchant', merchant);
    await expect(openState(legacy, merchant, 'chase')).rejects.toBeInstanceOf(VaultLockedError);
  });

  it('stay bound to merchant, bank and key, and detect tampering', () => {
    const sealed = sealLegacyState(state, 'merchant-1', 'chase');
    expect(openLegacyState(sealed, 'merchant-1', 'chase')).toEqual(state);
    expect(() => openLegacyState(sealed, 'merchant-2', 'chase')).toThrow();
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 1;
    expect(() => openLegacyState(tampered, 'merchant-1', 'chase')).toThrow();
    process.env.FINANCES_BANK_SESSION_KEY = 'b'.repeat(64);
    resetSessionKey();
    expect(() => openLegacyState(sealed, 'merchant-1', 'chase')).toThrow();
  });
});
