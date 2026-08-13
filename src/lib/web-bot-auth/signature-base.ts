/**
 * Web Bot Auth — RFC 9421 signature base construction
 *
 * The signature base is the exact byte string the signer signed. Every line is
 * `"<component>": <value>`, and the final line is `"@signature-params"` set to
 * the signer's own parameter text. Reproduce it wrong by a single space and
 * verification fails in a way that looks like a bad key.
 */

import type { SignatureInputEntry } from './structured-fields';

/** The request fields needed to rebuild a signature base. */
export interface SignableRequest {
  method: string;
  /** Absolute request URL, e.g. https://api.example.com/premium?a=1 */
  url: string;
  /** Header lookup. Names are matched case-insensitively by the caller. */
  headers: Headers | Record<string, string | string[] | undefined>;
}

/** Thrown when a covered component cannot be resolved from the request. */
export class UnresolvableComponentError extends Error {
  constructor(public readonly component: string) {
    super(`Cannot resolve covered component: ${component}`);
    this.name = 'UnresolvableComponentError';
  }
}

function getHeader(
  headers: SignableRequest['headers'],
  name: string
): string | undefined {
  const lower = name.toLowerCase();

  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(lower) ?? undefined;
  }

  const record = headers as Record<string, string | string[] | undefined>;
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() !== lower) continue;
    const value = record[key];
    // Repeated fields are combined with ", " per RFC 9421 §2.1.
    return Array.isArray(value) ? value.join(', ') : value;
  }
  return undefined;
}

/**
 * Resolve a single covered component to its signature-base value.
 */
function resolveComponent(component: string, request: SignableRequest): string {
  if (!component.startsWith('@')) {
    const value = getHeader(request.headers, component);
    if (value === undefined) throw new UnresolvableComponentError(component);
    // Field values are trimmed of leading/trailing whitespace, not internally.
    return value.trim();
  }

  const url = new URL(request.url);

  switch (component) {
    case '@method':
      return request.method.toUpperCase();
    case '@authority':
      // Host plus non-default port, lowercased. This is the component Web Bot
      // Auth relies on to stop a signature being replayed at another origin.
      return url.host.toLowerCase();
    case '@scheme':
      return url.protocol.replace(/:$/, '').toLowerCase();
    case '@target-uri':
      return url.toString();
    case '@path':
      return url.pathname;
    case '@query':
      // RFC 9421: the query including "?", or "?" when absent.
      return url.search || '?';
    case '@request-target':
      return `${url.pathname}${url.search}`;
    default:
      throw new UnresolvableComponentError(component);
  }
}

/**
 * Build the signature base for one `Signature-Input` entry.
 *
 * @param entry - the parsed entry, whose `raw` text supplies @signature-params
 * @param request - the request the signature is claimed to cover
 */
export function buildSignatureBase(
  entry: SignatureInputEntry,
  request: SignableRequest
): string {
  const lines: string[] = [];

  for (const component of entry.components) {
    // Signing a component whose value contains non-ASCII cannot round-trip
    // through the signature base; reject rather than sign over a mangled value.
    const value = resolveComponent(component, request);
    if (/[^\x20-\x7e]/.test(value)) {
      throw new UnresolvableComponentError(component);
    }
    lines.push(`"${component}": ${value}`);
  }

  // The signer's own parameter text, verbatim — never re-serialized.
  lines.push(`"@signature-params": ${entry.raw}`);

  return lines.join('\n');
}
