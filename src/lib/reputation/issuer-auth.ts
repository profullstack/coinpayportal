/**
 * Reputation issuer API-key authentication.
 *
 * Every issuer-gated endpoint (receipt submission, platform actions, DID
 * override, merchant-wallet) resolves a `Bearer cprt_...` key to an ACTIVE
 * `reputation_issuers` row through here.
 *
 * Keys are matched on `api_key_hash` (HMAC-SHA256, see hashApiKey). The raw
 * `api_key` column is legacy: rows still carrying it are matched once by the
 * raw value and upgraded in place (hash written, raw value cleared), so the
 * column drains without forcing integrators to rotate.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { hashApiKey } from '@/lib/auth/scoped-keys';

export interface AuthenticatedIssuer {
  id: string;
  did: string;
  name: string;
}

/** Extract the bearer token from an Authorization header value. */
export function bearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

/**
 * Resolve an Authorization header to an active issuer, or null.
 */
export async function authenticateIssuer(
  supabase: SupabaseClient,
  authHeader: string | null | undefined,
): Promise<AuthenticatedIssuer | null> {
  const apiKey = bearerToken(authHeader);
  if (!apiKey) return null;

  const keyHash = hashApiKey(apiKey);

  const { data: byHash } = await supabase
    .from('reputation_issuers')
    .select('id, did, name')
    .eq('api_key_hash', keyHash)
    .eq('active', true)
    .maybeSingle();

  if (byHash) return { id: byHash.id, did: byHash.did, name: byHash.name };

  // Legacy rows that still store the raw key.
  const { data: byRaw } = await supabase
    .from('reputation_issuers')
    .select('id, did, name')
    .eq('api_key', apiKey)
    .eq('active', true)
    .maybeSingle();

  if (!byRaw) return null;

  // Lazy upgrade; never block authentication on it.
  void Promise.resolve(
    supabase
      .from('reputation_issuers')
      .update({ api_key_hash: keyHash, api_key: null })
      .eq('id', byRaw.id),
  ).then(undefined, () => undefined);

  return { id: byRaw.id, did: byRaw.did, name: byRaw.name };
}

/**
 * Whether a DID claimed in a payload belongs to the authenticated issuer.
 * did:web hosts are DNS names and compare case-insensitively; every other
 * DID method compares exactly.
 */
export function issuerOwnsDid(issuerDid: string, claimedDid: string): boolean {
  if (issuerDid === claimedDid) return true;
  if (issuerDid.startsWith('did:web:') && claimedDid.startsWith('did:web:')) {
    return normalizeDidWeb(issuerDid) === normalizeDidWeb(claimedDid);
  }
  return false;
}

/** Lowercase only the host segment of a did:web (path segments stay as-is). */
function normalizeDidWeb(did: string): string {
  const rest = did.slice('did:web:'.length);
  const sep = rest.indexOf(':');
  const host = sep === -1 ? rest : rest.slice(0, sep);
  const path = sep === -1 ? '' : rest.slice(sep);
  return `did:web:${host.toLowerCase()}${path}`;
}
