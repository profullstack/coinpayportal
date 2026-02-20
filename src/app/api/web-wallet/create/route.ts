import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createWallet } from '@/lib/web-wallet/service';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';

/**
 * POST /api/web-wallet/create
 * Register a new wallet with the server.
 * Client generates seed locally and only sends public keys.
 * Public endpoint - no authentication required.
 * Rate limited: 5 requests/hour per IP.
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limit by IP
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateCheck = await checkRateLimitAsync(clientIp, 'wallet_creation');
    if (!rateCheck.allowed) {
      console.log(`[WebWallet] POST /create rate limited for IP ${clientIp}`);
      return WalletErrors.rateLimited(rateCheck.resetAt - Math.floor(Date.now() / 1000));
    }

    console.log(`[WebWallet] POST /create from IP ${clientIp}`);

    const body = await request.json();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return WalletErrors.configError();
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const result = await createWallet(supabase, body);

    if (!result.success) {
      const codeStatusMap: Record<string, number> = {
        VALIDATION_ERROR: 400,
        INVALID_KEY: 400,
        INVALID_ADDRESS: 400,
        INVALID_DERIVATION_PATH: 400,
        DUPLICATE_KEY: 409,
      };
      const status = codeStatusMap[result.code!] || 400;
      return WalletErrors.badRequest(result.code || 'BAD_REQUEST', result.error!, undefined);
    }

    return walletSuccess(result.data!, 201);
  } catch (error) {
    console.error('Create wallet error:', error);
    return WalletErrors.serverError();
  }
}
