import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getTransaction } from '@/lib/web-wallet/transactions';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { checkRateLimit } from '@/lib/web-wallet/rate-limit';

/**
 * GET /api/web-wallet/:id/transactions/:tx_id
 * Get details for a single transaction.
 * Requires authentication.
 * Rate limited: 30 requests/minute per IP.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tx_id: string }> }
) {
  try {
    const { id, tx_id } = await params;

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
      `/api/web-wallet/${id}/transactions/${tx_id}`
    );

    if (!auth.success) {
      return WalletErrors.unauthorized(auth.error);
    }

    if (auth.walletId !== id) {
      return WalletErrors.forbidden('Cannot access another wallet');
    }

    const result = await getTransaction(supabase, id, tx_id);

    if (!result.success) {
      if (result.code === 'TX_NOT_FOUND') {
        return WalletErrors.notFound('Transaction');
      }
      return WalletErrors.serverError(result.error);
    }

    return walletSuccess(result.data as any);
  } catch (error) {
    console.error('Get transaction detail error:', error);
    return WalletErrors.serverError();
  }
}
