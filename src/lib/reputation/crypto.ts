/**
 * Reputation Protocol — Crypto utilities
 * DID resolution, signature verification, credential signing
 */

import crypto from 'crypto';

export interface DIDDocument {
  id: string;
  verificationMethod?: Array<{
    id: string;
    type: string;
    publicKeyJwk?: JsonWebKey;
    publicKeyMultibase?: string;
  }>;
}

/**
 * Resolve a DID to its document (simplified — supports did:web and did:key stubs)
 */
export async function resolveDID(did: string): Promise<DIDDocument | null> {
  if (!did || typeof did !== 'string') return null;

  if (did.startsWith('did:web:')) {
    const domain = did.replace('did:web:', '').replace(/:/g, '/');
    try {
      const res = await fetch(`https://${domain}/.well-known/did.json`);
      if (res.ok) return await res.json();
    } catch {
      // Fall through to stub
    }
    return { id: did };
  }

  if (did.startsWith('did:key:')) {
    return { id: did };
  }

  return { id: did };
}

/**
 * Verify a signature against data and a DID
 * For Phase 1, we use HMAC-SHA256 with the DID as context.
 * Production would resolve the DID's public key and verify properly.
 */
export function verifySignature(
  data: string,
  signature: string,
  did: string
): boolean {
  if (!data || !signature || !did) return false;
  // Phase 1: signature is hex(sha256(data + did))
  const expected = crypto
    .createHash('sha256')
    .update(data + did)
    .digest('hex');
  return signature === expected;
}

/**
 * Sign data with a DID (Phase 1 simplified)
 */
export function signData(data: string, did: string): string {
  return crypto
    .createHash('sha256')
    .update(data + did)
    .digest('hex');
}

/**
 * Sign a credential for issuance
 */
export function signCredential(credential: Record<string, unknown>): string {
  const issuerDid = 'did:web:coinpayportal.com';
  const payload = JSON.stringify(credential);
  return signData(payload, issuerDid);
}

/**
 * Verify a credential signature
 */
export function verifyCredentialSignature(
  credential: Record<string, unknown>,
  signature: string
): boolean {
  const issuerDid = (credential.issuer_did as string) || 'did:web:coinpayportal.com';
  const { signature: _sig, ...rest } = credential;
  const payload = JSON.stringify(rest);
  return verifySignature(payload, signature, issuerDid);
}

/**
 * Hash an artifact (file, result, etc.)
 */
export function hashArtifact(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
