import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { listAddresses } from '@/lib/web-wallet/service';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';

/**
 * GET /api/web-wallet/:id/addresses
 * List all addresses for a wallet.
 * Requires authentication.
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
      `/api/web-wallet/${id}/addresses`
    );

    if (!auth.success) {
      return WalletErrors.unauthorized(auth.error);
    }

    if (auth.walletId !== id) {
      return WalletErrors.forbidden('Cannot access another wallet');
    }

    // Parse query params
    const chain = request.nextUrl.searchParams.get('chain') || undefined;
    const activeOnly = request.nextUrl.searchParams.get('active_only') === 'true';

    const result = await listAddresses(supabase, id, { chain, active_only: activeOnly });

    if (!result.success) {
      return WalletErrors.serverError(result.error);
    }

    return walletSuccess(result.data!);
  } catch (error) {
    console.error('List addresses error:', error);
    return WalletErrors.serverError();
  }
}
