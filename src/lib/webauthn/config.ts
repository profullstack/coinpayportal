/**
 * WebAuthn configuration.
 *
 * Two findings live here, and they share a cause: the RP ID and the origin were
 * resolved independently, each from its own environment variable with its own
 * fallback.
 *
 * `G-1.2-08` — setting one variable and not the other left the pair
 * *decoupled*: `expectedRPID` pinned by config while `expectedOrigin` came from
 * the request, or the reverse. WebAuthn's security rests on those two agreeing;
 * verifying a credential against an RP ID from one source and an origin from
 * another is not a check, it is two half-checks.
 *
 * `NEW-05` — both fell back to the `Host` header. A client chooses that header,
 * and whether a proxy normalises it is a deployment detail rather than a
 * guarantee. An attacker able to reach the app with a Host of their choosing
 * could have credentials registered and verified against a domain they control.
 *
 * They are now derived together from a single source, and the header fallback
 * only accepts hosts we recognise.
 */

const DEFAULT_RP_ID = 'coinpayportal.com';

/**
 * Hosts the `Host` header may name when neither variable is configured.
 *
 * Anything else falls back to the default rather than being trusted. This is a
 * development convenience, not an authorization surface — a deployment should
 * set `WEBAUTHN_RP_ID` explicitly.
 */
const ALLOWED_HOSTS = new Set([
  'coinpayportal.com',
  'www.coinpayportal.com',
  'localhost',
  '127.0.0.1',
]);

/** Strip the port and lowercase, so 'Example.com:3000' and 'example.com' agree. */
function normalizeHost(host: string): string {
  return host.split(':')[0].trim().toLowerCase();
}

/**
 * Resolve the RP ID and origin as one pair, so they can never disagree.
 *
 * Precedence:
 *   1. `WEBAUTHN_RP_ID` — the origin is derived from it unless
 *      `WEBAUTHN_ORIGIN` is also set, in which case the two must be consistent.
 *   2. `WEBAUTHN_ORIGIN` alone — the RP ID is its hostname.
 *   3. The request's `Host`, but only if it is a host we recognise.
 *   4. The production default.
 */
function resolvePair(request?: Request): { rpId: string; origin: string } {
  const envRpId = process.env.WEBAUTHN_RP_ID?.trim();
  const envOrigin = process.env.WEBAUTHN_ORIGIN?.trim();

  if (envRpId && envOrigin) {
    const originHost = safeHostname(envOrigin);
    // The origin must belong to the RP ID: equal, or a subdomain of it. This is
    // the same relation WebAuthn itself requires, and checking it here turns a
    // misconfiguration into a startup-visible error rather than a silent
    // weakening of every ceremony.
    if (originHost && originHost !== envRpId && !originHost.endsWith(`.${envRpId}`)) {
      throw new Error(
        `WEBAUTHN_ORIGIN (${envOrigin}) is not within WEBAUTHN_RP_ID (${envRpId}). ` +
        'A credential verified against a mismatched pair is not verified at all.'
      );
    }
    return { rpId: envRpId, origin: envOrigin };
  }

  if (envRpId) {
    return { rpId: envRpId, origin: `https://${envRpId}` };
  }

  if (envOrigin) {
    const host = safeHostname(envOrigin);
    if (host) return { rpId: host, origin: envOrigin };
  }

  const header = request?.headers.get('host');
  if (header) {
    const host = normalizeHost(header);
    if (ALLOWED_HOSTS.has(host)) {
      const proto = request?.headers.get('x-forwarded-proto') || (host === 'localhost' || host === '127.0.0.1' ? 'http' : 'https');
      const port = header.includes(':') ? `:${header.split(':')[1]}` : '';
      return { rpId: host, origin: `${proto}://${host}${port}` };
    }
  }

  return { rpId: DEFAULT_RP_ID, origin: `https://${DEFAULT_RP_ID}` };
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function getRpId(request?: Request): string {
  return resolvePair(request).rpId;
}

export function getRpName(): string {
  return 'CoinPay';
}

export function getOrigin(request?: Request): string {
  return resolvePair(request).origin;
}
