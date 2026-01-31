import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { deriveAddress } from '@/lib/web-wallet/service';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';

/**
 * POST /api/web-wallet/:id/derive
 * Derive (register) a new address for a wallet.
 * Requires authentication.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

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
      'POST',
      `/api/web-wallet/${id}/derive`,
      JSON.stringify(body)
    );

    if (!auth.success) {
      return WalletErrors.unauthorized(auth.error);
    }

    if (auth.walletId !== id) {
      return WalletErrors.forbidden('Cannot modify another wallet');
    }

    const result = await deriveAddress(supabase, id, body);

    if (!result.success) {
      if (result.code === 'WALLET_NOT_FOUND') {
        return WalletErrors.notFound('Wallet');
      }
      return WalletErrors.badRequest(result.code || 'BAD_REQUEST', result.error!);
    }

    return walletSuccess(result.data!, 201);
  } catch (error) {
    console.error('Derive address error:', error);
    return WalletErrors.serverError();
  }
}
