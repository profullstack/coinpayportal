import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { prepareTransaction } from '@/lib/web-wallet/prepare-tx';
import { checkTransactionAllowed } from '@/lib/web-wallet/settings';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { checkRateLimit } from '@/lib/web-wallet/rate-limit';
import type { WalletChain } from '@/lib/web-wallet/identity';
import { isValidChain } from '@/lib/web-wallet/identity';

/**
 * POST /api/web-wallet/:id/prepare-tx
 * Prepare an unsigned transaction for client-side signing.
 * Requires authentication.
 * Rate limited: 20 requests/minute per IP.
 *
 * Body:
 *   from_address - Sender address (must belong to wallet)
 *   to_address   - Recipient address
 *   chain        - Target chain (BTC, ETH, etc.)
 *   amount       - Amount to send (in native units)
 *   priority     - Fee priority: low | medium | high (default: medium)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Rate limit by IP
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateCheck = checkRateLimit(clientIp, 'prepare_tx');
    if (!rateCheck.allowed) {
      return WalletErrors.rateLimited(rateCheck.resetAt - Math.floor(Date.now() / 1000));
    }

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
      `/api/web-wallet/${id}/prepare-tx`,
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
    const { from_address, to_address, chain, amount, priority } = body;

    if (!from_address || !to_address || !chain || !amount) {
      return WalletErrors.badRequest('MISSING_FIELDS', 'from_address, to_address, chain, and amount are required');
    }

    // Check security settings (spend limits, whitelist)
    if (isValidChain(chain)) {
      const securityCheck = await checkTransactionAllowed(
        supabase,
        id,
        to_address,
        parseFloat(amount),
        chain as WalletChain
      );
      if (!securityCheck.allowed) {
        return WalletErrors.badRequest('SECURITY_CHECK_FAILED', securityCheck.reason);
      }
    }

    // Prepare the unsigned transaction
    const result = await prepareTransaction(supabase, id, {
      from_address,
      to_address,
      chain,
      amount,
      priority,
    });

    if (!result.success) {
      if (result.code === 'INVALID_CHAIN' || result.code === 'INVALID_ADDRESS' || result.code === 'INVALID_AMOUNT') {
        return WalletErrors.badRequest(result.code, result.error);
      }
      if (result.code === 'ADDRESS_NOT_FOUND') {
        return WalletErrors.notFound('address');
      }
      return WalletErrors.serverError(result.error);
    }

    return walletSuccess(result.data as any, 201);
  } catch (error) {
    console.error('Prepare transaction error:', error);
    return WalletErrors.serverError();
  }
}
