import { describe, expect, it, vi } from 'vitest';
import { createExchangeMethods, isWalletExecutable } from './exchange';
import type { WalletAPIClient } from './client';

describe('wallet exchange methods', () => {
  const request = vi.fn(async (opts: any) => {
    if (opts.path === '/api/exchange/quotes') return { quotes: [{ id: 'q1', provider: 'changenow' }], unavailable: [], disclosure: 'd' };
    if (opts.path === '/api/exchange/orders' && opts.method === 'GET') return { orders: [{ id: 'o1' }] };
    return { order: { id: 'o1' } };
  });
  const m = createExchangeMethods({ request } as unknown as WalletAPIClient);

  it('signs every call, including quotes', async () => {
    await m.getExchangeQuotes({ from: 'BTC', to: 'ETH', amount: '0.01' });
    await m.createExchangeOrder({ quoteId: 'q1', destinationAddress: '0xabc', idempotencyKey: 'wallet-123456' });
    await m.submitExchangeTx('o1', 'ab'.repeat(32));
    await m.getExchangeOrder('o1');
    await m.listExchangeOrders(10);
    await m.cancelExchangeOrder('o1');
    expect(request.mock.calls.every(([o]) => o.authenticated === true)).toBe(true);
    expect(request.mock.calls.map(([o]) => `${o.method} ${o.path}`)).toEqual([
      'POST /api/exchange/quotes',
      'POST /api/exchange/orders',
      'POST /api/exchange/orders/o1/submit',
      'GET /api/exchange/orders/o1',
      'GET /api/exchange/orders',
      'POST /api/exchange/orders/o1/cancel',
    ]);
    // The idempotency key travels in the body (the client sets no custom headers).
    expect(request.mock.calls[1][0].body).toMatchObject({ idempotencyKey: 'wallet-123456' });
  });

  it('only plain-send providers are executable by the web wallet', () => {
    expect(isWalletExecutable('changenow')).toBe(true);
    expect(isWalletExecutable('thorchain')).toBe(false);
  });
});
