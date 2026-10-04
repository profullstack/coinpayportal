import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock('./files', () => ({ putObject: vi.fn(), getObject: vi.fn(), deleteObject: vi.fn() }));
vi.mock('./audit', () => ({ auditFinance: vi.fn() }));

import { openState, resetSessionKey, sealState, type SessionState } from './bank-sessions';

const state: SessionState = {
  version: 1,
  savedAt: '2026-10-04T12:00:00.000Z',
  userAgent: 'Mozilla/5.0 Chrome/141',
  cookies: [{ name: 'sid', value: 'secret-session', domain: '.chase.com', path: '/', httpOnly: true, secure: true }],
  storage: { 'https://secure.chase.com': [['deviceId', 'abc']] },
};

describe('sealed bank sessions', () => {
  beforeEach(() => {
    process.env.FINANCES_BANK_SESSION_KEY = 'a'.repeat(64);
    resetSessionKey();
  });

  it('round-trips and never contains the cookie in the clear', () => {
    const sealed = sealState(state, 'merchant-1', 'chase');
    expect(sealed.toString('latin1')).not.toContain('secret-session');
    expect(openState(sealed, 'merchant-1', 'chase')).toEqual(state);
  });

  it('will not open for another merchant or bank (bound by AAD)', () => {
    const sealed = sealState(state, 'merchant-1', 'chase');
    expect(() => openState(sealed, 'merchant-2', 'chase')).toThrow();
    expect(() => openState(sealed, 'merchant-1', 'citi')).toThrow();
  });

  it('will not open under another key, or once tampered with', () => {
    const sealed = sealState(state, 'merchant-1', 'chase');
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 1;
    expect(() => openState(tampered, 'merchant-1', 'chase')).toThrow();
    process.env.FINANCES_BANK_SESSION_KEY = 'b'.repeat(64);
    resetSessionKey();
    expect(() => openState(sealed, 'merchant-1', 'chase')).toThrow();
  });
});
