import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const single = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
  }),
}));

import { NextResponse } from 'next/server';
import { generateToken } from './jwt';
import { requireMerchant } from './merchant-guard';

const SECRET = 'test-secret-key-for-jwt-signing-minimum-32-chars';
const MERCHANT = { id: 'merchant-1', email: 'owner@example.com' };

/** Minimal NextRequest stand-in: the guard reads only these two things. */
function request({ auth, cookie }: { auth?: string; cookie?: string } = {}) {
  return {
    headers: { get: (name: string) => (name === 'authorization' ? (auth ?? null) : null) },
    cookies: { get: (name: string) => (name === 'token' && cookie ? { value: cookie } : undefined) },
  } as never;
}

async function statusOf(result: unknown): Promise<number | null> {
  return result instanceof NextResponse ? result.status : null;
}

describe('requireMerchant', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
    single.mockReset();
    single.mockResolvedValue({ data: MERCHANT, error: null });
  });

  it('accepts a merchant JWT from the Authorization header', async () => {
    const token = generateToken({ userId: MERCHANT.id, email: MERCHANT.email }, SECRET);
    const result = await requireMerchant(request({ auth: `Bearer ${token}` }));
    expect(result).toEqual({ id: MERCHANT.id, email: MERCHANT.email });
  });

  it('accepts the same JWT from the token cookie', async () => {
    const token = generateToken({ userId: MERCHANT.id, email: MERCHANT.email }, SECRET);
    const result = await requireMerchant(request({ cookie: token }));
    expect(result).toEqual({ id: MERCHANT.id, email: MERCHANT.email });
  });

  /**
   * The one that matters for team isolation.
   *
   * A business API key authenticates as the business, and `authenticateRequest`
   * resolves it to the business OWNER's merchantId. Business members — a
   * teammate with the `admin` role, say — can hold such a key. If this guard
   * ever accepted one, that teammate's request would arrive carrying the
   * owner's merchant id and every finance query would scope to the owner's
   * bank accounts. Payment credentials must not imply access to the owner's
   * personal finances, so keys are rejected outright.
   */
  it('rejects API keys, which would otherwise resolve to the business owner', async () => {
    for (const key of ['cp_live_' + 'a'.repeat(32), 'cp_test_' + 'b'.repeat(32)]) {
      expect(await statusOf(await requireMerchant(request({ auth: `Bearer ${key}` })))).toBe(401);
      expect(await statusOf(await requireMerchant(request({ cookie: key })))).toBe(401);
    }
  });

  it('rejects a missing, malformed or wrongly-signed token', async () => {
    expect(await statusOf(await requireMerchant(request()))).toBe(401);
    expect(await statusOf(await requireMerchant(request({ auth: 'Bearer nonsense' })))).toBe(401);

    const foreign = generateToken({ userId: MERCHANT.id, email: MERCHANT.email }, 'a-different-secret-of-sufficient-length');
    expect(await statusOf(await requireMerchant(request({ auth: `Bearer ${foreign}` })))).toBe(401);
  });

  it('rejects a valid signature for a merchant that no longer exists', async () => {
    // Otherwise a deleted account keeps working until its token expires.
    single.mockResolvedValue({ data: null, error: { message: 'No rows found' } });
    const token = generateToken({ userId: MERCHANT.id, email: MERCHANT.email }, SECRET);
    expect(await statusOf(await requireMerchant(request({ auth: `Bearer ${token}` })))).toBe(401);
  });

  it('refuses to authenticate at all when JWT_SECRET is unset', async () => {
    delete process.env.JWT_SECRET;
    const token = generateToken({ userId: MERCHANT.id, email: MERCHANT.email }, SECRET);
    expect(await statusOf(await requireMerchant(request({ auth: `Bearer ${token}` })))).toBe(500);
  });
});
