/**
 * Where a checkout sends the customer when it is done, Stripe-style.
 *
 * Merchants pass `success_url` (and `cancel_url`) exactly as they would to
 * Stripe Checkout. The crypto rail used to read only `redirect_url`, so every
 * integration written against the Stripe names (readm3, the widget, the
 * cross-network API) left the buyer stranded on "Payment Complete!". Both
 * names are accepted now; a valid `redirect_url` wins when both are sent,
 * since it is the older CoinPay field.
 *
 * No imports: the pay page (a client component) uses resolveReturnUrl too.
 */

/**
 * {PAYMENT_ID} or Stripe's {CHECKOUT_SESSION_ID}, raw or percent-encoded (URL
 * parsing encodes braces in a path, so the stored form may be %7BPAYMENT_ID%7D).
 */
const PAYMENT_ID_PLACEHOLDER = /(?:\{|%7B)(?:PAYMENT_ID|CHECKOUT_SESSION_ID)(?:\}|%7D)/gi;

/**
 * A merchant-supplied return link, if it is safe to put in an href: an
 * absolute http(s) URL of sane length. Anything else (javascript:, data:,
 * relative paths, garbage) is dropped rather than rendered.
 */
export function safeReturnUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Fill in the payment id wherever the merchant asked for it. */
export function resolveReturnUrl(url: string, paymentId: string): string {
  return url.replace(PAYMENT_ID_PLACEHOLDER, encodeURIComponent(paymentId));
}

export type ReturnUrlMetadata =
  | { ok: true; metadata: { redirect_url?: string; cancel_url?: string } }
  | { ok: false; error: string; code: 'INVALID_SUCCESS_URL' | 'INVALID_CANCEL_URL' };

const blank = (value: unknown) => value === undefined || value === null || value === '';

/**
 * Validate the request's return URLs and turn them into the metadata keys the
 * pay page reads: redirect_url (after a completed payment) and cancel_url
 * (back to the shop from an expired or abandoned checkout).
 */
export function returnUrlMetadata(input: {
  redirect_url?: unknown;
  success_url?: unknown;
  cancel_url?: unknown;
}): ReturnUrlMetadata {
  const metadata: { redirect_url?: string; cancel_url?: string } = {};

  // A bad legacy redirect_url was always accepted and then dropped on the
  // public read; keep that rather than start refusing live integrations.
  const legacy = safeReturnUrl(input.redirect_url);
  if (legacy) {
    metadata.redirect_url = legacy;
  } else if (!blank(input.success_url)) {
    const safe = safeReturnUrl(input.success_url);
    if (!safe) {
      return { ok: false, error: 'success_url must be an absolute http(s) URL', code: 'INVALID_SUCCESS_URL' };
    }
    metadata.redirect_url = safe;
  }

  if (!blank(input.cancel_url)) {
    const safe = safeReturnUrl(input.cancel_url);
    if (!safe) {
      return { ok: false, error: 'cancel_url must be an absolute http(s) URL', code: 'INVALID_CANCEL_URL' };
    }
    metadata.cancel_url = safe;
  }

  return { ok: true, metadata };
}
