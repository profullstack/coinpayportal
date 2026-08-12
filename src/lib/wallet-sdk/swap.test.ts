import { describe, expect, it, vi } from 'vitest';
import { createSwapMethods } from './swap';
import type { WalletAPIClient } from './client';

describe('wallet SDK swap methods', () => {
  it('saves a deposit hash with wallet authentication', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const methods = createSwapMethods({ request } as unknown as WalletAPIClient, 'wallet-123');

    await methods.saveSwapDeposit('swap-123', 'tx-123');

    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/swap/swap-123/deposit',
      body: { txHash: 'tx-123' },
      authenticated: true,
    });
  });
});
