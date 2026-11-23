import { describe, expect, it } from 'vitest';
import { json } from './http';
import { WalletAPIClient } from '@/lib/wallet-sdk/client';

/** Feed a route's NextResponse straight into the real wallet SDK client. */
function sdkWith(res: Response) {
  return new WalletAPIClient({ baseUrl: 'https://x.test', fetch: async () => res } as never);
}

describe('exchange responses speak the wallet SDK envelope', () => {
  it('success: SDK returns data; REST callers keep top-level fields', async () => {
    const res = json({ quotes: [{ id: 'q1' }], disclosure: 'd' });
    const raw = await res.clone().json();
    expect(raw).toMatchObject({ success: true, quotes: [{ id: 'q1' }], data: { quotes: [{ id: 'q1' }] } });
    const data = await sdkWith(res).request<{ quotes: unknown[] }>({ method: 'POST', path: '/api/exchange/quotes' });
    expect(data.quotes).toEqual([{ id: 'q1' }]);
  });

  it('error: SDK throws with the route message, not "Unknown error"', async () => {
    const res = json({ error: 'Quote expired; request a new one', code: 'quote_expired' }, 409);
    expect(await res.clone().json()).toEqual({ success: false, error: { code: 'quote_expired', message: 'Quote expired; request a new one' } });
    await expect(sdkWith(res).request({ method: 'POST', path: '/api/exchange/orders' })).rejects.toThrow('Quote expired');
  });

  it('a bare auth error still gets a code', async () => {
    expect(await json({ error: 'Authentication required' }, 401).json()).toEqual({
      success: false, error: { code: 'unauthorized', message: 'Authentication required' },
    });
  });
});
