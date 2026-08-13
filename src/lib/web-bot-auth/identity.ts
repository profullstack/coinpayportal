/**
 * Web Bot Auth — resolving a verified key to a CoinPay identity
 *
 * A verified signature proves control of a key published at some directory.
 * That alone is anonymous: it says "the same caller as last time", not "an
 * agent with a track record". This module joins the key to a registered DID so
 * a caller arrives with a reputation attached.
 *
 * Identity and trust are kept separate on purpose. `verified` is a
 * cryptographic fact. `did` and `trust` are claims CoinPay has recorded about
 * that key, and their absence means unknown — never untrusted.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedAgent } from './verify';
import { jwkThumbprint, type Ed25519Jwk } from './directory';

export interface AgentIdentity {
  /** Thumbprint of the key that signed. Always present. */
  keyid: string;
  /** Directory origin the key was published at. Always present. */
  agentOrigin: string;
  /** Registered CoinPay DID, when this key has been mapped to one. */
  did: string | null;
  /** Operator-supplied label for the key. */
  label: string | null;
  /** True when the key is registered and active here. */
  known: boolean;
}

/**
 * Look up the CoinPay identity behind a verified signature.
 *
 * Returns an identity with `known: false` for a signature that verified
 * against a directory CoinPay has no record of — a legitimate state for any
 * agent that has not registered.
 */
export async function resolveAgentIdentity(
  supabase: SupabaseClient,
  agent: VerifiedAgent
): Promise<AgentIdentity> {
  const base: AgentIdentity = {
    keyid: agent.keyid,
    agentOrigin: agent.agentOrigin,
    did: null,
    label: null,
    known: false,
  };

  const { data, error } = await supabase
    .from('web_bot_auth_keys')
    .select('agent_did, label, signature_agent, active, revoked_at')
    .eq('keyid', agent.keyid)
    .maybeSingle();

  if (error || !data) return base;
  if (!data.active || data.revoked_at) return base;

  // A registration is scoped to the directory it was registered for. Without
  // this check, publishing a copy of someone's public key at your own
  // directory would let you inherit their DID and reputation.
  if (
    data.signature_agent &&
    normalizeOrigin(data.signature_agent) !== agent.agentOrigin
  ) {
    return base;
  }

  return {
    ...base,
    did: data.agent_did ?? null,
    label: data.label ?? null,
    known: true,
  };
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value.trim().replace(/^"|"$/g, '')).origin;
  } catch {
    return value;
  }
}

/**
 * Register a public key against an identity.
 *
 * The caller supplies the JWK; the thumbprint is always recomputed here rather
 * than trusted from input, since it is the join key that decides which
 * identity a signature resolves to.
 */
export async function registerAgentKey(
  supabase: SupabaseClient,
  input: {
    jwk: Ed25519Jwk;
    signatureAgent?: string | null;
    agentDid?: string | null;
    merchantId?: string | null;
    label?: string | null;
    published?: boolean;
  }
): Promise<{ keyid: string } | { error: string }> {
  const keyid = jwkThumbprint(input.jwk);

  const { error } = await supabase.from('web_bot_auth_keys').insert({
    keyid,
    // Store only the public members, so a caller cannot smuggle a private `d`
    // into the row and have it served from the public directory.
    jwk: { kty: input.jwk.kty, crv: input.jwk.crv, x: input.jwk.x },
    signature_agent: input.signatureAgent ?? null,
    agent_did: input.agentDid ?? null,
    merchant_id: input.merchantId ?? null,
    label: input.label ?? null,
    published: input.published ?? false,
  });

  if (error) {
    if (error.code === '23505') return { error: 'Key already registered' };
    return { error: error.message };
  }

  return { keyid };
}
