/**
 * Escrow Series API Route Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockOrder = vi.fn();
const mockLte = vi.fn();
const mockLimit = vi.fn();

const mockFrom = vi.fn(() => ({
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  eq: mockEq,
  single: mockSingle,
  order: mockOrder,
  lte: mockLte,
  limit: mockLimit,
}));

// Chain mocks
mockSelect.mockReturnValue({ eq: mockEq, single: mockSingle, order: mockOrder });
mockInsert.mockReturnValue({ select: mockSelect });
mockUpdate.mockReturnValue({ eq: mockEq, select: mockSelect });
mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, order: mockOrder, select: mockSelect, lte: mockLte, limit: mockLimit });
mockOrder.mockReturnValue({ data: [], error: null });
mockSingle.mockReturnValue({ data: null, error: null });

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    success: true,
    context: { type: 'merchant', merchantId: 'merch_123' },
  }),
  isMerchantAuth: vi.fn().mockReturnValue(true),
}));

describe('Escrow Series API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-setup chains after clear
    mockFrom.mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      eq: mockEq,
    });
    mockSelect.mockReturnValue({ eq: mockEq, single: mockSingle, order: mockOrder });
    mockInsert.mockReturnValue({ select: mockSelect });
    mockSingle.mockReturnValue({ data: { id: 'ser_123', status: 'active' }, error: null });
    mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, order: mockOrder, select: mockSelect });
    mockOrder.mockReturnValue({ data: [], error: null });
  });

  it('should validate required fields on POST', async () => {
    const { POST } = await import('./route');

    const request = new Request('http://localhost/api/escrow/series', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test' },
      body: JSON.stringify({ business_id: 'biz_123' }), // missing required fields
    });

    const response = await POST(request as any);
    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toContain('Required');
  });

  it('should validate payment_method', async () => {
    const { POST } = await import('./route');

    const request = new Request('http://localhost/api/escrow/series', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test' },
      body: JSON.stringify({
        business_id: 'biz_123',
        payment_method: 'invalid',
        amount: 5000,
        interval: 'monthly',
      }),
    });

    const response = await POST(request as any);
    expect(response.status).toBe(400);
  });

  it('should require business_id on GET', async () => {
    const { GET } = await import('./route');

    const request = new Request('http://localhost/api/escrow/series', {
      headers: { 'Authorization': 'Bearer test' },
    });

    const response = await GET(request as any);
    expect(response.status).toBe(400);
  });
});
