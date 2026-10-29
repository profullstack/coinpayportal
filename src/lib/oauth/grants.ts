/**
 * Grants: issuing token sets, rotating refresh tokens with reuse detection,
 * and revocation (RFC 7009).
 *
 * Every grant (one user's approval of one client, from one code or device
 * approval) is a refresh-token FAMILY. Each refresh rotates to a new token in
 * the same family and marks the old one `replaced_by`. Presenting a token that
 * was already rotated is reuse: someone holds a copy, so the whole family is
 * revoked, and so are the access tokens minted for it (they carry
 * `sid` = family id, checked against oauth_revoked_tokens).
 */
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hashToken } from '@/lib/crypto/token-hash';
import { ACCESS_TOKEN_TTL, generateAccessToken, generateIdToken, generateRefreshToken } from './tokens';

export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Db = SupabaseClient<any, any, any>;

export type GrantClient = { client_id: string; id_token_signed_response_alg?: 'RS256' | 'HS256' | null };

/** Mint an access token (+ refresh token, + ID token when `openid`) for a new or existing family. */
export async function issueTokenSet(
  db: Db,
  args: {
    userId: string;
    client: GrantClient;
    scopes: string[];
    nonce?: string | null;
    familyId?: string;
    includeIdToken?: boolean;
  }
): Promise<{ body: Record<string, unknown>; familyId: string; refreshRowId: string }> {
  const { userId, client, scopes } = args;
  const familyId = args.familyId || randomUUID();

  // No email_verified column and no verification flow: the claim stays false.
  const { data: merchant } = await db.from('merchants').select('id, email, name').eq('id', userId).maybeSingle();
  const user = merchant ? { ...merchant, email_verified: false } : { id: userId, email_verified: false };

  const accessToken = generateAccessToken(user, client, scopes, { sid: familyId });
  const refreshToken = generateRefreshToken();
  const refreshRowId = randomUUID();

  const { error } = await db.from('oauth_refresh_tokens').insert({
    id: refreshRowId,
    token: hashToken(refreshToken),
    client_id: client.client_id,
    user_id: userId,
    scopes,
    family_id: familyId,
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`could not store refresh token: ${error.message}`);

  const body: Record<string, unknown> = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL,
    refresh_token: refreshToken,
    scope: scopes.join(' '),
  };
  if ((args.includeIdToken ?? true) && scopes.includes('openid')) {
    body.id_token = generateIdToken(user, client, scopes, args.nonce, {
      alg: client.id_token_signed_response_alg === 'RS256' ? 'RS256' : 'HS256',
    });
  }
  return { body, familyId, refreshRowId };
}

/** Revoke every refresh token in a family and every access token minted for it. */
export async function revokeFamily(db: Db, familyId: string, clientId: string | null, reason: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .from('oauth_refresh_tokens')
    .update({ revoked: true, revoked_at: now, revoked_reason: reason })
    .eq('family_id', familyId)
    .eq('revoked', false);
  await db.from('oauth_revoked_tokens').upsert(
    {
      id: `sid:${familyId}`,
      client_id: clientId,
      reason,
      expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL * 1000 + 60_000).toISOString(),
    },
    { onConflict: 'id' }
  );
}

/** Revoke one access token by jti until it would have expired anyway. */
export async function revokeAccessTokenJti(db: Db, jti: string, clientId: string | null, expSeconds?: number): Promise<void> {
  const expiresAt = expSeconds ? new Date(expSeconds * 1000 + 60_000) : new Date(Date.now() + ACCESS_TOKEN_TTL * 1000 + 60_000);
  if (expiresAt.getTime() < Date.now()) return; // already dead
  await db
    .from('oauth_revoked_tokens')
    .upsert({ id: `jti:${jti}`, client_id: clientId, reason: 'revoked', expires_at: expiresAt.toISOString() }, { onConflict: 'id' });
}

