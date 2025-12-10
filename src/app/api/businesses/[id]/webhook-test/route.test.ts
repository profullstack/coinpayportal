import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

// Mock dependencies
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/auth/service', () => ({
  verifySession: vi.fn(),
}));

vi.mock('@/lib/webhooks/service', () => ({
  deliverWebhook: vi.fn(),
  signWebhookPayload: vi.fn(() => 'test-signature-abc123'),
}));

// Import mocked modules
import { verifySession } from '@/lib/auth/service';
import { signWebhookPayload } from '@/lib/webhooks/service';

let mockSupabase: any;

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('POST /api/businesses/[id]/webhook-test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create a chainable mock for Supabase
    mockSupabase = {
      from: vi.fn(),
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn(),
      insert: vi.fn(),
    };
    
    // Set up chaining
    mockSupabase.from.mockReturnValue(mockSupabase);
    mockSupabase.select.mockReturnValue(mockSupabase);
    mockSupabase.eq.mockReturnValue(mockSupabase);
    mockSupabase.single.mockResolvedValue({ data: null, error: null });
    mockSupabase.insert.mockResolvedValue({ error: null });
  });

  it('should return 401 if no authorization header', async () => {
    const request = new NextRequest('http://localhost/api/businesses/biz-123/webhook-test', {
      method: 'POST',
    });
    
    const response = await POST(request, { params: Promise.resolve({ id: 'biz-123' }) });
    const data = await response.json();
    
    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Missing or invalid authorization header');
  });

  it('should return 401 if authorization header is invalid format', async () => {
    const request = new NextRequest('http://localhost/api/businesses/biz-123/webhook-test', {
      method: 'POST',
      headers: {
        Authorization: 'InvalidFormat token',
      },
    });
    
    const response = await POST(request, { params: Promise.resolve({ id: 'biz-123' }) });
    const data = await response.json();
    
    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Missing or invalid authorization header');
  });

  it('should return 401 if session verification fails', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      success: false,
      error: 'Invalid session',
    });

    const request = new NextRequest('http://localhost/api/businesses/biz-123/webhook-test', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    const response = await POST(request, { params: Promise.resolve({ id: 'biz-123' }) });
    const data = await response.json();
    
    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid session');
  });

  it('should return 404 if business not found', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      success: true,
      merchant: { id: 'merchant-123', email: 'test@test.com' },
    });

    mockSupabase.single.mockResolvedValue({
      data: null,
      error: { message: 'Not found' },
    });

    const request = new NextRequest('http://localhost/api/businesses/biz-123/webhook-test', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    const response = await POST(request, { params: Promise.resolve({ id: 'biz-123' }) });
    const data = await response.json();
    
    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Business not found or access denied');
  });

  it('should return 400 if no webhook URL configured', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      success: true,
      merchant: { id: 'merchant-123', email: 'test@test.com' },
    });

    mockSupabase.single.mockResolvedValue({
      data: {
        id: 'biz-123',
        name: 'Test Business',
        webhook_url: null,
        webhook_secret: 'secret-123',
      },
      error: null,
    });

    const request = new NextRequest('http://localhost/api/businesses/biz-123/webhook-test', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    const response = await POST(request, { params: Promise.resolve({ id: 'biz-123' }) });
    const data = await response.json();
    
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('No webhook URL configured. Please set a webhook URL first.');
  });

  it('should return 400 if no webhook secret configured', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      success: true,
      merchant: { id: 'merchant-123', email: 'test@test.com' },
    });

    mockSupabase.single.mockResolvedValue({
      data: {
        id: 'biz-123',
        name: 'Test Business',
        webhook_url: 'https://example.com/webhook',
        webhook_secret: null,
      },
      error: null,
    });

    const request = new NextRequest('http://localhost/api/businesses/biz-123/webhook-test', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    const response = await POST(request, { params: Promise.resolve({ id: 'biz-123' }) });
    const data = await response.json();
    
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('No webhook secret configured. Please generate a webhook secret first.');
  });

  it('should successfully send test webhook and return result', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      success: true,
      merchant: { id: 'merchant-123', email: 'test@test.com' },
    });

    mockSupabase.single.mockResolvedValue({
      data: {
        id: 'biz-123',
        name: 'Test Business',
        webhook_url: 'https://example.com/webhook',
        webhook_secret: 'secret-123',
      },
      error: null,
    });

    // Mock successful fetch response
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('{"received": true}'),
      headers: new Headers({
        'content-type': 'application/json',
      }),
    });

    const request = new NextRequest('http://localhost/api/businesses/biz-123/webhook-test', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    const response = await POST(request, { params: Promise.resolve({ id: 'biz-123' }) });
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.test_result).toBeDefined();
    expect(data.test_result.delivered).toBe(true);
    expect(data.test_result.status_code).toBe(200);
    expect(data.test_result.response_body).toBe('{"received": true}');
    expect(data.test_result.request.url).toBe('https://example.com/webhook');
    expect(data.test_result.request.method).toBe('POST');
    expect(data.test_result.request.body.event).toBe('test.webhook');
    expect(data.test_result.request.body.message).toBe('This is a test webhook from CoinPay');
  });

  it('should handle failed webhook delivery', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      success: true,
      merchant: { id: 'merchant-123', email: 'test@test.com' },
    });

    mockSupabase.single.mockResolvedValue({
      data: {
        id: 'biz-123',
        name: 'Test Business',
        webhook_url: 'https://example.com/webhook',
        webhook_secret: 'secret-123',
      },
      error: null,
    });

    // Mock failed fetch response
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('Server error'),
      headers: new Headers({}),
    });

    const request = new NextRequest('http://localhost/api/businesses/biz-123/webhook-test', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    const response = await POST(request, { params: Promise.resolve({ id: 'biz-123' }) });
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.test_result.delivered).toBe(false);
    expect(data.test_result.status_code).toBe(500);
  });

  it('should handle network errors', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      success: true,
      merchant: { id: 'merchant-123', email: 'test@test.com' },
    });

    mockSupabase.single.mockResolvedValue({
      data: {
        id: 'biz-123',
        name: 'Test Business',
        webhook_url: 'https://example.com/webhook',
        webhook_secret: 'secret-123',
      },
      error: null,
    });

    // Mock network error
    mockFetch.mockRejectedValue(new Error('Network error: Connection refused'));

    const request = new NextRequest('http://localhost/api/businesses/biz-123/webhook-test', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    const response = await POST(request, { params: Promise.resolve({ id: 'biz-123' }) });
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.test_result.delivered).toBe(false);
    expect(data.test_result.error).toBe('Network error: Connection refused');
  });

  it('should log webhook test attempt to database', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      success: true,
      merchant: { id: 'merchant-123', email: 'test@test.com' },
    });

    mockSupabase.single.mockResolvedValue({
      data: {
        id: 'biz-123',
        name: 'Test Business',
        webhook_url: 'https://example.com/webhook',
        webhook_secret: 'secret-123',
      },
      error: null,
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('{"received": true}'),
      headers: new Headers({}),
    });

    const request = new NextRequest('http://localhost/api/businesses/biz-123/webhook-test', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    await POST(request, { params: Promise.resolve({ id: 'biz-123' }) });
    
    // Verify that webhook_logs insert was called
    expect(mockSupabase.from).toHaveBeenCalledWith('webhook_logs');
    expect(mockSupabase.insert).toHaveBeenCalled();
    
    const insertCall = mockSupabase.insert.mock.calls[0][0];
    expect(insertCall.business_id).toBe('biz-123');
    expect(insertCall.event).toBe('test.webhook');
    expect(insertCall.webhook_url).toBe('https://example.com/webhook');
    expect(insertCall.success).toBe(true);
    expect(insertCall.status_code).toBe(200);
  });

  it('should include response time in test result', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      success: true,
      merchant: { id: 'merchant-123', email: 'test@test.com' },
    });

    mockSupabase.single.mockResolvedValue({
      data: {
        id: 'biz-123',
        name: 'Test Business',
        webhook_url: 'https://example.com/webhook',
        webhook_secret: 'secret-123',
      },
      error: null,
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('{}'),
      headers: new Headers({}),
    });

    const request = new NextRequest('http://localhost/api/businesses/biz-123/webhook-test', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    const response = await POST(request, { params: Promise.resolve({ id: 'biz-123' }) });
    const data = await response.json();
    
    expect(data.test_result.response_time_ms).toBeDefined();
    expect(typeof data.test_result.response_time_ms).toBe('number');
    expect(data.test_result.response_time_ms).toBeGreaterThanOrEqual(0);
  });

  it('should sign payload with webhook secret', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      success: true,
      merchant: { id: 'merchant-123', email: 'test@test.com' },
    });

    mockSupabase.single.mockResolvedValue({
      data: {
        id: 'biz-123',
        name: 'Test Business',
        webhook_url: 'https://example.com/webhook',
        webhook_secret: 'secret-123',
      },
      error: null,
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('{}'),
      headers: new Headers({}),
    });

    const request = new NextRequest('http://localhost/api/businesses/biz-123/webhook-test', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    await POST(request, { params: Promise.resolve({ id: 'biz-123' }) });
    
    // Verify signWebhookPayload was called with the secret
    expect(signWebhookPayload).toHaveBeenCalled();
    const signCall = vi.mocked(signWebhookPayload).mock.calls[0];
    expect(signCall[1]).toBe('secret-123');
    
    // Verify fetch was called with signature header
    expect(mockFetch).toHaveBeenCalled();
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[1].headers['X-Webhook-Signature']).toBe('test-signature-abc123');
  });
});
