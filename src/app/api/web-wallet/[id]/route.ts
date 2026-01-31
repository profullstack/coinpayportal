import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getWallet } from '@/lib/web-wallet/service';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';

/**
 * GET /api/web-wallet/:id
 * Get wallet info. Requires authentication.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

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
      `/api/web-wallet/${id}`
    );

    if (!auth.success) {
      return WalletErrors.unauthorized(auth.error);
    }

    // Verify the authenticated wallet matches the requested wallet
    if (auth.walletId !== id) {
      return WalletErrors.forbidden('Cannot access another wallet');
    }

    const result = await getWallet(supabase, id);

    if (!result.success) {
      return WalletErrors.notFound('Wallet');
    }

    return walletSuccess(result.data!);
  } catch (error) {
    console.error('Get wallet error:', error);
    return WalletErrors.serverError();
  }
}
