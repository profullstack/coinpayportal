import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { broadcastTransaction } from '@/lib/web-wallet/broadcast';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { checkRateLimit } from '@/lib/web-wallet/rate-limit';

/**
 * POST /api/web-wallet/:id/broadcast
 * Broadcast a signed transaction to the network.
 * Requires authentication.
 * Rate limited: 10 requests/minute per IP.
 *
 * Body:
 *   tx_id     - ID of the prepared transaction
 *   signed_tx - Signed transaction hex (EVM/BTC) or base64 (SOL)
 *   chain     - Target chain (BTC, ETH, etc.)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Rate limit by IP
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateCheck = checkRateLimit(clientIp, 'broadcast_tx');
    if (!rateCheck.allowed) {
      console.log(`[Broadcast] POST /broadcast rate limited for IP ${clientIp}`);
      return WalletErrors.rateLimited(rateCheck.resetAt - Math.floor(Date.now() / 1000));
    }

    console.log(`[Broadcast] POST /broadcast for wallet ${id}`);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return WalletErrors.configError();
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Read raw body for signature verification
    const rawBody = await request.text();

    // Authenticate
    const authHeader = request.headers.get('authorization');
    const auth = await authenticateWalletRequest(
      supabase,
      authHeader,
      'POST',
      `/api/web-wallet/${id}/broadcast`,
      rawBody
    );

    if (!auth.success) {
      return WalletErrors.unauthorized(auth.error);
    }

    if (auth.walletId !== id) {
      return WalletErrors.forbidden('Cannot access another wallet');
    }

    // Parse body
    const body = JSON.parse(rawBody);
    const { tx_id, signed_tx, chain } = body;

    if (!tx_id || !signed_tx || !chain) {
      return WalletErrors.badRequest('MISSING_FIELDS', 'tx_id, signed_tx, and chain are required');
    }

    const result = await broadcastTransaction(supabase, id, {
      tx_id,
      signed_tx,
      chain,
    });

    if (!result.success) {
      if (result.code === 'TX_NOT_FOUND') {
        return WalletErrors.notFound('transaction');
      }
      if (result.code === 'TX_EXPIRED' || result.code === 'TX_ALREADY_PROCESSED') {
        return WalletErrors.badRequest(result.code, result.error);
      }
      if (result.code === 'INVALID_CHAIN' || result.code === 'MISSING_SIGNED_TX') {
        return WalletErrors.badRequest(result.code, result.error);
      }
      return WalletErrors.serverError(result.error);
    }

    return walletSuccess(result.data as any);
  } catch (error) {
    console.error('Broadcast transaction error:', error);
    return WalletErrors.serverError();
  }
}
