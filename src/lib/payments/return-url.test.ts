import { describe, it, expect } from 'vitest';
import { resolveReturnUrl, returnUrlMetadata, safeReturnUrl } from './return-url';

describe('returnUrlMetadata', () => {
  it('keeps a Stripe-style success_url as the redirect the pay page follows', () => {
    // readm3 and the widget send success_url; the crypto rail used to drop it
    // and the buyer sat on "Payment Complete!" forever.
    const result = returnUrlMetadata({
      success_url: 'https://readm3.com/viewer?topup=abc',
      cancel_url: 'https://readm3.com/viewer',
    });
    expect(result).toEqual({
      ok: true,
      metadata: { redirect_url: 'https://readm3.com/viewer?topup=abc', cancel_url: 'https://readm3.com/viewer' },
    });
  });

  it('prefers a valid legacy redirect_url over success_url', () => {
    const result = returnUrlMetadata({ redirect_url: 'https://a.example/old', success_url: 'https://a.example/new' });
    expect(result).toEqual({ ok: true, metadata: { redirect_url: 'https://a.example/old' } });
  });

  it('drops a bad legacy redirect_url instead of refusing the payment', () => {
    expect(returnUrlMetadata({ redirect_url: '/thanks' })).toEqual({ ok: true, metadata: {} });
    expect(returnUrlMetadata({ redirect_url: 'javascript:alert(1)', success_url: 'https://a.example/ok' })).toEqual({
      ok: true,
      metadata: { redirect_url: 'https://a.example/ok' },
    });
  });

  it('refuses an unsafe success_url or cancel_url', () => {
    expect(returnUrlMetadata({ success_url: 'javascript:alert(1)' })).toMatchObject({ ok: false, code: 'INVALID_SUCCESS_URL' });
    expect(returnUrlMetadata({ cancel_url: 'data:text/html,hi' })).toMatchObject({ ok: false, code: 'INVALID_CANCEL_URL' });
  });

  it('returns nothing when no URLs are sent', () => {
    expect(returnUrlMetadata({ success_url: '', cancel_url: null })).toEqual({ ok: true, metadata: {} });
  });
});

describe('resolveReturnUrl', () => {
  it('fills {PAYMENT_ID} and {CHECKOUT_SESSION_ID}, raw or as stored after URL parsing', () => {
    expect(resolveReturnUrl('https://a.example/done?id={PAYMENT_ID}', 'p_1')).toBe('https://a.example/done?id=p_1');
    expect(resolveReturnUrl('https://a.example/done?session_id={CHECKOUT_SESSION_ID}', 'p_1')).toBe(
      'https://a.example/done?session_id=p_1',
    );
    const stored = safeReturnUrl('https://a.example/orders/{PAYMENT_ID}/done')!;
    expect(stored).toContain('%7BPAYMENT_ID%7D');
    expect(resolveReturnUrl(stored, 'p_1')).toBe('https://a.example/orders/p_1/done');
  });

  it('leaves a URL without placeholders alone', () => {
    expect(resolveReturnUrl('https://a.example/viewer?topup=abc', 'p_1')).toBe('https://a.example/viewer?topup=abc');
  });
});
