import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getWalletBalances } from '@/lib/web-wallet/balance';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { checkRateLimit } from '@/lib/web-wallet/rate-limit';

/**
 * GET /api/web-wallet/:id/balances
 * Get balances for all active addresses in a wallet.
 * Requires authentication.
 * Rate limited: 60 requests/minute per IP.
 *
 * Query params:
 *   chain - Filter by chain (e.g. BTC, ETH)
 *   refresh - Set to "true" to force refresh from blockchain
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Rate limit by IP
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateCheck = checkRateLimit(clientIp, 'balance_query');
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
      `/api/web-wallet/${id}/balances`
    );

    if (!auth.success) {
      return WalletErrors.unauthorized(auth.error);
    }

    if (auth.walletId !== id) {
      return WalletErrors.forbidden('Cannot access another wallet');
    }

    // Parse query params
    const chain = request.nextUrl.searchParams.get('chain') || undefined;
    const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true';

    const result = await getWalletBalances(supabase, id, { chain, forceRefresh });

    if (!result.success) {
      return WalletErrors.serverError(result.error);
    }

    return walletSuccess({ balances: result.data } as any);
  } catch (error) {
    console.error('Get wallet balances error:', error);
    return WalletErrors.serverError();
  }
}
