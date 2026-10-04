/**
 * Strip platform-reserved keys from caller-supplied Stripe metadata.
 *
 * CP-001. Every Stripe session is created with a metadata object built as
 * `{ ...callerMetadata, business_id, merchant_id, ... }`. The spread order means
 * the platform's own keys win for the fields listed explicitly — but only for
 * those. Anything the platform sets *elsewhere* and reads back later was not
 * protected, and `coinpay_payment_id` is exactly that: the Stripe webhook uses
 * it to decide which payment row to mark confirmed.
 *
 * So a caller could attach `coinpay_payment_id` pointing at another merchant's
 * pending payment, complete their own one-cent checkout, and have the webhook
 * confirm the victim's payment as paid.
 *
 * Removing reserved keys up front is stronger than ordering the spread
 * correctly, because it does not depend on every future call site remembering
 * to list every reserved field. A caller that sends one gets it dropped, not
 * silently overridden — and the drop is logged, since it is either a bug in an
 * integration or an attempt.
 */

/**
 * Keys the platform owns. Anything beginning `coinpay_` is reserved wholesale so
 * a new internal field cannot be forgotten here.
 */
const RESERVED_EXACT = new Set([
  'business_id',
  'merchant_id',
  'invoice_number',
  'platform_fee_amount',
  'platform_fee_percent',
  'stripe_account_id',
  'scope',
  'idempotency_key',
]);

const RESERVED_PREFIX = 'coinpay_';

export function isReservedStripeMetadataKey(key: string): boolean {
  return RESERVED_EXACT.has(key) || key.startsWith(RESERVED_PREFIX);
}

export function sanitizeStripeMetadata(
  metadata: unknown,
  context = 'stripe',
): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  const out: Record<string, unknown> = {};
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (isReservedStripeMetadataKey(key)) {
      dropped.push(key);
      continue;
    }
    out[key] = value;
  }

  if (dropped.length > 0) {
    console.warn(
      `[${context}] Dropped platform-reserved metadata keys from caller input: ${dropped.join(', ')}`
    );
  }

  return out;
}
