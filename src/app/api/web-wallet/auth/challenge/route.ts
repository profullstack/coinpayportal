import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAuthChallenge } from '@/lib/web-wallet/service';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';

/**
 * GET /api/web-wallet/auth/challenge?wallet_id=<uuid>
 * Request an auth challenge for signature-based authentication.
 * Public endpoint - no authentication required.
 */
export async function GET(request: NextRequest) {
  try {
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
