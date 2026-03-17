/**
 * WebAuthn configuration
 */

export function getRpId(request?: Request): string {
  if (process.env.WEBAUTHN_RP_ID) return process.env.WEBAUTHN_RP_ID;

  if (request) {
    const host = request.headers.get('host');
    if (host) {
      // Strip port
      return host.split(':')[0];
    }
  }

  return 'coinpayportal.com';
}

export function getRpName(): string {
  return 'CoinPay';
}

export function getOrigin(request?: Request): string {
  if (process.env.WEBAUTHN_ORIGIN) return process.env.WEBAUTHN_ORIGIN;

  if (request) {
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('host');
    if (host) return `${proto}://${host}`;
  }

  return 'https://coinpayportal.com';
}
