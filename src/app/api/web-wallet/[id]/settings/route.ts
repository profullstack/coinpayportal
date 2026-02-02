import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSettings, updateSettings } from '@/lib/web-wallet/settings';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { checkRateLimit } from '@/lib/web-wallet/rate-limit';

/**
 * GET /api/web-wallet/:id/settings
 * Get wallet security settings.
 * Requires authentication.
 * Rate limited: 30 requests/minute per IP.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Rate limit by IP
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateCheck = checkRateLimit(clientIp, 'settings');
    if (!rateCheck.allowed) {
      return WalletErrors.rateLimited(rateCheck.resetAt - Math.floor(Date.now() / 1000));
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return WalletErrors.configError();
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate
    const authHeader = request.headers.get('authorization');
    const auth = await authenticateWalletRequest(
      supabase,
      authHeader,
      'GET',
      `/api/web-wallet/${id}/settings`
    );

    if (!auth.success) {
      return WalletErrors.unauthorized(auth.error);
    }

    if (auth.walletId !== id) {
      return WalletErrors.forbidden('Cannot access another wallet');
    }

    const result = await getSettings(supabase, id);

    if (!result.success) {
      return WalletErrors.serverError(result.error);
    }

    return walletSuccess(result.data as any);
  } catch (error) {
    console.error('Get settings error:', error);
    return WalletErrors.serverError();
  }
}

/**
 * PATCH /api/web-wallet/:id/settings
 * Update wallet security settings.
 * Requires authentication.
 * Rate limited: 30 requests/minute per IP.
 *
 * Body (all optional):
 *   daily_spend_limit         - Number or null
 *   whitelist_addresses       - Array of addresses
 *   whitelist_enabled         - Boolean
 *   require_confirmation      - Boolean
 *   confirmation_delay_seconds - Number
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Rate limit by IP
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateCheck = checkRateLimit(clientIp, 'settings');
    if (!rateCheck.allowed) {
      return WalletErrors.rateLimited(rateCheck.resetAt - Math.floor(Date.now() / 1000));
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return WalletErrors.configError();
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Read raw body for signature verification
    const rawBody = await request.text();

    // Authenticate
    const authHeader = request.headers.get('authorization');
    const auth = await authenticateWalletRequest(
      supabase,
      authHeader,
      'PATCH',
      `/api/web-wallet/${id}/settings`,
      rawBody
    );

    if (!auth.success) {
      return WalletErrors.unauthorized(auth.error);
    }

    if (auth.walletId !== id) {
      return WalletErrors.forbidden('Cannot access another wallet');
    }

    // Parse body
    const body = JSON.parse(rawBody);
    const {
      daily_spend_limit,
      whitelist_addresses,
      whitelist_enabled,
      require_confirmation,
      confirmation_delay_seconds,
    } = body;

    const result = await updateSettings(supabase, id, {
      daily_spend_limit,
      whitelist_addresses,
      whitelist_enabled,
      require_confirmation,
      confirmation_delay_seconds,
    });

    if (!result.success) {
      if (result.code === 'INVALID_LIMIT' || result.code === 'INVALID_DELAY' || result.code === 'NO_CHANGES') {
        return WalletErrors.badRequest(result.code, result.error);
      }
      return WalletErrors.serverError(result.error);
    }

    return walletSuccess(result.data as any);
  } catch (error) {
    console.error('Update settings error:', error);
    return WalletErrors.serverError();
  }
}
