import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { deleteWebhook } from '@/lib/web-wallet/wallet-webhooks';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { checkRateLimit } from '@/lib/web-wallet/rate-limit';

/**
 * DELETE /api/web-wallet/:id/webhooks/:webhook_id
 * Delete a webhook registration.
 * Requires authentication.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; webhook_id: string }> }
) {
  try {
    const { id, webhook_id } = await params;

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateCheck = checkRateLimit(clientIp, 'wallet_mutation');
    if (!rateCheck.allowed) {
      return WalletErrors.rateLimited(rateCheck.resetAt - Math.floor(Date.now() / 1000));
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return WalletErrors.configError();
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = request.headers.get('authorization');
    const auth = await authenticateWalletRequest(
      supabase,
      authHeader,
      'DELETE',
      `/api/web-wallet/${id}/webhooks/${webhook_id}`
    );

    if (!auth.success) {
      return WalletErrors.unauthorized(auth.error);
    }

    if (auth.walletId !== id) {
      return WalletErrors.forbidden('Cannot modify another wallet');
    }

    const result = await deleteWebhook(supabase, id, webhook_id);

    if (!result.success) {
      if (result.code === 'WEBHOOK_NOT_FOUND') {
        return WalletErrors.notFound('webhook');
      }
      return WalletErrors.serverError(result.error);
    }

    return walletSuccess({ deleted: true });
  } catch (error) {
    console.error('Delete webhook error:', error);
    return WalletErrors.serverError();
  }
}
