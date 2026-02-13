import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/service', () => ({
  requestPasswordReset: vi.fn().mockResolvedValue({ success: true, token: 'test-token' }),
}));

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/web-wallet/rate-limit', () => ({
  checkRateLimitAsync: vi.fn().mockResolvedValue({ allowed: true, remaining: 5, resetAt: 0, limit: 10 }),
}));

vi.mock('@/lib/web-wallet/client-ip', () => ({
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue({}),
}));

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.NEXT_PUBLIC_APP_URL = 'https://coinpayportal.com';
  });

  it('should return success for valid email', async () => {
    const request = new NextRequest('http://localhost/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('should return success even for invalid email format', async () => {
    const request = new NextRequest('http://localhost/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'not-an-email' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.success).toBe(true);
  });
});
