import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';

// Mock dependencies
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/auth/jwt', () => ({
  verifyToken: vi.fn(),
}));

vi.mock('@/lib/business/service', () => ({
  listBusinesses: vi.fn(),
}));

// Import mocked modules
import { verifyToken } from '@/lib/auth/jwt';
import { listBusinesses } from '@/lib/business/service';

let mockSupabase: any;

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

describe('GET /api/payments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create a chainable mock that returns itself for all query methods
    // Supabase queries are thenable - they implement .then() for awaiting
    mockSupabase = {
      from: vi.fn(),
      select: vi.fn(),
      in: vi.fn(),
      eq: vi.fn(),
      ilike: vi.fn(),
      gte: vi.fn(),
      lt: vi.fn(),
      order: vi.fn(),
      // Make the mock thenable so it can be awaited
      then: vi.fn((resolve) => resolve({ data: [], error: null })),
    };
    
    // Set up chaining - each method returns mockSupabase (which is thenable)
    mockSupabase.from.mockReturnValue(mockSupabase);
    mockSupabase.select.mockReturnValue(mockSupabase);
    mockSupabase.in.mockReturnValue(mockSupabase);
    mockSupabase.eq.mockReturnValue(mockSupabase);
    mockSupabase.ilike.mockReturnValue(mockSupabase);
    mockSupabase.gte.mockReturnValue(mockSupabase);
    mockSupabase.lt.mockReturnValue(mockSupabase);
    mockSupabase.order.mockReturnValue(mockSupabase);
  });

  it('should return 401 if no authorization header', async () => {
    const request = new NextRequest('http://localhost/api/payments');
    
    const response = await GET(request);
    const data = await response.json();
    
    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Missing authorization header');
  });

  it('should return 401 if authorization header is invalid format', async () => {
    const request = new NextRequest('http://localhost/api/payments', {
      headers: {
        Authorization: 'InvalidFormat token',
      },
    });
    
    const response = await GET(request);
    const data = await response.json();
    
    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Missing authorization header');
  });

  it('should return 401 if token is invalid', async () => {
    vi.mocked(verifyToken).mockImplementation(() => {
      throw new Error('Invalid token');
    });

    const request = new NextRequest('http://localhost/api/payments', {
      headers: {
        Authorization: 'Bearer invalid-token',
      },
    });
    
    const response = await GET(request);
    const data = await response.json();
    
    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid or expired token');
  });

  it('should return empty array if user has no businesses', async () => {
    vi.mocked(verifyToken).mockReturnValue({ userId: 'user-123', email: 'test@test.com' });
    vi.mocked(listBusinesses).mockResolvedValue({
      success: true,
      businesses: [],
    });

    const request = new NextRequest('http://localhost/api/payments', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    const response = await GET(request);
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.payments).toEqual([]);
  });

  it('should return payments for user businesses', async () => {
    vi.mocked(verifyToken).mockReturnValue({ userId: 'user-123', email: 'test@test.com' });
    vi.mocked(listBusinesses).mockResolvedValue({
      success: true,
      businesses: [{ id: 'business-1', name: 'Test Business' }],
    });

    const mockPayments = [
      {
        id: 'payment-1',
        business_id: 'business-1',
        amount: 100,
        currency: 'USD',
        blockchain: 'BTC',
        status: 'pending',
        crypto_amount: 0.002,
        crypto_currency: 'BTC',
        payment_address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        tx_hash: null,
        confirmations: 0,
        metadata: {},
        created_at: '2024-01-01T00:00:00Z',
        expires_at: '2024-01-01T01:00:00Z',
      },
    ];

    mockSupabase.then = vi.fn((resolve) => resolve({ data: mockPayments, error: null }));

    const request = new NextRequest('http://localhost/api/payments', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    const response = await GET(request);
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.payments).toHaveLength(1);
    expect(data.payments[0].id).toBe('payment-1');
    expect(data.payments[0].amount_crypto).toBe('0.002');
    expect(data.payments[0].amount_usd).toBe('100');
  });

  it('should filter by business_id', async () => {
    vi.mocked(verifyToken).mockReturnValue({ userId: 'user-123', email: 'test@test.com' });
    vi.mocked(listBusinesses).mockResolvedValue({
      success: true,
      businesses: [
        { id: 'business-1', name: 'Business 1' },
        { id: 'business-2', name: 'Business 2' },
      ],
    });

    const request = new NextRequest('http://localhost/api/payments?business_id=business-1', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    const response = await GET(request);
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockSupabase.eq).toHaveBeenCalledWith('business_id', 'business-1');
  });

  it('should filter by status', async () => {
    vi.mocked(verifyToken).mockReturnValue({ userId: 'user-123', email: 'test@test.com' });
    vi.mocked(listBusinesses).mockResolvedValue({
      success: true,
      businesses: [{ id: 'business-1', name: 'Test Business' }],
    });

    const request = new NextRequest('http://localhost/api/payments?status=confirmed', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    const response = await GET(request);
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockSupabase.eq).toHaveBeenCalledWith('status', 'confirmed');
  });

  it('should filter by currency', async () => {
    vi.mocked(verifyToken).mockReturnValue({ userId: 'user-123', email: 'test@test.com' });
    vi.mocked(listBusinesses).mockResolvedValue({
      success: true,
      businesses: [{ id: 'business-1', name: 'Test Business' }],
    });

    const request = new NextRequest('http://localhost/api/payments?currency=btc', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    const response = await GET(request);
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockSupabase.ilike).toHaveBeenCalledWith('blockchain', '%btc%');
  });

  it('should filter by date range', async () => {
    vi.mocked(verifyToken).mockReturnValue({ userId: 'user-123', email: 'test@test.com' });
    vi.mocked(listBusinesses).mockResolvedValue({
      success: true,
      businesses: [{ id: 'business-1', name: 'Test Business' }],
    });

    const request = new NextRequest(
      'http://localhost/api/payments?date_from=2024-01-01&date_to=2024-01-31',
      {
        headers: {
          Authorization: 'Bearer valid-token',
        },
      }
    );
    
    const response = await GET(request);
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockSupabase.gte).toHaveBeenCalled();
    expect(mockSupabase.lt).toHaveBeenCalled();
  });

  it('should return 400 if listBusinesses fails', async () => {
    vi.mocked(verifyToken).mockReturnValue({ userId: 'user-123', email: 'test@test.com' });
    vi.mocked(listBusinesses).mockResolvedValue({
      success: false,
      error: 'Database error',
    });

    const request = new NextRequest('http://localhost/api/payments', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    const response = await GET(request);
    const data = await response.json();
    
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Failed to fetch businesses');
  });

  it('should return 500 if database query fails', async () => {
    vi.mocked(verifyToken).mockReturnValue({ userId: 'user-123', email: 'test@test.com' });
    vi.mocked(listBusinesses).mockResolvedValue({
      success: true,
      businesses: [{ id: 'business-1', name: 'Test Business' }],
    });

    mockSupabase.then = vi.fn((resolve) => resolve({
      data: null,
      error: { message: 'Database error' }
    }));

    const request = new NextRequest('http://localhost/api/payments', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    const response = await GET(request);
    const data = await response.json();
    
    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Failed to fetch payments');
  });

  it('should not allow filtering by business_id not owned by user', async () => {
    vi.mocked(verifyToken).mockReturnValue({ userId: 'user-123', email: 'test@test.com' });
    vi.mocked(listBusinesses).mockResolvedValue({
      success: true,
      businesses: [{ id: 'business-1', name: 'Test Business' }],
    });

    const request = new NextRequest('http://localhost/api/payments?business_id=other-business', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });
    
    const response = await GET(request);
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    // Should not filter by the unauthorized business_id
    expect(mockSupabase.eq).not.toHaveBeenCalledWith('business_id', 'other-business');
  });
});