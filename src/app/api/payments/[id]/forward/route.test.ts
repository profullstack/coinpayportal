import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';

// Store original env
const originalEnv = { ...process.env };

// Set up environment variables BEFORE importing the route
beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.INTERNAL_API_KEY = 'test-internal-api-key';
});

// Mock dependencies BEFORE importing the route
vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
    })),
  },
}));

vi.mock('@/lib/auth/jwt', () => ({
  verifyToken: vi.fn(),
}));

vi.mock('@/lib/payments/forwarding', () => ({
  getForwardingStatus: vi.fn(),
}));

vi.mock('@/lib/wallets/secure-forwarding', () => ({
  forwardPaymentSecurely: vi.fn(),
  retryForwardingSecurely: vi.fn(),
}));

// Now import the route and mocked modules
import { POST, GET } from './route';
import { supabaseAdmin } from '@/lib/supabase/server';
import { verifyToken } from '@/lib/auth/jwt';
import { getForwardingStatus } from '@/lib/payments/forwarding';
import { forwardPaymentSecurely, retryForwardingSecurely } from '@/lib/wallets/secure-forwarding';

describe('Payment Forward API', () => {
  const mockPaymentId = 'payment-123';
  const mockParams = Promise.resolve({ id: mockPaymentId });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore env after each test
    process.env = { ...originalEnv };
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.INTERNAL_API_KEY = 'test-internal-api-key';
  });

  describe('POST /api/payments/[id]/forward', () => {
    describe('Authentication', () => {
      it('should return 401 if no authorization header', async () => {
        const request = new NextRequest('http://localhost/api/payments/123/forward', {
          method: 'POST',
        });

        const response = await POST(request, { params: mockParams });
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Unauthorized');
      });

      it('should return 401 if authorization header does not start with Bearer', async () => {
        const request = new NextRequest('http://localhost/api/payments/123/forward', {
          method: 'POST',
          headers: {
            Authorization: 'Basic some-token',
          },
        });

        const response = await POST(request, { params: mockParams });
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Unauthorized');
      });
    });

    describe('Admin JWT Authentication', () => {
      it('should accept valid admin JWT and forward payment', async () => {
        vi.mocked(verifyToken).mockReturnValue({ sub: 'admin-123' });
        vi.mocked(supabaseAdmin.from).mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { is_admin: true },
                error: null,
              }),
            }),
          }),
        } as any);
        vi.mocked(forwardPaymentSecurely).mockResolvedValue({
          success: true,
          merchantTxHash: 'merchant-tx-789',
          platformTxHash: 'platform-tx-012',
          merchantAmount: 99.5,
          platformFee: 0.5,
        });

        const request = new NextRequest('http://localhost/api/payments/123/forward', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-admin-jwt',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        const response = await POST(request, { params: mockParams });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(forwardPaymentSecurely).toHaveBeenCalledWith(supabaseAdmin, mockPaymentId);
      });

      it('should return 401 for invalid JWT token', async () => {
        vi.mocked(verifyToken).mockReturnValue(null);

        const request = new NextRequest('http://localhost/api/payments/123/forward', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer invalid-jwt',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        const response = await POST(request, { params: mockParams });
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Invalid token');
      });

      it('should return 403 for non-admin user', async () => {
        vi.mocked(verifyToken).mockReturnValue({ sub: 'user-123' });
        vi.mocked(supabaseAdmin.from).mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { is_admin: false },
                error: null,
              }),
            }),
          }),
        } as any);

        const request = new NextRequest('http://localhost/api/payments/123/forward', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-user-jwt',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        const response = await POST(request, { params: mockParams });
        const data = await response.json();

        expect(response.status).toBe(403);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Admin access required for manual forwarding');
      });

      it('should return 403 if merchant not found', async () => {
        vi.mocked(verifyToken).mockReturnValue({ sub: 'user-123' });
        vi.mocked(supabaseAdmin.from).mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Not found' },
              }),
            }),
          }),
        } as any);

        const request = new NextRequest('http://localhost/api/payments/123/forward', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-jwt',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        const response = await POST(request, { params: mockParams });
        const data = await response.json();

        expect(response.status).toBe(403);
        expect(data.success).toBe(false);
      });
    });

    describe('Security - Private Key Rejection', () => {
      it('should reject request with privateKey in body (admin auth)', async () => {
        vi.mocked(verifyToken).mockReturnValue({ sub: 'admin-123' });
        vi.mocked(supabaseAdmin.from).mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { is_admin: true },
                error: null,
              }),
            }),
          }),
        } as any);

        const request = new NextRequest('http://localhost/api/payments/123/forward', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-admin-jwt',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ privateKey: 'some-private-key' }),
        });

        const response = await POST(request, { params: mockParams });
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toContain('Private keys cannot be sent via API');
      });

      it('should reject request with private_key in body (admin auth)', async () => {
        vi.mocked(verifyToken).mockReturnValue({ sub: 'admin-123' });
        vi.mocked(supabaseAdmin.from).mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { is_admin: true },
                error: null,
              }),
            }),
          }),
        } as any);

        const request = new NextRequest('http://localhost/api/payments/123/forward', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-admin-jwt',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ private_key: 'some-private-key' }),
        });

        const response = await POST(request, { params: mockParams });
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toContain('Private keys cannot be sent via API');
      });

      it('should reject request with key in body (admin auth)', async () => {
        vi.mocked(verifyToken).mockReturnValue({ sub: 'admin-123' });
        vi.mocked(supabaseAdmin.from).mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { is_admin: true },
                error: null,
              }),
            }),
          }),
        } as any);

        const request = new NextRequest('http://localhost/api/payments/123/forward', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-admin-jwt',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ key: 'some-key' }),
        });

        const response = await POST(request, { params: mockParams });
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toContain('Private keys cannot be sent via API');
      });
    });

    describe('Retry Functionality', () => {
      it('should call retryForwardingSecurely when retry flag is true (admin auth)', async () => {
        vi.mocked(verifyToken).mockReturnValue({ sub: 'admin-123' });
        vi.mocked(supabaseAdmin.from).mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { is_admin: true },
                error: null,
              }),
            }),
          }),
        } as any);
        vi.mocked(retryForwardingSecurely).mockResolvedValue({
          success: true,
          merchantTxHash: 'retry-merchant-tx',
          platformTxHash: 'retry-platform-tx',
          merchantAmount: 99.5,
          platformFee: 0.5,
        });

        const request = new NextRequest('http://localhost/api/payments/123/forward', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-admin-jwt',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ retry: true }),
        });

        const response = await POST(request, { params: mockParams });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(retryForwardingSecurely).toHaveBeenCalledWith(supabaseAdmin, mockPaymentId);
        expect(forwardPaymentSecurely).not.toHaveBeenCalled();
      });
    });

    describe('Forwarding Errors', () => {
      it('should return 400 when forwarding fails (admin auth)', async () => {
        vi.mocked(verifyToken).mockReturnValue({ sub: 'admin-123' });
        vi.mocked(supabaseAdmin.from).mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { is_admin: true },
                error: null,
              }),
            }),
          }),
        } as any);
        vi.mocked(forwardPaymentSecurely).mockResolvedValue({
          success: false,
          error: 'Payment not confirmed',
        });

        const request = new NextRequest('http://localhost/api/payments/123/forward', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-admin-jwt',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        const response = await POST(request, { params: mockParams });
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Payment not confirmed');
      });

      it('should return 500 on unexpected error (admin auth)', async () => {
        vi.mocked(verifyToken).mockReturnValue({ sub: 'admin-123' });
        vi.mocked(supabaseAdmin.from).mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { is_admin: true },
                error: null,
              }),
            }),
          }),
        } as any);
        vi.mocked(forwardPaymentSecurely).mockRejectedValue(new Error('Database connection failed'));

        const request = new NextRequest('http://localhost/api/payments/123/forward', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-admin-jwt',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        const response = await POST(request, { params: mockParams });
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Database connection failed');
      });
    });
  });

  describe('GET /api/payments/[id]/forward', () => {
    describe('Authentication', () => {
      it('should return 401 if no authorization header', async () => {
        const request = new NextRequest('http://localhost/api/payments/123/forward', {
          method: 'GET',
        });

        const response = await GET(request, { params: mockParams });
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Unauthorized');
      });

      it('should return 401 for invalid JWT', async () => {
        vi.mocked(verifyToken).mockReturnValue(null);

        const request = new NextRequest('http://localhost/api/payments/123/forward', {
          method: 'GET',
          headers: {
            Authorization: 'Bearer invalid-jwt',
          },
        });

        const response = await GET(request, { params: mockParams });
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Invalid token');
      });
    });

    describe('Get Forwarding Status', () => {
      it('should return forwarding status for valid request', async () => {
        vi.mocked(verifyToken).mockReturnValue({ sub: 'user-123' });
        vi.mocked(getForwardingStatus).mockResolvedValue({
          paymentId: mockPaymentId,
          status: 'forwarded',
          merchantTxHash: 'merchant-tx-123',
          platformFee: 0.5,
          merchantAmount: 99.5,
          forwardedAt: '2024-01-01T00:00:00Z',
        });

        const request = new NextRequest('http://localhost/api/payments/123/forward', {
          method: 'GET',
          headers: {
            Authorization: 'Bearer valid-jwt',
          },
        });

        const response = await GET(request, { params: mockParams });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data.status).toBe('forwarded');
        expect(data.data.merchantTxHash).toBe('merchant-tx-123');
      });

      it('should return 404 when payment not found', async () => {
        vi.mocked(verifyToken).mockReturnValue({ sub: 'user-123' });
        vi.mocked(getForwardingStatus).mockResolvedValue({
          paymentId: mockPaymentId,
          status: 'unknown',
          error: 'Payment not found',
        });

        const request = new NextRequest('http://localhost/api/payments/123/forward', {
          method: 'GET',
          headers: {
            Authorization: 'Bearer valid-jwt',
          },
        });

        const response = await GET(request, { params: mockParams });
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Payment not found');
      });

      it('should return 500 on unexpected error', async () => {
        vi.mocked(verifyToken).mockReturnValue({ sub: 'user-123' });
        vi.mocked(getForwardingStatus).mockRejectedValue(new Error('Database error'));

        const request = new NextRequest('http://localhost/api/payments/123/forward', {
          method: 'GET',
          headers: {
            Authorization: 'Bearer valid-jwt',
          },
        });

        const response = await GET(request, { params: mockParams });
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Database error');
      });
    });
  });
});