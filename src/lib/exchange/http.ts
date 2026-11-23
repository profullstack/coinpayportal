/**
 * Shared HTTP plumbing for /api/exchange/* routes.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { authorizeWallet } from '@/lib/swap/auth';
import { engineMode, isExchangeEnabled, isInternalWallet } from './policy';
import { ExchangeError } from './types';

export function exchangeSupabase(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * Requester country, only from a header our edge sets. Unknown is null, which
 * crypto routes accept and fiat routes (when they exist) refuse.
 */
export function requestCountry(request: NextRequest): string | null {
  if (process.env.TRUST_VENDOR_IP_HEADERS !== 'true') return null;
  const c = request.headers.get('cf-ipcountry')?.trim().toUpperCase();
  return c && /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : null;
}

export function disabledResponse(): NextResponse {
  return json({ error: 'The exchange is not available yet.', code: 'engine_disabled' }, 503);
}

export function guardEnabled(): NextResponse | null {
  return isExchangeEnabled() ? null : disabledResponse();
}

/**
 * For routes that are anonymous in public mode (assets, quotes). In internal
 * mode the caller must sign as an allowlisted wallet; anyone else sees the
 * same 503 as when the engine is off, so internal testing is invisible.
 */
export async function guardAnonymous(request: NextRequest, rawBody?: string): Promise<NextResponse | null> {
  const mode = engineMode();
  if (mode === 'off') return disabledResponse();
  if (mode === 'public') return null;
  if (!request.headers.get('authorization')) return disabledResponse();
  const auth = await authorizeWallet(exchangeSupabase(), request, rawBody);
  return auth.ok && isInternalWallet(auth.walletId) ? null : disabledResponse();
}

/** For wallet-authenticated routes, after auth: internal mode admits only the allowlist. */
export function guardWallet(walletId: string): NextResponse | null {
  const mode = engineMode();
  if (mode === 'off') return disabledResponse();
  if (mode === 'internal' && !isInternalWallet(walletId)) return disabledResponse();
  return null;
}

export function errorResponse(e: unknown, where: string): NextResponse {
  if (e instanceof ExchangeError) {
    return json({ error: e.message, code: e.code }, e.status);
  }
  console.error(`[exchange] ${where}`, e);
  return json({ error: 'Exchange request failed', code: 'internal' }, 500);
}

/**
 * Every exchange response uses the web-wallet envelope the wallet SDK parses
 * (WalletAPIClient throws unless `success` is true and reads `data`):
 *   ok:    { success: true, data: {...}, ...same fields at the top level }
 *   error: { success: false, error: { code, message } }
 * The top-level copy on success keeps plain REST callers simple.
 */
export function json(body: Record<string, unknown>, status = 200): NextResponse {
  const headers = { 'Cache-Control': 'no-store' };
  if (status >= 400 || typeof body.error === 'string') {
    const message = typeof body.error === 'string' ? body.error : 'Request failed';
    const code = typeof body.code === 'string' ? body.code : status === 401 ? 'unauthorized' : status === 404 ? 'not_found' : 'error';
    return NextResponse.json({ success: false, error: { code, message } }, { status, headers });
  }
  return NextResponse.json({ success: true, data: body, ...body }, { status, headers });
}
