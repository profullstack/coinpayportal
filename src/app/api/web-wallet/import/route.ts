import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { importWallet } from '@/lib/web-wallet/service';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { checkRateLimit } from '@/lib/web-wallet/rate-limit';

/**
 * POST /api/web-wallet/import
 * Import an existing wallet with proof of ownership.
 * Public endpoint - no authentication required.
 * Rate limited: 5 requests/hour per IP.
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limit by IP
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateCheck = checkRateLimit(clientIp, 'wallet_creation');
    if (!rateCheck.allowed) {
      return WalletErrors.rateLimited(rateCheck.resetAt - Math.floor(Date.now() / 1000));
    }

    const body = await request.json();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return WalletErrors.configError();
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const result = await importWallet(supabase, body);

    if (!result.success) {
      if (result.code === 'INVALID_SIGNATURE') {
        return WalletErrors.invalidSignature('Invalid proof of ownership signature');
      }
      return WalletErrors.badRequest(result.code || 'BAD_REQUEST', result.error!);
    }

    return walletSuccess(result.data!, 201);
  } catch (error) {
    console.error('Import wallet error:', error);
    return WalletErrors.serverError();
  }
}
