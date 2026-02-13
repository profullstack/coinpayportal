/**
 * Reputation Protocol — Crypto utilities
 * DID resolution, signature verification, credential signing
 */

import { createHmac, createHash, randomUUID } from 'crypto';

const ISSUER_DID = 'did:web:coinpayportal.com';
const SIGNING_SECRET = process.env.REPUTATION_SIGNING_SECRET || 'cpr-dev-secret';

/**
 * Create an HMAC signature for data
 */
export function sign(data: string): string {
  return createHmac('sha256', SIGNING_SECRET).update(data).digest('hex');
}

/**
 * Verify an HMAC signature
 */
export function verifySignature(data: string, signature: string): boolean {
  const expected = sign(data);
  return expected === signature;
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
