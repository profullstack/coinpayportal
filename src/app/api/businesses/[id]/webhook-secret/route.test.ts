import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyToken = vi.fn();
const mockGetJwtSecret = vi.fn();
const mockGetWebhookSecret = vi.fn();
const mockRegenerateWebhookSecret = vi.fn();

vi.mock('@/lib/auth/jwt', () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
}));
vi.mock('@/lib/secrets', () => ({
  getJwtSecret: () => mockGetJwtSecret(),
}));
vi.mock('@/lib/business/service', () => ({
  getWebhookSecret: (...args: unknown[]) => mockGetWebhookSecret(...args),
  regenerateWebhookSecret: (...args: unknown[]) => mockRegenerateWebhookSecret(...args),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({}),
}));

import { GET, POST } from './route';
import { NextRequest } from 'next/server';

function makeRequest(method: string, url: string) {
  return new NextRequest(new URL(url, 'http://localhost'), {
    method,
    headers: { authorization: 'Bearer test-token' },
  });
}

describe('GET /api/businesses/[id]/webhook-secret', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockGetJwtSecret.mockReturnValue('jwt-secret');
    mockVerifyToken.mockReturnValue({ userId: 'user-1' });
  });

  it('returns 401 without auth header', async () => {
    const req = new NextRequest(new URL('http://localhost/api/businesses/biz-1/webhook-secret'), { method: 'GET' });
    const res = await GET(req, { params: Promise.resolve({ id: 'biz-1' }) });
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    mockVerifyToken.mockImplementation(() => { throw new Error('invalid'); });
    const req = makeRequest('GET', 'http://localhost/api/businesses/biz-1/webhook-secret');
    const res = await GET(req, { params: Promise.resolve({ id: 'biz-1' }) });
    expect(res.status).toBe(401);
  });

  it('returns decrypted webhook secret', async () => {
    mockGetWebhookSecret.mockResolvedValue({
      success: true,
      secret: 'whsecret_abc123def456',
    });
    const req = makeRequest('GET', 'http://localhost/api/businesses/biz-1/webhook-secret');
    const res = await GET(req, { params: Promise.resolve({ id: 'biz-1' }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.secret).toBe('whsecret_abc123def456');
  });

  it('returns 404 when business not found', async () => {
    mockGetWebhookSecret.mockResolvedValue({
      success: false,
      error: 'Business not found',
    });
    const req = makeRequest('GET', 'http://localhost/api/businesses/biz-1/webhook-secret');
    const res = await GET(req, { params: Promise.resolve({ id: 'biz-1' }) });
    expect(res.status).toBe(404);
  });

  it('returns 400 when no secret configured', async () => {
    mockGetWebhookSecret.mockResolvedValue({
      success: false,
      error: 'No webhook secret configured',
    });
    const req = makeRequest('GET', 'http://localhost/api/businesses/biz-1/webhook-secret');
    const res = await GET(req, { params: Promise.resolve({ id: 'biz-1' }) });
    expect(res.status).toBe(400);
  });

  it('passes business id and user id to service', async () => {
    mockGetWebhookSecret.mockResolvedValue({ success: true, secret: 'test' });
    const req = makeRequest('GET', 'http://localhost/api/businesses/biz-42/webhook-secret');
    await GET(req, { params: Promise.resolve({ id: 'biz-42' }) });
    expect(mockGetWebhookSecret).toHaveBeenCalledWith(
      expect.anything(),
      'biz-42',
      'user-1'
    );
  });
});

describe('POST /api/businesses/[id]/webhook-secret', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockGetJwtSecret.mockReturnValue('jwt-secret');
    mockVerifyToken.mockReturnValue({ userId: 'user-1' });
  });

  it('returns 401 without auth header', async () => {
    const req = new NextRequest(new URL('http://localhost/api/businesses/biz-1/webhook-secret'), { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'biz-1' }) });
    expect(res.status).toBe(401);
  });

  it('regenerates webhook secret', async () => {
    mockRegenerateWebhookSecret.mockResolvedValue({
      success: true,
      secret: 'whsecret_new_secret_789',
    });
    const req = makeRequest('POST', 'http://localhost/api/businesses/biz-1/webhook-secret');
    const res = await POST(req, { params: Promise.resolve({ id: 'biz-1' }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.secret).toBe('whsecret_new_secret_789');
    expect(json.message).toContain('regenerated');
  });

  it('returns 400 on regeneration failure', async () => {
    mockRegenerateWebhookSecret.mockResolvedValue({
      success: false,
      error: 'Business not found',
    });
    const req = makeRequest('POST', 'http://localhost/api/businesses/biz-1/webhook-secret');
    const res = await POST(req, { params: Promise.resolve({ id: 'biz-1' }) });
    expect(res.status).toBe(400);
  });

  it('passes business id and user id to service', async () => {
    mockRegenerateWebhookSecret.mockResolvedValue({ success: true, secret: 'test' });
    const req = makeRequest('POST', 'http://localhost/api/businesses/biz-99/webhook-secret');
    await POST(req, { params: Promise.resolve({ id: 'biz-99' }) });
    expect(mockRegenerateWebhookSecret).toHaveBeenCalledWith(
      expect.anything(),
      'biz-99',
      'user-1'
    );
  });
});
