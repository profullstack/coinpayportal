import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAuthChallenge } from '@/lib/web-wallet/service';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { checkRateLimit } from '@/lib/web-wallet/rate-limit';

/**
 * POST /api/web-wallet/auth/verify
 * Verify a signed challenge and get a JWT auth token.
 * Public endpoint - no authentication required.
 * Rate limited: 10 requests/minute per IP.
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limit by IP
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateCheck = checkRateLimit(clientIp, 'auth_verify');
    if (!rateCheck.allowed) {
      return WalletErrors.rateLimited(rateCheck.resetAt - Math.floor(Date.now() / 1000));
    }

    const body = await request.json();

    if (!body.wallet_id || !body.challenge_id || !body.signature) {
      return WalletErrors.badRequest(
        'MISSING_FIELDS',
        'wallet_id, challenge_id, and signature are required'
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return WalletErrors.configError();
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const result = await verifyAuthChallenge(supabase, body);

    if (!result.success) {
      const errorMap: Record<string, () => ReturnType<typeof WalletErrors.unauthorized>> = {
        CHALLENGE_NOT_FOUND: () => WalletErrors.notFound('Challenge'),
        WALLET_NOT_FOUND: () => WalletErrors.notFound('Wallet'),
        AUTH_EXPIRED: () => WalletErrors.authExpired('Challenge has expired'),
        INVALID_SIGNATURE: () => WalletErrors.invalidSignature(),
        INVALID_CHALLENGE: () => WalletErrors.badRequest('INVALID_CHALLENGE', result.error!),
        CHALLENGE_USED: () => WalletErrors.badRequest('CHALLENGE_USED', 'Challenge already used'),
        WALLET_INACTIVE: () => WalletErrors.forbidden('Wallet is not active'),
      };

      const handler = errorMap[result.code!];
      return handler ? handler() : WalletErrors.serverError(result.error);
    }

    return walletSuccess(result.data!);
  } catch (error) {
    console.error('Auth verify error:', error);
    return WalletErrors.serverError();
  }
}
