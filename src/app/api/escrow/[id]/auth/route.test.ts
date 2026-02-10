/**
 * Tests for POST /api/escrow/:id/auth
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from './route';
import { createClient } from '@supabase/supabase-js';

// Mock dependencies
vi.mock('@supabase/supabase-js');
vi.mock('@/lib/escrow/service');

const mockSupabaseClient = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(),
      })),
    })),
  })),
};

const mockCreateClient = vi.mocked(createClient);
mockCreateClient.mockReturnValue(mockSupabaseClient as any);

const mockEscrowData = {
  id: 'esc_123',
  depositor_address: 'depositor123',
  beneficiary_address: 'beneficiary456',
  escrow_address: 'escrow789',
  chain: 'USDC_POL',
  amount: 100,
  amount_usd: 100,
  fee_amount: 1,
  deposited_amount: null,
  status: 'created',
  deposit_tx_hash: null,
  settlement_tx_hash: null,
  metadata: { description: 'Test escrow' },
  dispute_reason: null,
  dispute_resolution: null,
  release_token: 'esc_release_token_123',
  beneficiary_token: 'esc_beneficiary_token_456',
  business_id: null,
  created_at: '2024-01-01T00:00:00Z',
  funded_at: null,
  released_at: null,
  settled_at: null,
  disputed_at: null,
  refunded_at: null,
  expires_at: '2024-01-02T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

// Mock getEscrow to return the public version (without tokens)
vi.mock('@/lib/escrow/service', () => ({
  getEscrow: vi.fn(() => ({
    success: true,
    escrow: {
      ...mockEscrowData,
      // Remove tokens for public view
      release_token: undefined,
      beneficiary_token: undefined,
      escrow_address_id: undefined,
    },
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_key';
});

describe('POST /api/escrow/:id/auth', () => {
  const createMockRequest = (body: any) => 
    new Request('http://localhost/api/escrow/esc_123/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const createMockParams = () => Promise.resolve({ id: 'esc_123' });

  it('should authenticate depositor with valid release token', async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: mockEscrowData,
      error: null,
    });
    
    mockSupabaseClient.from().select().eq().single = mockSingle;

    const request = createMockRequest({ token: 'esc_release_token_123' });
    const params = createMockParams();

    const response = await POST(request, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.role).toBe('depositor');
    expect(data.escrow).toBeDefined();
    expect(data.escrow.release_token).toBeUndefined(); // Should not expose tokens
  });

  it('should authenticate beneficiary with valid beneficiary token', async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: mockEscrowData,
      error: null,
    });
    
    mockSupabaseClient.from().select().eq().single = mockSingle;

    const request = createMockRequest({ token: 'esc_beneficiary_token_456' });
    const params = createMockParams();

    const response = await POST(request, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.role).toBe('beneficiary');
    expect(data.escrow).toBeDefined();
  });

  it('should reject invalid token', async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: mockEscrowData,
      error: null,
    });
    
    mockSupabaseClient.from().select().eq().single = mockSingle;

    const request = createMockRequest({ token: 'invalid_token' });
    const params = createMockParams();

    const response = await POST(request, { params });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('Invalid authentication token');
  });

  it('should require token in request body', async () => {
    const request = createMockRequest({});
    const params = createMockParams();

    const response = await POST(request, { params });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Authentication token is required');
  });

  it('should return 404 for non-existent escrow', async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'No rows found' },
    });
    
    mockSupabaseClient.from().select().eq().single = mockSingle;

    const request = createMockRequest({ token: 'esc_release_token_123' });
    const params = createMockParams();

    const response = await POST(request, { params });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Escrow not found');
  });

  it('should handle database errors gracefully', async () => {
    const mockSingle = vi.fn().mockRejectedValue(new Error('Database connection failed'));
    
    mockSupabaseClient.from().select().eq().single = mockSingle;

    const request = createMockRequest({ token: 'esc_release_token_123' });
    const params = createMockParams();

    const response = await POST(request, { params });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Internal server error');
  });

  it('should handle missing environment variables', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const request = createMockRequest({ token: 'esc_release_token_123' });
    const params = createMockParams();

    const response = await POST(request, { params });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Internal server error');
  });
});