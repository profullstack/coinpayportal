import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * TransFi signs every webhook with HMAC-SHA256 over the request body, keyed
 * with a dedicated secret their support team issues per account, and sends the
 * result hex-encoded in `X-Transfi-Hmac-Hash`.
 *
 * Two things about their published sample are worth pinning here, because both
 * are easy to reproduce as bugs:
 *
 *  1. Their Node sample hashes the raw body (`req.body.toString('utf8')`) while
 *     their Python sample hashes `json.dumps(body)`. Those are different bytes
 *     the moment TransFi's serialiser disagrees with ours about spacing or key
 *     order — and it will, because JSON object key order is not guaranteed to
 *     survive a parse/stringify round trip. We hash the raw body exactly as it
 *     arrived and never re-serialise, which is the only stable reading.
 *  2. Their sample reads `req.headers['X-Transfi-Hmac-Hash']`, which is
 *     `undefined` on any runtime that lower-cases header names — Node and Next
 *     included. Read it lower-cased.
 */
export const TRANSFI_SIGNATURE_HEADER = 'x-transfi-hmac-hash';

/** Hex HMAC-SHA256 of `body`, keyed with `secret`. Exported for the tests. */
export function transfiSignature(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of a received signature against the expected one.
 *
 * `timingSafeEqual` throws when the buffers differ in length, which for a hex
 * digest is itself a mismatch, so length is checked first rather than letting
 * the throw escape into the route.
 */
export function verifyTransfiSignature(
  rawBody: string,
  receivedSignature: string | null | undefined,
  secret: string
): boolean {
  if (!receivedSignature || !secret) return false;

  const expected = transfiSignature(rawBody, secret);
  const received = receivedSignature.trim().toLowerCase();

  if (received.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(received, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

/** The webhook secret, or '' when the rail has not been configured. */
export function getTransfiWebhookSecret(): string {
  return process.env.TRANSFI_WEBHOOK_SECRET || '';
}

export interface TransfiEventIdentity {
  /** TransFi's own id for the delivery, used to make retries idempotent. */
  eventId: string;
  eventType: string;
  orderId: string | null;
  status: string | null;
}

/**
 * TransFi does not document one canonical envelope, and the payout and ramp
 * products disagree about where the id lives. Rather than guess a single shape,
 * take the first of several documented spellings and let an unrecognised event
 * fail loudly at the route instead of being silently recorded under an empty id
 * (which would collapse every such delivery onto one unique row).
 */
export function identifyTransfiEvent(event: unknown): TransfiEventIdentity {
  const e = (event ?? {}) as Record<string, any>;
  const data = (e.data ?? e.payload ?? {}) as Record<string, any>;

  const first = (...values: unknown[]): string | null => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  };

  return {
    eventId: first(e.eventId, e.event_id, e.id, data.eventId, data.id) ?? '',
    eventType: first(e.eventType, e.event_type, e.type, e.event, data.eventType) ?? '',
    orderId: first(e.orderId, e.order_id, data.orderId, data.order_id, data.payoutId),
    status: first(e.status, data.status, data.orderStatus),
  };
}
