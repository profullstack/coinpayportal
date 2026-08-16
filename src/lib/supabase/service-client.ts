import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The single way to build a service-role Supabase client.
 *
 * Routes used to construct these inline with a fallback chain:
 *
 *   process.env.SUPABASE_SERVICE_ROLE_KEY
 *     || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
 *     || 'public-anon-key'
 *
 * Every link in that chain is a way to fail quietly instead of loudly:
 *
 *   - Falling back to the ANON key does not fail — it silently downgrades. The
 *     route keeps serving, but RLS now applies to a code path written on the
 *     assumption that it does not. Reads come back empty and writes are refused,
 *     so the symptom is "the feature stopped working" appearing far from the
 *     cause, and any authorization the route was relying on the service role to
 *     have already performed is simply absent.
 *
 *   - Falling back to a LITERAL string is worse. It is a hardcoded credential in
 *     the sense that matters: the deployment believes it is authenticated and is
 *     not, and the value is public in the repository.
 *
 * A service-role client is a full-database credential that bypasses RLS. If it
 * is not configured, the correct behaviour is to refuse to start the request —
 * never to guess.
 *
 * @throws {Error} when the URL or service-role key is missing or blank.
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !url.trim()) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL is not configured — refusing to build a Supabase client.'
    );
  }

  if (!key || !key.trim()) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not configured — refusing to fall back to the anon key ' +
        'or any placeholder. Set it, or the route must not run.'
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Same contract, but returns null instead of throwing.
 *
 * For callers that already have a "server not configured" response to return
 * and would rather not convert an exception into one.
 */
export function tryCreateServiceClient(): SupabaseClient | null {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}
