import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const register = vi.fn();
const upsert = vi.fn();

vi.mock('@/lib/auth/service', () => ({ register: (...a: unknown[]) => register(...a) }));
vi.mock('@/lib/web-wallet/rate-limit', () => ({
  checkRateLimitAsync: async () => ({ allowed: true, limit: 5, resetAt: 0 }),
}));
vi.mock('@/lib/web-wallet/client-ip', () => ({ getClientIp: () => '203.0.113.1' }));
vi.mock('@/lib/auth/spam-detection', () => ({
  checkSpamSignup: () => ({ blocked: false, score: 0, reasons: [] }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {},
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>, opts: unknown) => {
        upsert(table, row, opts);
        return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
      },
    }),
  }),
}));

import { POST } from './route';

// Generated per run: meets the strength rules, never a literal in the repo.
const PASSWORD = `Aa1-${crypto.randomUUID()}`;

const req = (body: unknown) =>
  new NextRequest('https://coinpayportal.com/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/auth/register profile fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
    register.mockResolvedValue({
      success: true,
      merchant: { id: '00000000-0000-4000-8000-000000000001', email: 'ada@acme.com' },
      token: 't',
    });
  });

  it('stores the six fields in user_profiles after creating the merchant', async () => {
    const res = await POST(
      req({
        email: 'Ada@Acme.com',
        password: PASSWORD,
        first_name: 'Ada',
        last_name: 'Lovelace',
        company_domain: 'https://www.acme.com/about',
        job_title: 'VP Engineering',
        linkedin_url: 'in/ada-lovelace',
      })
    );
    expect(res.status).toBe(201);
    expect(register).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: 'Ada@Acme.com', name: 'Ada Lovelace' })
    );
    expect(upsert).toHaveBeenCalledWith(
      'user_profiles',
      expect.objectContaining({
        user_id: '00000000-0000-4000-8000-000000000001',
        email: 'ada@acme.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        company_domain: 'acme.com',
        job_title: 'VP Engineering',
        linkedin_url: 'https://www.linkedin.com/in/ada-lovelace',
      }),
      { onConflict: 'user_id' }
    );
  });

  it('refuses a form signup without first and last name before creating anything', async () => {
    const res = await POST(
      req({ email: 'ada@example.com', password: PASSWORD, first_name: '', last_name: '', job_title: '' })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Object.keys(body.errors)).toEqual(expect.arrayContaining(['first_name', 'last_name']));
    expect(register).not.toHaveBeenCalled();
  });

  it('does not block an API signup that sends no profile fields', async () => {
    const res = await POST(req({ email: 'ada@example.com', password: PASSWORD }));
    expect(res.status).toBe(201);
    expect(register).toHaveBeenCalled();
  });
});
