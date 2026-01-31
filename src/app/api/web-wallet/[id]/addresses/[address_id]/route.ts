import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { deactivateAddress } from '@/lib/web-wallet/service';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';

/**
 * DELETE /api/web-wallet/:id/addresses/:address_id
 * Deactivate an address (stop monitoring).
 * Requires authentication.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; address_id: string }> }
) {
  try {
    const { id, address_id } = await params;

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
      'DELETE',
      `/api/web-wallet/${id}/addresses/${address_id}`
    );

    if (!auth.success) {
      return WalletErrors.unauthorized(auth.error);
    }

    if (auth.walletId !== id) {
      return WalletErrors.forbidden('Cannot modify another wallet');
    }

    const result = await deactivateAddress(supabase, id, address_id);

    if (!result.success) {
      return WalletErrors.notFound('Address');
    }

    return walletSuccess(result.data!);
  } catch (error) {
    console.error('Deactivate address error:', error);
    return WalletErrors.serverError();
  }
}
