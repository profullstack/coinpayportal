/**
 * Web Bot Auth — request signature verification
 *
 * Proves that a request was made by whoever controls the key published at the
 * `Signature-Agent` directory. That is an identity claim, not an authorisation
 * one: what a verified agent is then allowed to do, and at what price, is
 * decided by the caller.
 */

import { verify as cryptoVerify } from 'crypto';
import {
  parseSignatureInput,
  parseSignatureHeader,
  type SignatureInputEntry,
} from './structured-fields';
import {
  buildSignatureBase,
  type SignableRequest,
} from './signature-base';
import {
  fetchDirectory,
  findKeyByThumbprint,
  toPublicKey,
  type Ed25519Jwk,
} from './directory';

/** The tag that marks a signature as Web Bot Auth rather than some other use. */
export const WEB_BOT_AUTH_TAG = 'web-bot-auth';

/** Longest signature validity we accept, regardless of what `expires` says. */
export const MAX_SIGNATURE_LIFETIME_SECONDS = 3600;

/** Tolerance for clock skew between signer and verifier. */
export const CLOCK_SKEW_SECONDS = 300;

export type VerifyFailureReason =
  | 'missing_headers'
  | 'no_web_bot_auth_signature'
  | 'malformed'
  | 'missing_keyid'
  | 'unsupported_algorithm'
  | 'expired'
  | 'not_yet_valid'
  | 'lifetime_too_long'
  | 'unknown_key'
  | 'directory_error'
  | 'bad_signature';

export interface VerifiedAgent {
  verified: true;
  /** RFC 7638 thumbprint of the signing key. */
  keyid: string;
  /** Directory URL the key was published at, unquoted. */
  signatureAgent: string;
  /** Origin of the directory — the identity actually proven. */
  agentOrigin: string;
  /** Covered components, useful for deciding how much the signature is worth. */
  coveredComponents: string[];
  expiresAt: number | null;
}

export interface UnverifiedAgent {
  verified: false;
  reason: VerifyFailureReason;
  detail?: string;
}

export type VerificationResult = VerifiedAgent | UnverifiedAgent;

/** Pick the `Signature-Input` member that is tagged as Web Bot Auth. */
function selectWebBotAuthEntry(
  entries: Map<string, SignatureInputEntry>
): { label: string; entry: SignatureInputEntry } | null {
  for (const [label, entry] of entries) {
    if (entry.params.tag === WEB_BOT_AUTH_TAG) return { label, entry };
  }
  return null;
}

function headerOf(
  headers: SignableRequest['headers'],
  name: string
): string | undefined {
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Record<string, string | string[] | undefined>;
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === name) {
      const value = record[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

/**
 * Verify a Web Bot Auth signature on a request.
 *
 * Returns a result rather than throwing: an unsigned or badly signed request
 * is an ordinary event on a public endpoint, not an exceptional one.
 *
 * @param request - method, absolute URL, and headers as received
 * @param options.now - override the clock, for tests
 * @param options.resolveDirectory - override key lookup, for tests
 */
export async function verifyWebBotAuth(
  request: SignableRequest,
  options: {
    now?: number;
    resolveDirectory?: (signatureAgent: string) => Promise<Ed25519Jwk[]>;
  } = {}
): Promise<VerificationResult> {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const resolveDirectory = options.resolveDirectory ?? fetchDirectory;

  const signatureInput = headerOf(request.headers, 'signature-input');
  const signature = headerOf(request.headers, 'signature');
  const signatureAgent = headerOf(request.headers, 'signature-agent');

  if (!signatureInput || !signature) {
    return { verified: false, reason: 'missing_headers' };
  }
  if (!signatureAgent) {
    // Without a directory pointer there is nothing to check the key against.
    return { verified: false, reason: 'missing_headers', detail: 'no Signature-Agent' };
  }

  const entries = parseSignatureInput(signatureInput);
  const selected = selectWebBotAuthEntry(entries);
  if (!selected) {
    return { verified: false, reason: 'no_web_bot_auth_signature' };
  }

  const { label, entry } = selected;
  const { params } = entry;

  const keyid = typeof params.keyid === 'string' ? params.keyid : null;
  if (!keyid) return { verified: false, reason: 'missing_keyid' };

  if (params.alg !== undefined && params.alg !== 'ed25519') {
    return {
      verified: false,
      reason: 'unsupported_algorithm',
      detail: String(params.alg),
    };
  }

  const created = typeof params.created === 'number' ? params.created : null;
  const expires = typeof params.expires === 'number' ? params.expires : null;

  if (created !== null && created > now + CLOCK_SKEW_SECONDS) {
    return { verified: false, reason: 'not_yet_valid' };
  }
  if (expires !== null && expires < now - CLOCK_SKEW_SECONDS) {
    return { verified: false, reason: 'expired' };
  }
  // An unbounded or very long-lived signature is a bearer token in disguise:
  // anyone who observes it can replay it for as long as it stays valid.
  if (created !== null && expires !== null) {
    if (expires - created > MAX_SIGNATURE_LIFETIME_SECONDS) {
      return { verified: false, reason: 'lifetime_too_long' };
    }
  }

  const signatures = parseSignatureHeader(signature);
  const rawSignature = signatures.get(label);
  if (!rawSignature || rawSignature.length === 0) {
    return { verified: false, reason: 'malformed', detail: `no signature for ${label}` };
  }

  let base: string;
  try {
    base = buildSignatureBase(entry, request);
  } catch (err) {
    return {
      verified: false,
      reason: 'malformed',
      detail: err instanceof Error ? err.message : 'bad signature base',
    };
  }

  let keys: Ed25519Jwk[];
  try {
    keys = await resolveDirectory(signatureAgent);
  } catch (err) {
    return {
      verified: false,
      reason: 'directory_error',
      detail: err instanceof Error ? err.message : 'directory fetch failed',
    };
  }

  const jwk = findKeyByThumbprint(keys, keyid);
  if (!jwk) return { verified: false, reason: 'unknown_key', detail: keyid };

  let ok = false;
  try {
    // Ed25519 takes no separate digest algorithm, hence the null.
    ok = cryptoVerify(null, Buffer.from(base, 'utf-8'), toPublicKey(jwk), rawSignature);
  } catch {
    ok = false;
  }

  if (!ok) return { verified: false, reason: 'bad_signature' };

  const unquotedAgent = signatureAgent.trim().replace(/^"|"$/g, '');

  return {
    verified: true,
    keyid,
    signatureAgent: unquotedAgent,
    agentOrigin: new URL(unquotedAgent).origin,
    coveredComponents: entry.components,
    expiresAt: expires,
  };
}
