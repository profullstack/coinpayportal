import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { estimateFees } from '@/lib/web-wallet/fees';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { checkRateLimit } from '@/lib/web-wallet/rate-limit';
import type { WalletChain } from '@/lib/web-wallet/identity';
import { isValidChain } from '@/lib/web-wallet/identity';

/**
 * POST /api/web-wallet/:id/estimate-fee
 * Get fee estimates for a transaction.
 * Requires authentication.
 * Rate limited: 60 requests/minute per IP.
 *
 * Body:
 *   chain - Target chain (BTC, ETH, etc.)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Rate limit by IP
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateCheck = checkRateLimit(clientIp, 'estimate_fee');
    if (!rateCheck.allowed) {
      return WalletErrors.rateLimited(rateCheck.resetAt - Math.floor(Date.now() / 1000));
    }

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
      `/api/web-wallet/${id}/estimate-fee`
    );

    if (!auth.success) {
      return WalletErrors.unauthorized(auth.error);
    }

    if (auth.walletId !== id) {
      return WalletErrors.forbidden('Cannot access another wallet');
    }

    // Parse body
    const body = await request.json();
    const { chain } = body;

    if (!chain) {
      return WalletErrors.badRequest('MISSING_FIELDS', 'chain is required');
    }

    if (!isValidChain(chain)) {
      return WalletErrors.invalidChain(`Unsupported chain: ${chain}`);
    }

    const fees = await estimateFees(chain as WalletChain);

    return walletSuccess({
      chain,
      estimates: fees,
    } as any);
  } catch (error) {
    console.error('Estimate fee error:', error);
    return WalletErrors.serverError();
  }
}
