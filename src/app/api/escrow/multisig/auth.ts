import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth/middleware';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/**
 * F-1.1-04: this resolved the caller and then returned `{ ok: true }`, throwing
 * the identity away. A route that cannot see who is calling cannot scope
 * anything to them — which is why `createMultisigEscrow` persisted the
 * `business_id` from the request body with no ownership check at all.
 *
 * The context now comes back, and callers are expected to use it.
 */
export async function requireMultisigAuth(request: NextRequest): Promise<{
  ok: true;
  context: NonNullable<Awaited<ReturnType<typeof authenticateRequest>>['context']>;
} | {
  ok: false;
  response: NextResponse;
}> {
  const supabase = getSupabase();
  const authHeader = request.headers.get('authorization');
  const apiKeyHeader = request.headers.get('x-api-key');

  if (!authHeader && !apiKeyHeader) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Authentication required. Provide Authorization header or X-API-Key.' },
        { status: 401 },
      ),
    };
  }

  const authValue = authHeader || `Bearer ${apiKeyHeader}`;
  const authResult = await authenticateRequest(supabase, authValue);

  if (!authResult.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: authResult.error || 'Invalid or expired authentication' },
        { status: 401 },
      ),
    };
  }

  if (!authResult.context) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid authentication context' }, { status: 401 }),
    };
  }

  return { ok: true, context: authResult.context };
}
