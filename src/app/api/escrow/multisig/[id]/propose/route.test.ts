import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockSupabase = vi.hoisted(() => ({ from: vi.fn() }));
const mockProposeTransaction = vi.hoisted(() => vi.fn());
const mockRequireMultisigAuth = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue(mockSupabase),
}));

vi.mock('@/lib/multisig', () => ({
  proposeTransaction: mockProposeTransaction,
  prepareTransactionSchema: {
    safeParse: vi.fn().mockReturnValue({
      success: true,
      data: {
        proposal_type: 'release',
        to_address: '0x2222222222222222222222222222222222222222',
        signer_pubkey: '0x1111111111111111111111111111111111111111',
      },
    }),
  },
}));

vi.mock('../../auth', () => ({
  requireMultisigAuth: mockRequireMultisigAuth,
}));

import { POST } from './route';

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest(
    'http://localhost:3000/api/escrow/multisig/esc_1/propose',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        proposal_type: 'release',
        to_address: '0x2222222222222222222222222222222222222222',
        signer_pubkey: '0x1111111111111111111111111111111111111111',
      }),
    },
  );
}

describe('POST /api/escrow/multisig/:id/propose', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('returns 401 before creating a proposal when authentication is missing', async () => {
    mockRequireMultisigAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { error: 'Authentication required. Provide Authorization header or X-API-Key.' },
        { status: 401 },
      ),
    });

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ id: 'esc_1' }),
    });

    expect(response.status).toBe(401);
    expect(mockProposeTransaction).not.toHaveBeenCalled();
  });

  it('creates a prepared proposal for authenticated callers', async () => {
    mockRequireMultisigAuth.mockResolvedValue({ ok: true });
    mockProposeTransaction.mockResolvedValue({
      success: true,
      proposal: { id: 'prop_1' },
      tx_data: { tx_hash_to_sign: 'abc123' },
    });

    const response = await POST(makeRequest({ authorization: 'Bearer test' }), {
      params: Promise.resolve({ id: 'esc_1' }),
    });

    expect(response.status).toBe(201);
    expect(mockProposeTransaction).toHaveBeenCalledWith(
      mockSupabase,
      'esc_1',
      'release',
      '0x2222222222222222222222222222222222222222',
      '0x1111111111111111111111111111111111111111',
    );
    expect(await response.json()).toEqual({
      proposal: { id: 'prop_1' },
      tx_data: { tx_hash_to_sign: 'abc123' },
    });
  });
});
