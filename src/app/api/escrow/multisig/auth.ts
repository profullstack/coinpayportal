import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth/middleware';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

export async function requireMultisigAuth(request: NextRequest): Promise<{
  ok: true;
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

  return { ok: true };
}
