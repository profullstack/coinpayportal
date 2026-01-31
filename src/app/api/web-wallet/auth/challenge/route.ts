import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAuthChallenge } from '@/lib/web-wallet/service';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { checkRateLimit } from '@/lib/web-wallet/rate-limit';

/**
 * GET /api/web-wallet/auth/challenge?wallet_id=<uuid>
 * Request an auth challenge for signature-based authentication.
 * Public endpoint - no authentication required.
 * Rate limited: 10 requests/minute per IP.
 */
export async function GET(request: NextRequest) {
  try {
    // Rate limit by IP
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateCheck = checkRateLimit(clientIp, 'auth_challenge');
    if (!rateCheck.allowed) {
      return WalletErrors.rateLimited(rateCheck.resetAt - Math.floor(Date.now() / 1000));
    }

    const walletId = request.nextUrl.searchParams.get('wallet_id');
    if (!walletId) {
      return WalletErrors.badRequest('MISSING_PARAM', 'wallet_id is required');
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return WalletErrors.configError();
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const result = await createAuthChallenge(supabase, walletId);

    if (!result.success) {
      if (result.code === 'WALLET_NOT_FOUND') {
        return WalletErrors.notFound('Wallet');
      }
      return WalletErrors.serverError(result.error);
    }

    return walletSuccess(result.data!);
  } catch (error) {
    console.error('Auth challenge error:', error);
    return WalletErrors.serverError();
  }
}
