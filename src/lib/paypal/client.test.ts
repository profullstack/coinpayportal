import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  paypalApiBase,
  getPaypalAccessToken,
  createPaypalOrder,
  capturePaypalOrder,
  paypalAuthAssertion,
  refundPaypalCapture,
  verifyPaypalWebhookSignature,
  getPaypalBalances,
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

  // ---------------------------------------------------------------------------
  // Partner mode: acting on behalf of an onboarded merchant, with a platform fee
  // ---------------------------------------------------------------------------

  it('createPaypalOrder attaches a platform fee and payee in partner mode', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ access_token: 'tok' }))
      .mockResolvedValueOnce(
        ok({ id: 'ORDER-2', status: 'CREATED', links: [{ rel: 'approve', href: 'https://pp/a' }] })
      );

    await createPaypalOrder({
      ...creds,
      amount: 100,
      currency: 'usd',
      returnUrl: 'https://app/return',
      cancelUrl: 'https://app/cancel',
      payeeMerchantId: 'MERCHANT1',
      platformFee: 1,
      platformFeePayeeMerchantId: 'PARTNER1',
      authAssertionMerchantId: 'MERCHANT1',
      bnCode: 'BN123',
      requestId: 'row-1',
    });

    const [, init] = fetchMock.mock.calls[1];
    const body = JSON.parse(init.body);
    const unit = body.purchase_units[0];

    expect(unit.payee).toEqual({ merchant_id: 'MERCHANT1' });
    expect(unit.payment_instruction.disbursement_mode).toBe('INSTANT');
    expect(unit.payment_instruction.platform_fees).toEqual([
      { amount: { currency_code: 'USD', value: '1.00' }, payee: { merchant_id: 'PARTNER1' } },
    ]);

    // The partner headers are what make PayPal treat this as a third-party call.
    expect(init.headers['PayPal-Auth-Assertion']).toBe(paypalAuthAssertion('cid', 'MERCHANT1'));
    expect(init.headers['PayPal-Partner-Attribution-Id']).toBe('BN123');
    expect(init.headers['PayPal-Request-Id']).toBe('row-1');
  });

  it('createPaypalOrder omits payee and platform_fees in self-serve mode', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ access_token: 'tok' }))
      .mockResolvedValueOnce(
        ok({ id: 'ORDER-3', status: 'CREATED', links: [{ rel: 'approve', href: 'https://pp/a' }] })
      );

    await createPaypalOrder({
      ...creds,
      amount: 100,
      currency: 'usd',
      returnUrl: 'https://app/return',
      cancelUrl: 'https://app/cancel',
    });

    const [, init] = fetchMock.mock.calls[1];
    const unit = JSON.parse(init.body).purchase_units[0];
    // PayPal rejects either of these on a first-party order.
    expect(unit.payee).toBeUndefined();
    expect(unit.payment_instruction).toBeUndefined();
    expect(init.headers['PayPal-Auth-Assertion']).toBeUndefined();
  });

  it('createPaypalOrder refuses a platform fee without a payee', async () => {
    // Guards the misconfiguration that would otherwise ship a silent 0% take
    // rate: a fee with nobody to pay it to and nobody to pay it from.
    await expect(
      createPaypalOrder({
        ...creds,
        amount: 100,
        currency: 'usd',
        returnUrl: 'https://app/return',
        cancelUrl: 'https://app/cancel',
        platformFee: 1,
      })
    ).rejects.toThrow(/payeeMerchantId and platformFeePayeeMerchantId/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('capturePaypalOrder reads the seller receivable breakdown', async () => {
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'tok' })).mockResolvedValueOnce(
      ok({
        status: 'COMPLETED',
        payer: { email_address: 'buyer@example.com' },
        purchase_units: [
          {
            payee: { merchant_id: 'MERCHANT1' },
            payments: {
              captures: [
                {
                  id: 'CAP-9',
                  custom_id: 'row-1',
                  amount: { value: '100.00', currency_code: 'USD' },
                  seller_receivable_breakdown: {
                    paypal_fee: { value: '3.49' },
                    net_amount: { value: '96.51' },
                    platform_fees: [{ amount: { value: '1.00' } }],
                  },
                },
              ],
            },
          },
        ],
      })
    );

    const result = await capturePaypalOrder({ ...creds, orderId: 'ORDER-2' });
    expect(result.paypalFee).toBe('3.49');
    expect(result.netAmount).toBe('96.51');
    expect(result.platformFee).toBe('1.00');
    expect(result.payeeMerchantId).toBe('MERCHANT1');
    expect(result.customId).toBe('row-1');
  });

  it('refundPaypalCapture sends a partial amount when one is given', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ access_token: 'tok' }))
      .mockResolvedValueOnce(ok({ id: 'REF-1', status: 'COMPLETED', amount: { value: '5.00', currency_code: 'USD' } }));

    const refund = await refundPaypalCapture({
      ...creds,
      captureId: 'CAP-9',
      amount: 5,
      currency: 'usd',
    });

    expect(refund.refundId).toBe('REF-1');
    expect(fetchMock.mock.calls[1][0]).toContain('/v2/payments/captures/CAP-9/refund');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).amount).toEqual({
      value: '5.00',
      currency_code: 'USD',
    });
  });

  it('refundPaypalCapture omits the amount for a full refund', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ access_token: 'tok' }))
      .mockResolvedValueOnce(ok({ id: 'REF-2', status: 'COMPLETED' }));

    await refundPaypalCapture({ ...creds, captureId: 'CAP-9' });
    // PayPal reads "no amount" as "refund everything"; sending 0 would not.
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).amount).toBeUndefined();
  });

  it('verifyPaypalWebhookSignature is true only on SUCCESS', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ access_token: 'tok' }))
      .mockResolvedValueOnce(ok({ verification_status: 'SUCCESS' }));

    await expect(
      verifyPaypalWebhookSignature({
        ...creds,
        webhookId: 'WH1',
        transmissionId: 't',
        transmissionTime: 'now',
        transmissionSig: 'sig',
        certUrl: 'https://paypal/cert',
        authAlgo: 'SHA256withRSA',
        event: { id: 'EV-1' },
      })
    ).resolves.toBe(true);
  });

  it('verifyPaypalWebhookSignature is false on FAILURE', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ access_token: 'tok' }))
      .mockResolvedValueOnce(ok({ verification_status: 'FAILURE' }));

    await expect(
      verifyPaypalWebhookSignature({
        ...creds,
        webhookId: 'WH1',
        transmissionId: 't',
        transmissionTime: 'now',
        transmissionSig: 'sig',
        certUrl: 'https://paypal/cert',
        authAlgo: 'SHA256withRSA',
        event: { id: 'EV-1' },
      })
    ).resolves.toBe(false);
  });

  it('verifyPaypalWebhookSignature returns false rather than throwing when PayPal errors', async () => {
    // A thrown error here would be catchable by a caller that then treats the
    // event as verified. Failing closed is the whole point.
    fetchMock.mockResolvedValueOnce(fail(500, { message: 'boom' }));

    await expect(
      verifyPaypalWebhookSignature({
        ...creds,
        webhookId: 'WH1',
        transmissionId: 't',
        transmissionTime: 'now',
        transmissionSig: 'sig',
        certUrl: 'https://paypal/cert',
        authAlgo: 'SHA256withRSA',
        event: { id: 'EV-1' },
      })
    ).resolves.toBe(false);
  });

  it('getPaypalBalances maps PayPal balance rows', async () => {
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'tok' })).mockResolvedValueOnce(
      ok({
        balances: [
          {
            currency: 'USD',
            primary: true,
            available_balance: { value: '120.00' },
            withheld_balance: { value: '5.00' },
            total_balance: { value: '125.00' },
          },
        ],
      })
    );

    const balances = await getPaypalBalances({ ...creds, currency: 'usd' });
    expect(balances).toEqual([
      { currency: 'USD', available: '120.00', withheld: '5.00', total: '125.00', primary: true },
    ]);
    expect(fetchMock.mock.calls[1][0]).toContain('currency_code=USD');
  });

  it('surfaces PayPal validation details in the error message', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ access_token: 'tok' }))
      .mockResolvedValueOnce(
        fail(422, {
          message: 'The requested action could not be performed',
          details: [{ issue: 'PAYEE_ACCOUNT_RESTRICTED' }],
        })
      );

    // The top-level message alone tells an operator nothing; the issue is the
    // part that says what to fix.
    await expect(
      createPaypalOrder({
        ...creds,
        amount: 10,
        currency: 'usd',
        returnUrl: 'https://app/return',
        cancelUrl: 'https://app/cancel',
      })
    ).rejects.toThrow(/PAYEE_ACCOUNT_RESTRICTED/);
  });
});

describe('paypalAuthAssertion', () => {
  it('is an unsigned JWT naming the issuer and the merchant', () => {
    const assertion = paypalAuthAssertion('cid', 'MERCHANT1');
    const [header, payload, signature] = assertion.split('.');

    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'none' });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({
      iss: 'cid',
      payer_id: 'MERCHANT1',
    });
    // PayPal requires the trailing dot even though there is no signature.
    expect(signature).toBe('');
  });
});
