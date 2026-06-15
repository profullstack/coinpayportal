/**
 * Shared helpers for team-management API routes.
 */
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';

export type Caller = { merchantId: string; email: string };

/**
 * Resolve the authenticated caller (JWT/API key via resolveMerchant) plus their email,
 * which acceptInvitation needs to match against the invited address.
 * Returns a NextResponse on auth failure so callers can `if (x instanceof NextResponse) return x`.
 */
export async function resolveCaller(
  supabase: SupabaseClient,
  request: NextRequest,
): Promise<Caller | NextResponse> {
  const resolved = await resolveMerchant(supabase, request);
  if ('error' in resolved) {
    return NextResponse.json({ success: false, error: resolved.error }, { status: resolved.status });
  }
  const { data } = await supabase
    .from('merchants')
    .select('email')
    .eq('id', resolved.merchantId)
    .maybeSingle();
  return { merchantId: resolved.merchantId, email: data?.email ?? '' };
}

/** Public base URL for building invitation links. */
export function appBaseUrl(request: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
}

/** Map a service ServiceResult error into a NextResponse. */
export function errorResponse(result: { error?: string; status?: number }): NextResponse {
  return NextResponse.json(
    { success: false, error: result.error ?? 'Request failed' },
    { status: result.status ?? 400 },
  );
}
