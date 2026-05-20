import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/auth/jwt', () => ({
  verifyToken: vi.fn(),
}));

vi.mock('@/lib/secrets', () => ({
  getJwtSecret: vi.fn(() => 'test-secret'),
}));

vi.mock('@/lib/payments/fees', () => ({
  getFeePercentage: vi.fn(() => 0.01),
}));

vi.mock('@/lib/entitlements/service', () => ({
  isBusinessPaidTier: vi.fn(async () => false),
}));

vi.mock('@/lib/auth/apikey', () => ({
  isApiKey: vi.fn((token: string) => token?.startsWith('cp_live_') || token?.startsWith('cp_test_')),
  getBusinessByApiKey: vi.fn(),
}));

import { createClient } from '@supabase/supabase-js';
import { getBusinessByApiKey } from '@/lib/auth/apikey';
import { POST } from './route';

const API_KEY = 'cp_test_' + 'a'.repeat(32);

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/invoices', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/invoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a CoinPay API key from X-API-Key when creating invoices', async () => {
    const businessSelect = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'biz-1' }, error: null }),
    };

    const invoiceInsert = {
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'inv-1',
          business_id: 'biz-1',
          invoice_number: 'INV-006',
          amount: 200,
          currency: 'USD',
        },
        error: null,
      }),
    };

    const invoiceTable = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { invoice_number: 'INV-005' }, error: null }),
      insert: vi.fn().mockReturnValue(invoiceInsert),
    };

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'businesses') return businessSelect;
        if (table === 'invoices') return invoiceTable;
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    (createClient as any).mockReturnValue(supabase);
    (getBusinessByApiKey as any).mockResolvedValue({
      success: true,
      business: {
        id: 'biz-1',
        merchant_id: 'merchant-1',
        name: 'Test Business',
        active: true,
      },
    });

    const response = await POST(
      postRequest({
        amount: 200,
        currency: 'USD',
        notes: 'UGig invoice smoke test',
      })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        success: true,
        invoice: expect.objectContaining({ id: 'inv-1' }),
      })
    );
    expect(getBusinessByApiKey).toHaveBeenCalledWith(supabase, API_KEY);
    expect(invoiceTable.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'merchant-1',
        business_id: 'biz-1',
        invoice_number: 'INV-006',
        amount: 200,
        currency: 'USD',
      })
    );
  });
});
