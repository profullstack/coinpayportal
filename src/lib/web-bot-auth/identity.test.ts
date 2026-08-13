/**
 * Tests for resolving a verified Web Bot Auth key to a CoinPay identity.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveAgentIdentity, registerAgentKey } from './identity';
import { jwkThumbprint, type Ed25519Jwk } from './directory';
import type { VerifiedAgent } from './verify';

const JWK: Ed25519Jwk = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
};

const AGENT: VerifiedAgent = {
  verified: true,
  keyid: jwkThumbprint(JWK),
  signatureAgent: 'https://bot.example',
  agentOrigin: 'https://bot.example',
  coveredComponents: ['@authority'],
  expiresAt: null,
};

/** Supabase stub whose maybeSingle() resolves to the supplied row. */
function supabaseReturning(row: any, error: any = null) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error }),
  };
  return { from: () => chain } as any;
}

describe('resolveAgentIdentity', () => {
  it('returns the DID for a registered, active key', async () => {
    const supabase = supabaseReturning({
      agent_did: 'did:web:bot.example',
      label: 'Crawler v2',
      signature_agent: 'https://bot.example',
      active: true,
      revoked_at: null,
    });

    const identity = await resolveAgentIdentity(supabase, AGENT);

    expect(identity).toMatchObject({
      known: true,
      did: 'did:web:bot.example',
      label: 'Crawler v2',
      keyid: AGENT.keyid,
    });
  });

  it('treats an unregistered key as known:false rather than an error', async () => {
    const identity = await resolveAgentIdentity(supabaseReturning(null), AGENT);

    expect(identity.known).toBe(false);
    expect(identity.did).toBeNull();
    // The cryptographic facts survive even when the key is unknown here.
    expect(identity.keyid).toBe(AGENT.keyid);
    expect(identity.agentOrigin).toBe('https://bot.example');
  });

  it('ignores a revoked key', async () => {
    const supabase = supabaseReturning({
      agent_did: 'did:web:bot.example',
      label: null,
      signature_agent: 'https://bot.example',
      active: true,
      revoked_at: '2026-01-01T00:00:00Z',
    });

    expect((await resolveAgentIdentity(supabase, AGENT)).known).toBe(false);
  });

  it('ignores an inactive key', async () => {
    const supabase = supabaseReturning({
      agent_did: 'did:web:bot.example',
      label: null,
      signature_agent: 'https://bot.example',
      active: false,
      revoked_at: null,
    });

    expect((await resolveAgentIdentity(supabase, AGENT)).known).toBe(false);
  });

  it('refuses to hand over a DID when the key was registered for another directory', async () => {
    // Republishing someone else's public key at your own directory must not
    // let you inherit their identity and reputation.
    const supabase = supabaseReturning({
      agent_did: 'did:web:someone-else.example',
      label: null,
      signature_agent: 'https://someone-else.example',
      active: true,
      revoked_at: null,
    });

    const identity = await resolveAgentIdentity(supabase, AGENT);
    expect(identity.known).toBe(false);
    expect(identity.did).toBeNull();
  });

  it('does not fail closed into an exception on a query error', async () => {
    const supabase = supabaseReturning(null, { message: 'boom' });
    const identity = await resolveAgentIdentity(supabase, AGENT);
    expect(identity.known).toBe(false);
  });
});

describe('registerAgentKey', () => {
  let inserted: any;
  let supabase: any;

  beforeEach(() => {
    inserted = null;
    supabase = {
      from: () => ({
        insert: (row: any) => {
          inserted = row;
          return Promise.resolve({ error: null });
        },
      }),
    };
  });

  it('derives the keyid from the JWK rather than trusting input', async () => {
    const result = await registerAgentKey(supabase, { jwk: JWK });

    expect(result).toEqual({ keyid: jwkThumbprint(JWK) });
    expect(inserted.keyid).toBe(jwkThumbprint(JWK));
  });

  it('stores only public JWK members', async () => {
    // A caller pasting a private key must not get `d` persisted and then
    // served from the public directory.
    await registerAgentKey(supabase, {
      jwk: { ...JWK, d: 'PRIVATE-KEY-MATERIAL' } as any,
    });

    expect(inserted.jwk).toEqual({ kty: 'OKP', crv: 'Ed25519', x: JWK.x });
    expect(JSON.stringify(inserted)).not.toContain('PRIVATE-KEY-MATERIAL');
  });

  it('reports a duplicate registration distinctly', async () => {
    supabase = {
      from: () => ({
        insert: () => Promise.resolve({ error: { code: '23505', message: 'dup' } }),
      }),
    };

    const result = await registerAgentKey(supabase, { jwk: JWK });
    expect(result).toEqual({ error: 'Key already registered' });
  });
});
