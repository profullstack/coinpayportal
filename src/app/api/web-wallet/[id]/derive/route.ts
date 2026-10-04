import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { deriveAddress } from '@/lib/web-wallet/service';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { checkRateLimit } from '@/lib/web-wallet/rate-limit';
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

    console.log(`[Derive] POST /derive for wallet ${id}`);

    // Read raw body text FIRST so signature verification uses the exact bytes the client signed
    const rawBody = await request.text();
    const body = JSON.parse(rawBody);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return WalletErrors.configError();
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate using the raw body string (not re-serialized)
    const authHeader = request.headers.get('authorization');
    const auth = await authenticateWalletRequest(
      supabase,
      authHeader,
      'POST',
      `/api/web-wallet/${id}/derive`,
      rawBody
    );

    if (!auth.success) {
      return WalletErrors.unauthorized(auth.error);
    }

    // Its five sibling mutating routes are rate limited; this one was not.
    // Each call performs HD derivation and writes a row, so an authenticated
    // wallet could grow its own address table without bound. Keyed by wallet
    // rather than IP, since the caller is authenticated by signature.
    const rateCheck = checkRateLimit(id, 'wallet_derive');
    if (!rateCheck.allowed) {
      console.log(`[Derive] POST /derive rate limited for wallet ${id}`);
      return WalletErrors.rateLimited(rateCheck.resetAt - Math.floor(Date.now() / 1000));
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
