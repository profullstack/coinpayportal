import { describe, expect, it, vi } from 'vitest';
import { createLightningMethods } from './lightning';

describe('createLightningMethods', () => {
  it('lists wallet payments without resolving a Lightning node', async () => {
    const request = vi.fn(async () => ({ payments: [] }));
    const lightning = createLightningMethods({ request } as any, 'wallet-1', () => null);

    await lightning.listLightningPayments();

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/lightning/payments',
      query: {
        wallet_id: 'wallet-1',
        node_id: undefined,
        business_id: undefined,
        offer_id: undefined,
        limit: '20',
      },
      authenticated: true,
    });
  });

  it('reuses a node fetched by getLightningNode', async () => {
    const request = vi.fn(async ({ path }: { path: string }) => {
      if (path === '/api/lightning/nodes') return { node: { id: 'node-1' } };
      return { invoice: { payment_hash: 'hash-1', bolt11: 'lnbc1' } };
    });
    const lightning = createLightningMethods({ request } as any, 'wallet-1', () => 'mnemonic');

    await lightning.getLightningNode();
    await lightning.createLightningInvoice(100);

    expect(request).toHaveBeenCalledTimes(2);
  });

  it('reuses a node created by enableLightning', async () => {
    const request = vi.fn(async ({ path }: { path: string }) => {
      if (path === '/api/lightning/nodes') return { node: { id: 'node-1' } };
      return { payment_hash: 'hash-1', status: 'paid' };
    });
    const lightning = createLightningMethods({ request } as any, 'wallet-1', () => 'mnemonic');

    await lightning.enableLightning('mnemonic');
    await lightning.payLightningInvoice('lnbc1');

    expect(request).toHaveBeenCalledTimes(2);
  });
});
