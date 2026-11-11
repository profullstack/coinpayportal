import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSupabase = vi.hoisted(() => ({ from: vi.fn() }));
const mockCreateEscrow = vi.hoisted(() => vi.fn());
const mockResolvePayee = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue(mockSupabase),
}));

// A business API key for biz_1.
vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    success: true,
    context: { type: 'business', businessId: 'biz_1', scopes: ['payments:create'] },
  }),
  isMerchantAuth: vi.fn().mockReturnValue(false),
  hasScope: (c: any, s: string) => (c?.scopes ?? []).includes('*') || (c?.scopes ?? []).includes(s),
}));

vi.mock('@/lib/auth/authz', () => ({ getAccessibleBusinessRoles: vi.fn() }));
vi.mock('@/lib/web-wallet/rate-limit', () => ({
  checkRateLimitAsync: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('@/lib/entitlements/service', () => ({
  isBusinessPaidTier: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/lib/multisig/engine', () => ({
  isMultisigEnabled: vi.fn().mockReturnValue(false),
  isMultisigDefault: vi.fn().mockReturnValue(false),
}));
vi.mock('@/lib/escrow', () => ({
  createEscrow: mockCreateEscrow,
  listEscrows: vi.fn(),
}));
vi.mock('@/lib/payments/payee', () => ({ resolvePayee: mockResolvePayee }));

import { POST } from './route';

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/escrow', {
    method: 'POST',
    headers: { 'x-api-key': 'cp_live_test', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const escrowBody = {
  chain: 'SOL',
  amount: 1,
  depositor_address: 'Depositor1111111111111111111111111',
  beneficiary_address: 'Beneficiary11111111111111111111111',
};

describe('POST /api/escrow marketplace fee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { merchant_id: 'merch_1' }, error: null }),
    });
    mockCreateEscrow.mockResolvedValue({ success: true, escrow: { id: 'esc_1' } });
  });

  it("pays the fee to the owning business's wallet, not an address from the body", async () => {
    mockResolvePayee.mockResolvedValue({ ok: true, address: 'BusinessSolWallet', source: 'business' });

    const res = await POST(post({
      ...escrowBody,
      marketplace_fee_percent: 5,
      marketplace_fee_address: 'AttackerWallet',
    }));

    expect(res.status).toBe(201);
    expect(mockResolvePayee).toHaveBeenCalledWith(mockSupabase, {
      businessId: 'biz_1',
      merchantId: 'merch_1',
      cryptocurrency: 'SOL',
    });
    const input = mockCreateEscrow.mock.calls[0][1];
    expect(input.marketplace_fee_percent).toBe(5);
    expect(input.marketplace_fee_address).toBe('BusinessSolWallet');
  });

  it('refuses the escrow when the business has no wallet for the chain', async () => {
    mockResolvePayee.mockResolvedValue({
      ok: false,
      code: 'PAYEE_REQUIRED',
      error: 'No SOL wallet could be determined from your account',
      status: 400,
    });

    const res = await POST(post({ ...escrowBody, marketplace_fee_percent: 5 }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Marketplace fee: No SOL wallet/);
    expect(mockCreateEscrow).not.toHaveBeenCalled();
  });

  it('drops a body-supplied fee address when no fee is requested', async () => {
    const res = await POST(post({ ...escrowBody, marketplace_fee_address: 'AttackerWallet' }));

    expect(res.status).toBe(201);
    expect(mockResolvePayee).not.toHaveBeenCalled();
    expect(mockCreateEscrow.mock.calls[0][1].marketplace_fee_address).toBeUndefined();
  });
});
