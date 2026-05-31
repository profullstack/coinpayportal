import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { getLightningService } from '@/lib/lightning/lightning-service';
import { authorizeWalletRequest } from '../../wallet-auth';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/**
 * GET /api/lightning/nodes/:id
 * Get node status.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const walletId = request.nextUrl.searchParams.get('wallet_id');
    if (!walletId) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'wallet_id is required');
    }

    const authError = await authorizeWalletRequest(getSupabase(), request, walletId);
    if (authError) return authError;

    const service = getLightningService();
    const node = await service.getNode(id);

    if (!node || node.wallet_id !== walletId) {
      return WalletErrors.notFound('node');
    }

    return walletSuccess({ node });
  } catch (error) {
    console.error('[Lightning] GET /nodes/:id error:', error);
    return WalletErrors.serverError();
  }
}
