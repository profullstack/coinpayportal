import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  paypalApiBase,
  getPaypalAccessToken,
  createPaypalOrder,
  capturePaypalOrder,
} from './client';

const creds = { clientId: 'cid', clientSecret: 'secret', environment: 'sandbox' as const };

describe('paypalApiBase', () => {
  it('uses the sandbox host for sandbox', () => {
    expect(paypalApiBase('sandbox')).toBe('https://api-m.sandbox.paypal.com');
  });
  it('uses the live host for live', () => {
    expect(paypalApiBase('live')).toBe('https://api-m.paypal.com');
  });
});

describe('PayPal client HTTP calls', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function ok(body: unknown) {
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }
  function fail(status: number, body: unknown) {
    return { ok: false, status, json: async () => body } as unknown as Response;
  }

  it('getPaypalAccessToken returns the token and sends basic auth', async () => {
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'tok123' }));
    const token = await getPaypalAccessToken(creds);
    expect(token).toBe('tok123');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/oauth2/token');
    expect((init.headers as any).Authorization).toBe(
      `Basic ${Buffer.from('cid:secret').toString('base64')}`
    );
  });

  it('getPaypalAccessToken throws on auth failure', async () => {
    fetchMock.mockResolvedValueOnce(fail(401, { error_description: 'bad creds' }));
    await expect(getPaypalAccessToken(creds)).rejects.toThrow(/bad creds/);
  });

  it('createPaypalOrder returns the order id and approve link', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ access_token: 'tok' }))
      .mockResolvedValueOnce(
        ok({
          id: 'ORDER-1',
          status: 'CREATED',
          links: [
            { rel: 'self', href: 'https://x/self' },
            { rel: 'approve', href: 'https://paypal/approve?token=ORDER-1' },
          ],
        })
      );

    const order = await createPaypalOrder({
      ...creds,
      amount: 10,
      currency: 'usd',
      returnUrl: 'https://app/return',
      cancelUrl: 'https://app/cancel',
    });

    expect(order.orderId).toBe('ORDER-1');
    expect(order.approveUrl).toBe('https://paypal/approve?token=ORDER-1');
    // Amount is normalized to 2dp and currency upper-cased.
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.purchase_units[0].amount.value).toBe('10.00');
    expect(body.purchase_units[0].amount.currency_code).toBe('USD');
    expect(body.intent).toBe('CAPTURE');
  });

  it('capturePaypalOrder extracts capture details', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ access_token: 'tok' }))
      .mockResolvedValueOnce(
        ok({
          status: 'COMPLETED',
          payer: { email_address: 'buyer@example.com' },
          purchase_units: [
            { payments: { captures: [{ id: 'CAP-1', amount: { value: '10.00', currency_code: 'USD' } }] } },
          ],
        })
      );

    const result = await capturePaypalOrder({ ...creds, orderId: 'ORDER-1' });
    expect(result.status).toBe('COMPLETED');
    expect(result.captureId).toBe('CAP-1');
    expect(result.payerEmail).toBe('buyer@example.com');
    expect(result.amount).toBe('10.00');
    expect(fetchMock.mock.calls[1][0]).toContain('/v2/checkout/orders/ORDER-1/capture');
  });
});
