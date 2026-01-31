import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getTransactionHistory } from '@/lib/web-wallet/transactions';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { checkRateLimit } from '@/lib/web-wallet/rate-limit';

/**
 * GET /api/web-wallet/:id/transactions
 * Get transaction history for a wallet.
 * Requires authentication.
 * Rate limited: 30 requests/minute per IP.
 *
 * Query params:
 *   chain - Filter by chain
 *   direction - Filter by direction (incoming/outgoing)
 *   status - Filter by status (pending/confirming/confirmed/failed)
 *   from_date - ISO date string for start of range
 *   to_date - ISO date string for end of range
 *   limit - Number of results (default 50, max 100)
 *   offset - Offset for pagination
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Rate limit by IP
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateCheck = checkRateLimit(clientIp, 'tx_history');
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
      `/api/web-wallet/${id}/transactions`
    );

    if (!auth.success) {
      return WalletErrors.unauthorized(auth.error);
    }

    if (auth.walletId !== id) {
      return WalletErrors.forbidden('Cannot access another wallet');
    }

    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const options = {
      chain: searchParams.get('chain') || undefined,
      direction: (searchParams.get('direction') as 'incoming' | 'outgoing') || undefined,
      status: searchParams.get('status') || undefined,
      from_date: searchParams.get('from_date') || undefined,
      to_date: searchParams.get('to_date') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : undefined,
    };

    const result = await getTransactionHistory(supabase, id, options);

    if (!result.success) {
      return WalletErrors.serverError(result.error);
    }

    return walletSuccess(result.data as any);
  } catch (error) {
    console.error('Get transaction history error:', error);
    return WalletErrors.serverError();
  }
}