/**
 * Is this (already signature-verified) access token revoked? Tokens minted
 * before 2026-10-29 have neither jti nor sid and cannot be revoked
 * individually; they expire within the hour.
 */
export async function isAccessTokenRevoked(db: Db, decoded: { jti?: unknown; sid?: unknown }): Promise<boolean> {
  const ids: string[] = [];
  if (typeof decoded.jti === 'string' && decoded.jti) ids.push(`jti:${decoded.jti}`);
  if (typeof decoded.sid === 'string' && decoded.sid) ids.push(`sid:${decoded.sid}`);
  if (ids.length === 0) return false;
  const { data, error } = await db.from('oauth_revoked_tokens').select('id').in('id', ids);
  if (error) {
    // Fail closed: an unreadable revocation list must not let a revoked token through.
    throw new Error(`revocation check failed: ${error.message}`);
  }
  return Array.isArray(data) && data.length > 0;
}

export type RotateResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: string; description: string };

/**
 * Rotate a refresh token. Reuse of a rotated token revokes the family.
 * `presented` is the raw token; rows store sha256 (legacy rows the raw value).
 */
export async function rotateRefreshToken(
  db: Db,
  args: { presented: string; client: GrantClient }
): Promise<RotateResult> {
  const { presented, client } = args;
  const { data: stored, error } = await db
    .from('oauth_refresh_tokens')
    .select('*')
    .eq('client_id', client.client_id)
    .in('token', [hashToken(presented), presented])
    .maybeSingle();
  if (error || !stored) return { ok: false, error: 'invalid_grant', description: 'Invalid refresh token' };

  const familyId: string = stored.family_id || stored.id;

  if (stored.revoked) {
    // Rotated already (replaced_by set) = a copy is being replayed. Kill the grant.
    if (stored.replaced_by) {
      await revokeFamily(db, familyId, client.client_id, 'refresh_token_reuse');
      console.warn(`[OAuth] refresh token reuse detected for client ${client.client_id}; family ${familyId} revoked`);
      return { ok: false, error: 'invalid_grant', description: 'Refresh token reuse detected; the grant has been revoked' };
    }
    return { ok: false, error: 'invalid_grant', description: 'Refresh token has been revoked' };
  }
  if (new Date(stored.expires_at) < new Date()) {
    return { ok: false, error: 'invalid_grant', description: 'Refresh token has expired' };
  }

  // Compare-and-swap so two concurrent refreshes cannot both succeed.
  const newId = randomUUID();
  const { data: rotated } = await db
    .from('oauth_refresh_tokens')
    .update({ revoked: true, revoked_at: new Date().toISOString(), revoked_reason: 'rotated', replaced_by: newId })
    .eq('id', stored.id)
    .eq('revoked', false)
    .select('id');
  if (!rotated || rotated.length === 0) {
    // Lost the race: the other request rotated it, so this one is a reuse.
    await revokeFamily(db, familyId, client.client_id, 'refresh_token_reuse');
    return { ok: false, error: 'invalid_grant', description: 'Refresh token reuse detected; the grant has been revoked' };
  }

  const { data: merchant } = await db.from('merchants').select('id, email, name').eq('id', stored.user_id).maybeSingle();
  const user = merchant ? { ...merchant, email_verified: false } : { id: stored.user_id, email_verified: false };
  const scopes: string[] = stored.scopes || ['openid'];
  const accessToken = generateAccessToken(user, client, scopes, { sid: familyId });
  const refreshToken = generateRefreshToken();
  const { error: insErr } = await db.from('oauth_refresh_tokens').insert({
    id: newId,
    token: hashToken(refreshToken),
    client_id: client.client_id,
    user_id: stored.user_id,
    scopes,
    family_id: familyId,
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString(),
  });
  if (insErr) return { ok: false, error: 'server_error', description: 'Could not store the new refresh token' };

  return {
    ok: true,
    body: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    },
  };
}
