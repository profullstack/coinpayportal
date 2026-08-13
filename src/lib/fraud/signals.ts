/**
 * Signal extraction and normalization for fraud screening.
 *
 * Everything here is pure — no DB, no network — so the rules that depend on it
 * stay testable.
 */

/** Providers that ignore dots and treat +suffix as the same inbox. */
const DOT_INSENSITIVE_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
]);

const DOMAIN_ALIASES: Record<string, string> = {
  'googlemail.com': 'gmail.com',
};

/**
 * Disposable and throwaway mailbox providers. Not exhaustive by design — this
 * is a signal that adds score, never one that blocks on its own.
 */
export const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '10minutemail.com',
  'guerrillamail.com',
  'mailinator.com',
  'tempmail.com',
  'temp-mail.org',
  'throwawaymail.com',
  'yopmail.com',
  'trashmail.com',
  'getnada.com',
  'dispostable.com',
  'maildrop.cc',
  'sharklasers.com',
  'grr.la',
  'spam4.me',
  'fakeinbox.com',
  'mohmal.com',
  'emailondeck.com',
  'tempr.email',
  'moakt.com',
  'inboxkitten.com',
]);

export function emailDomain(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/**
 * Collapse the aliases one person uses to look like several: case, dots and
 * +suffix on providers that ignore them. `j.doe+vpn@gmail.com` and
 * `JDoe@googlemail.com` both normalize to `jdoe@gmail.com`.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;

  let local = trimmed.slice(0, at);
  const rawDomain = trimmed.slice(at + 1);
  const domain = DOMAIN_ALIASES[rawDomain] ?? rawDomain;

  // A leading '+' leaves nothing to identify, and falls through to the guard below.
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (DOT_INSENSITIVE_DOMAINS.has(rawDomain) || DOT_INSENSITIVE_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
  }

  if (!local) return null;
  return `${local}@${domain}`;
}

export function isDisposableEmail(email: string | null | undefined): boolean {
  const domain = emailDomain(email);
  return domain ? DISPOSABLE_EMAIL_DOMAINS.has(domain) : false;
}

/**
 * Coarse network grouping: /24 for IPv4, /48 for IPv6. Card testers rotate the
 * last octet, so the prefix is the more useful velocity key.
 */
export function ipPrefix(ip: string | null | undefined): string | null {
  if (typeof ip !== 'string') return null;
  const trimmed = ip.trim();
  if (!trimmed || trimmed === 'unknown') return null;

  if (trimmed.includes(':')) {
    const groups = trimmed.split(':').filter(Boolean);
    if (groups.length < 3) return null;
    return `${groups.slice(0, 3).join(':')}::/48`;
  }

  const octets = trimmed.split('.');
  if (octets.length !== 4) return null;
  return `${octets.slice(0, 3).join('.')}.0/24`;
}

export interface CheckoutSignals {
  businessId: string;
  email: string | null;
  emailDomain: string | null;
  emailNormalized: string | null;
  ip: string | null;
  ipPrefix: string | null;
  amount: number | null;
  currency: string | null;
  description: string | null;
}

export function extractCheckoutSignals(input: {
  businessId: string;
  email?: string | null;
  ip?: string | null;
  amount?: number | null;
  currency?: string | null;
  description?: string | null;
}): CheckoutSignals {
  const ip = typeof input.ip === 'string' && input.ip !== 'unknown' ? input.ip.trim() : null;
  return {
    businessId: input.businessId,
    email: typeof input.email === 'string' && input.email.trim() ? input.email.trim().toLowerCase() : null,
    emailDomain: emailDomain(input.email),
    emailNormalized: normalizeEmail(input.email),
    ip: ip || null,
    ipPrefix: ipPrefix(ip),
    amount: typeof input.amount === 'number' && Number.isFinite(input.amount) ? input.amount : null,
    currency: typeof input.currency === 'string' ? input.currency.toLowerCase() : null,
    description: typeof input.description === 'string' && input.description.trim()
      ? input.description.trim()
      : null,
  };
}
