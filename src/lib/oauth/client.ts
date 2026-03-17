/**
 * OAuth2 client validation utilities
 */
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase configuration missing');
  }
  return createClient(url, key);
}

export interface OAuthClient {
  id: string;
  client_id: string;
  client_secret: string;
  name: string;
  description: string | null;
  redirect_uris: string[];
  scopes: string[];
  owner_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Validate that a client exists, is active, and the redirect_uri matches
 */
export async function validateClient(
  clientId: string,
  redirectUri: string
): Promise<{ valid: boolean; client?: OAuthClient; error?: string }> {
  const supabase = getSupabase();

  const { data: client, error } = await supabase
    .from('oauth_clients')
    .select('*')
    .eq('client_id', clientId)
    .single();

  if (error || !client) {
    return { valid: false, error: 'Invalid client_id' };
  }

  if (!client.is_active) {
    return { valid: false, error: 'Client is inactive' };
  }

  if (!client.redirect_uris.includes(redirectUri)) {
    return { valid: false, error: 'Invalid redirect_uri' };
  }

  return { valid: true, client: client as OAuthClient };
}

/**
 * Authenticate a client using client_id and client_secret (for token endpoint).
 * Client secret is stored as a bcrypt hash; comparison uses bcrypt.compare.
 */
export async function authenticateClient(
  clientId: string,
  clientSecret: string
): Promise<{ valid: boolean; client?: OAuthClient; error?: string }> {
  const supabase = getSupabase();

  const { data: client, error } = await supabase
    .from('oauth_clients')
    .select('*')
    .eq('client_id', clientId)
    .single();

  if (error || !client) {
    return { valid: false, error: 'Invalid client credentials' };
  }

  if (!client.is_active) {
    return { valid: false, error: 'Client is inactive' };
  }

  // Compare plaintext secret against stored bcrypt hash
  const match = await bcrypt.compare(clientSecret, client.client_secret);
  if (!match) {
    return { valid: false, error: 'Invalid client credentials' };
  }

  return { valid: true, client: client as OAuthClient };
}

/**
 * Hash a client secret for storage
 */
export async function hashClientSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, 10);
}
