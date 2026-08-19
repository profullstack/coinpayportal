import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Append-only audit trail (AUD-01).
 *
 * The audit found that no audit-logging infrastructure existed anywhere in the
 * codebase, while `docs/SECURITY_KEYS.md` carried
 * `[x] Audit logging for key operations` and `docs/SECURITY.md` described a
 * four-point audit trail in the present tense. The documents were corrected
 * earlier in this branch; this is the thing they described.
 *
 * Two rules this module exists to hold:
 *
 *  1. **Logging never breaks the operation it records.** An audit write that can
 *     fail a payment turns an observability feature into an availability risk,
 *     and the first incident would get it removed. Failures are logged to the
 *     console and swallowed. The trade is deliberate: this is a forensic record,
 *     not a control.
 *
 *  2. **Nothing secret goes in `detail`.** A log read during an incident is read
 *     by more people, under more pressure, than the systems it describes. Known
 *     secret-bearing keys are stripped rather than trusted not to be passed.
 */

/** Who took the action. */
export type AuditActorType = 'merchant' | 'api_key' | 'platform' | 'system' | 'anonymous';

export interface AuditEvent {
  /** Dotted namespace, e.g. 'payment.confirmed', 'wallet.payout_changed'. */
  action: string;
  actorType: AuditActorType;
  actorId?: string | null;
  /** What it was done to: 'payment', 'escrow', 'wallet', 'did', 'subscription'. */
  subjectType: string;
  subjectId?: string | null;
  businessId?: string | null;
  merchantId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Field names that must never be persisted, whatever a caller passes.
 *
 * Checked by substring so `refundPrivateKey`, `api_key_hash` and
 * `stripe_secret` are all caught without enumerating every variant.
 */
const SECRET_FRAGMENTS = [
  'password',
  'secret',
  'privatekey',
  'private_key',
  'mnemonic',
  'seed',
  'apikey',
  'api_key',
  'token',
  'signature',
  'preimage',
  'encryption',
];

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  return SECRET_FRAGMENTS.some((f) => k.includes(f));
}

/** Strip secret-bearing fields, recursively, before anything is written. */
export function redactAuditDetail(detail: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 4) return {};

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (isSecretKey(key)) {
      out[key] = '[redacted]';
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redactAuditDetail(value as Record<string, unknown>, depth + 1);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Record one audit event. Never throws.
 *
 * Callers do not await this for correctness — the operation being recorded has
 * already happened or is about to — but awaiting is harmless and keeps ordering
 * predictable in tests.
 */
export async function recordAuditEvent(
  supabase: SupabaseClient,
  event: AuditEvent,
): Promise<void> {
  try {
    const { error } = await supabase.from('audit_log').insert({
      action: event.action,
      actor_type: event.actorType,
      actor_id: event.actorId ?? null,
      subject_type: event.subjectType,
      subject_id: event.subjectId ?? null,
      business_id: event.businessId ?? null,
      merchant_id: event.merchantId ?? null,
      detail: redactAuditDetail(event.detail ?? {}),
      ip: event.ip ?? null,
    });

    if (error) {
      // Loud, but not fatal. An audit table that silently stops accepting rows
      // is how `webhook_logs` sat empty for its whole existence.
      console.error(`[Audit] Could not record ${event.action}:`, error.message);
    }
  } catch (err) {
    console.error(`[Audit] Could not record ${event.action}:`, err);
  }
}
