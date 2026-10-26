import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => ({ auth: {}, from: () => ({}) }) }));
vi.mock('@/lib/auth/merchant', () => ({
  resolveMerchant: async () => ({ error: 'Missing authorization header', status: 401 }),
}));

import { GET } from './route';

describe('/api/v1/me/profile', () => {
  it('is 401 JSON when signed out', async () => {
    const res = await GET(new NextRequest('https://coinpayportal.com/api/v1/me/profile'));
    expect(res.status).toBe(401);
    expect(await res.json()).toHaveProperty('error');
  });
});
