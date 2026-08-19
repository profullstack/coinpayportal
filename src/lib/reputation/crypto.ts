/**
 * Reputation Protocol — Crypto utilities
 * DID resolution, signature verification, credential signing
 */

import { createHmac, createHash, randomUUID } from 'crypto';
import { secretsMatch } from '@/lib/auth/secret-compare';

const ISSUER_DID = 'did:web:coinpayportal.com';

/**
 * The HMAC key every reputation credential is signed with.
 *
 * This used to be `process.env.REPUTATION_SIGNING_SECRET || 'cpr-dev-secret'`,
 * evaluated once at module load. `cpr-dev-secret` is a constant in a public
 * repository, so if the environment variable were ever unset in production —
 * a fresh deploy, a renamed variable, a missing Doppler mapping — every
 * reputation credential would be signed with a key the whole internet knows,
 * and anyone could forge them. Nothing would look wrong: signatures would
 * verify perfectly.
 *
 * Resolved lazily and with no fallback, so a missing secret is a loud failure
 * at the moment of signing rather than a silent downgrade at import time.
 */
function signingSecret(): string {
  const secret = process.env.REPUTATION_SIGNING_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error(
      'REPUTATION_SIGNING_SECRET is not configured — refusing to sign or verify ' +
      'reputation credentials. Set it before starting the service.'
    );
  }
  return secret;
}

/**
 * Create an HMAC signature for data
 */
export function sign(data: string): string {
  return createHmac('sha256', signingSecret()).update(data).digest('hex');
}

/**
 * Verify an HMAC signature
 */
export function verifySignature(data: string, signature: string): boolean {
  // Constant-time. `===` on hex strings short-circuits at the first differing
  // byte, which leaks how much of a forged signature was correct — exactly the
  // feedback an attacker needs to construct one byte at a time.
  return secretsMatch(sign(data), signature);
}

/**
 * Hash an artifact (sha256)
 */
export function hashArtifact(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Sign a credential — produces a signature over the credential data
 */
export function signCredential(credential: {
  agent_did: string;
  credential_type: string;
  category?: string | null;
  data: Record<string, unknown>;
  window_start: string;
  window_end: string;
  issued_at: string;
}): string {
  const payload = JSON.stringify({
    agent_did: credential.agent_did,
    credential_type: credential.credential_type,
    category: credential.category,
    data: credential.data,
    window_start: credential.window_start,
    window_end: credential.window_end,
    issued_at: credential.issued_at,
    issuer_did: ISSUER_DID,
  });
  return sign(payload);
}

/**
 * Verify a credential signature
 */
export function verifyCredentialSignature(credential: {
  agent_did: string;
  credential_type: string;
  category?: string | null;
  data: Record<string, unknown>;
  window_start: string;
  window_end: string;
  issued_at: string;
  signature: string;
}): boolean {
  const payload = JSON.stringify({
    agent_did: credential.agent_did,
    credential_type: credential.credential_type,
    category: credential.category,
    data: credential.data,
    window_start: credential.window_start,
    window_end: credential.window_end,
    issued_at: credential.issued_at,
    issuer_did: ISSUER_DID,
  });
  return verifySignature(payload, credential.signature);
}

/**
 * Validate a DID format (basic validation)
 */
export function isValidDid(did: string): boolean {
  return /^did:[a-z]+:.+$/.test(did);
}

/**
 * Validate receipt signatures — at minimum escrow_sig must be present
 */
export function validateReceiptSignatures(signatures: Record<string, string> | null | undefined): {
  valid: boolean;
  reason?: string;
} {
  if (!signatures || typeof signatures !== 'object') {
    return { valid: false, reason: 'Missing signatures object' };
  }
  if (!signatures.escrow_sig) {
    return { valid: false, reason: 'Missing required escrow_sig' };
  }
  return { valid: true };
}
