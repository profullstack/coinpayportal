import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockAuthenticate, mockRoles } = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockRoles: vi.fn(),
}));

vi.mock('./middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./middleware')>();
  return { ...actual, authenticateRequest: mockAuthenticate };
});

vi.mock('./authz', () => ({ getAccessibleBusinessRoles: mockRoles }));

import { authorizePaymentCreation } from './payment-auth';

const supabase = {} as any;

function requestWith(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/stripe/payments/create', {
    method: 'POST',
    headers,
  });
}

describe('authorizePaymentCreation', () => {
  const originalInternalKey = process.env.INTERNAL_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.INTERNAL_API_KEY;
    mockRoles.mockResolvedValue(new Map());
  });

  afterEach(() => {
    if (originalInternalKey === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = originalInternalKey;
  });

  it('rejects a request with no credentials', async () => {
    const result = await authorizePaymentCreation(supabase, requestWith(), 'biz-1');
    expect(result).toEqual({ ok: false, status: 401, error: 'Missing API key' });
  });

  it('rejects credentials that do not authenticate', async () => {
    mockAuthenticate.mockResolvedValue({ success: false, error: 'Invalid API key' });
    const result = await authorizePaymentCreation(
      supabase,
      requestWith({ authorization: 'Bearer cp_live_bogus' }),
      'biz-1'
    );
    expect(result).toEqual({ ok: false, status: 401, error: 'Invalid API key' });
  });

  describe('business API keys', () => {
    it('accepts a key scoped to the business being charged', async () => {
      mockAuthenticate.mockResolvedValue({
        success: true,
        context: { type: 'business', businessId: 'biz-1', merchantId: 'm-1', businessName: 'B', scopes: ['*'] },
      });

      const result = await authorizePaymentCreation(
        supabase,
        requestWith({ authorization: 'Bearer cp_live_key' }),
        'biz-1'
      );
      expect(result).toEqual({ ok: true, via: 'api_key', merchantId: 'm-1' });
    });

    it('refuses a valid key for a different business', async () => {
      mockAuthenticate.mockResolvedValue({
        success: true,
        context: { type: 'business', businessId: 'biz-other', merchantId: 'm-2', businessName: 'B', scopes: ['*'] },
      });

      const result = await authorizePaymentCreation(
        supabase,
        requestWith({ authorization: 'Bearer cp_live_key' }),
        'biz-1'
      );
      expect(result).toEqual({
        ok: false,
        status: 403,
        error: 'API key does not belong to this business',
      });
    });

    it('requires the payments:create scope', async () => {
      mockAuthenticate.mockResolvedValue({
        success: true,
        context: { type: 'business', businessId: 'biz-1', merchantId: 'm-1', businessName: 'B', scopes: ['payments:read'] },
      });

      const result = await authorizePaymentCreation(
        supabase,
        requestWith({ authorization: 'Bearer cp_live_key' }),
        'biz-1'
      );
      expect(result.ok).toBe(false);
      expect((result as any).status).toBe(403);
    });

    it('accepts the key from the x-api-key header too', async () => {
      mockAuthenticate.mockResolvedValue({
        success: true,
        context: { type: 'business', businessId: 'biz-1', merchantId: 'm-1', businessName: 'B', scopes: ['payments:create'] },
      });

      const result = await authorizePaymentCreation(
        supabase,
        requestWith({ 'x-api-key': 'cp_live_key' }),
        'biz-1'
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('merchant JWTs', () => {
    it('accepts a merchant with write access', async () => {
      mockAuthenticate.mockResolvedValue({
        success: true,
        context: { type: 'merchant', merchantId: 'm-1', email: 'a@b.c' },
      });
      mockRoles.mockResolvedValue(new Map([['biz-1', 'owner']]));

      const result = await authorizePaymentCreation(
        supabase,
        requestWith({ authorization: 'Bearer jwt' }),
        'biz-1'
      );
      expect(result).toEqual({ ok: true, via: 'jwt', merchantId: 'm-1' });
    });

    it('refuses a merchant with no access to the business', async () => {
      mockAuthenticate.mockResolvedValue({
        success: true,
        context: { type: 'merchant', merchantId: 'm-1', email: 'a@b.c' },
      });
      mockRoles.mockResolvedValue(new Map());

      const result = await authorizePaymentCreation(
        supabase,
        requestWith({ authorization: 'Bearer jwt' }),
        'biz-1'
      );
      expect(result).toEqual({ ok: false, status: 403, error: 'No access to this business' });
    });

    it('refuses a read-only team member', async () => {
      mockAuthenticate.mockResolvedValue({
        success: true,
        context: { type: 'merchant', merchantId: 'm-1', email: 'a@b.c' },
      });
      mockRoles.mockResolvedValue(new Map([['biz-1', 'readonly']]));

      const result = await authorizePaymentCreation(
        supabase,
        requestWith({ authorization: 'Bearer jwt' }),
        'biz-1'
      );
      expect(result.ok).toBe(false);
    });
  });

  describe('internal key', () => {
    it('accepts the configured internal key', async () => {
      process.env.INTERNAL_API_KEY = 'internal-secret';
      const result = await authorizePaymentCreation(
        supabase,
        requestWith({ authorization: 'Bearer internal-secret' }),
        'biz-1'
      );
      expect(result).toEqual({ ok: true, via: 'internal', merchantId: null });
      expect(mockAuthenticate).not.toHaveBeenCalled();
    });

    it('does not treat an unset internal key as a match', async () => {
      delete process.env.INTERNAL_API_KEY;
      mockAuthenticate.mockResolvedValue({ success: false, error: 'Invalid API key' });

      const result = await authorizePaymentCreation(
        supabase,
        requestWith({ authorization: 'Bearer undefined' }),
        'biz-1'
      );
      expect(result.ok).toBe(false);
    });

    it('does not let a blank internal key authorize anything', async () => {
      process.env.INTERNAL_API_KEY = '   ';
      mockAuthenticate.mockResolvedValue({ success: false, error: 'Invalid API key' });

      const result = await authorizePaymentCreation(
        supabase,
        requestWith({ authorization: 'Bearer    ' }),
        'biz-1'
      );
      expect(result.ok).toBe(false);
    });
  });
});
