import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  const single = vi.fn();
  const selectWalletEq = vi.fn(() => ({ single }));
  const selectIdEq = vi.fn(() => ({ eq: selectWalletEq }));
  const select = vi.fn(() => ({ eq: selectIdEq }));
  const updateWalletEq = vi.fn();
  const updateIdEq = vi.fn(() => ({ eq: updateWalletEq }));
  const update = vi.fn(() => ({ eq: updateIdEq }));
  const from = vi.fn(() => ({ select, update }));
  const authenticate = vi.fn();

  return {
    single,
    selectWalletEq,
    selectIdEq,
    select,
    updateWalletEq,
    updateIdEq,
    update,
    from,
    authenticate,
  };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mocks.from })),
}));

vi.mock('@/lib/web-wallet/auth', () => ({
  authenticateWalletRequest: (...args: unknown[]) => mocks.authenticate(...args),
}));

import { POST } from './route';

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/swap/swap-123/deposit', {
    method: 'POST',
    headers: {
      authorization: 'Wallet wallet-123:signature:1234567890:nonce',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/swap/[id]/deposit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.single.mockResolvedValue({
      data: { provider_data: { depositCoin: 'btc' } },
      error: null,
    });
    mocks.authenticate.mockResolvedValue({ success: true, walletId: 'wallet-123' });
    mocks.updateWalletEq.mockResolvedValue({ error: null });
  });

  it('authenticates the request against the swap owner and scopes the update', async () => {
    const request = makeRequest({ txHash: 'tx-123' });
    const response = await POST(request, { params: Promise.resolve({ id: 'swap-123' }) });

    expect(response.status).toBe(200);
    expect(mocks.authenticate).toHaveBeenCalledWith(
      expect.anything(),
      request.headers.get('authorization'),
      'POST',
      '/api/swap/swap-123/deposit',
      JSON.stringify({ txHash: 'tx-123' })
    );
    expect(mocks.selectIdEq).toHaveBeenCalledWith('id', 'swap-123');
    expect(mocks.selectWalletEq).toHaveBeenCalledWith('wallet_id', 'wallet-123');
    expect(mocks.update).toHaveBeenCalledWith({
      provider_data: { depositCoin: 'btc', deposit_tx_hash: 'tx-123' },
    });
    expect(mocks.updateIdEq).toHaveBeenCalledWith('id', 'swap-123');
    expect(mocks.updateWalletEq).toHaveBeenCalledWith('wallet_id', 'wallet-123');
  });

  it('rejects unauthenticated requests without reading or updating the swap', async () => {
    mocks.authenticate.mockResolvedValue({ success: false, error: 'Invalid signature' });

    const response = await POST(makeRequest({ txHash: 'tx-123' }), {
      params: Promise.resolve({ id: 'swap-123' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('returns 404 when the swap does not exist', async () => {
    mocks.single.mockResolvedValue({ data: null, error: { message: 'not found' } });

    const response = await POST(makeRequest({ txHash: 'tx-123' }), {
      params: Promise.resolve({ id: 'missing' }),
    });

    expect(response.status).toBe(404);
    expect(mocks.authenticate).toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects a missing transaction hash before authentication', async () => {
    const response = await POST(makeRequest({}), {
      params: Promise.resolve({ id: 'swap-123' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it('rejects a missing swap ID before authentication', async () => {
    const response = await POST(makeRequest({ txHash: 'tx-123' }), {
      params: Promise.resolve({ id: '' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });
});
