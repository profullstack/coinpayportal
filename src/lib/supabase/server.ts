import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getRequiredServerEnv(): { url: string; serviceKey: string; anonKey?: string } {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase server environment variables');
  }

  return {
    url: supabaseUrl,
    serviceKey: supabaseServiceKey,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

function createSupabaseAdmin(): SupabaseClient {
  const { url, serviceKey } = getRequiredServerEnv();
  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createSupabaseAdmin();
  }
  return adminClient;
}

// Backward compatible lazy proxy for existing imports.
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getSupabaseAdmin() as object, prop, receiver);
  },
});

// Helper to create a client for a specific user (for RLS)
export function createServerClient(accessToken?: string) {
  const { url, anonKey } = getRequiredServerEnv();

  if (!accessToken) {
    return getSupabaseAdmin();
  }

  return createClient(url, anonKey || '', {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
