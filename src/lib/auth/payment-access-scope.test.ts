/**
 * authorizePaymentAccess must honour a business key's scopes: a read-only key
 * (payments:read, wallet:read) used to reach the write path (state changes and
 * on-chain forwarding in payments/[id]/check-balance).
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const ctx = vi.hoisted(() => ({ value: null as any }));
vi.mock('./middleware', async () => {
  const real = await vi.importActual<any>('./middleware');
  return {
    ...real,
    authenticateRequest: vi.fn(async () => ({ success: true, context: ctx.value })),
    extractBearerToken: (h: string | null) => (h?.startsWith('Bearer ') ? h.slice(7) : null),
  };
});
vi.mock('./secret-compare', () => ({ isInternalApiKey: () => false }));
vi.mock('./authz', () => ({ getAccessibleBusinessRoles: async () => new Map() }));

import { authorizePaymentAccess } from './payment-access';

const req = () =>
  new NextRequest('https://coinpayportal.com/api/payments/p/check-balance', {
    headers: { authorization: 'Bearer fixture-key', 'x-api-key': 'fixture-key' },
  });
const key = (scopes: string[]) => ({ type: 'business', businessId: 'b-1', merchantId: 'm-1', businessName: 'x', scopes });

describe('authorizePaymentAccess scopes', () => {
  it('refuses the write path to a read-only key', async () => {
    ctx.value = key(['payments:read']);
    const r = await authorizePaymentAccess({} as any, req(), 'b-1', { write: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it('allows the write path with payments:create, and legacy keys', async () => {
    ctx.value = key(['payments:create']);
    expect((await authorizePaymentAccess({} as any, req(), 'b-1', { write: true })).ok).toBe(true);
    ctx.value = key(['*']);
    expect((await authorizePaymentAccess({} as any, req(), 'b-1', { write: true })).ok).toBe(true);
  });

  it('reads need a payments scope (read or create)', async () => {
    ctx.value = key(['payments:read']);
    expect((await authorizePaymentAccess({} as any, req(), 'b-1')).ok).toBe(true);
    ctx.value = key(['payments:create']);
    expect((await authorizePaymentAccess({} as any, req(), 'b-1')).ok).toBe(true);
    ctx.value = key(['wallet:read']);
    expect((await authorizePaymentAccess({} as any, req(), 'b-1')).ok).toBe(false);
  });

  it('still pins the key to its own business', async () => {
    ctx.value = key(['*']);
    expect((await authorizePaymentAccess({} as any, req(), 'b-other', { write: true })).ok).toBe(false);
  });
});
