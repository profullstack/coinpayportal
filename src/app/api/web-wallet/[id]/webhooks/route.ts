import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { registerWebhook, listWebhooks } from '@/lib/web-wallet/wallet-webhooks';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { checkRateLimit } from '@/lib/web-wallet/rate-limit';

/**
 * POST /api/web-wallet/:id/webhooks
 * Register a new webhook for event notifications.
 * Requires authentication.
 *
 * Body: { url: string, events?: string[] }
 * Returns the webhook registration including the signing secret.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    console.log(`[Webhooks] POST /webhooks for wallet ${id}`);

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

    // Read raw body for signature verification
    const rawBody = await request.text();

    const authHeader = request.headers.get('authorization');
    const auth = await authenticateWalletRequest(
      supabase,
      authHeader,
      'POST',
      `/api/web-wallet/${id}/webhooks`,
      rawBody
    );

    if (!auth.success) {
      return WalletErrors.unauthorized(auth.error);
    }

    if (auth.walletId !== id) {
      return WalletErrors.forbidden('Cannot modify another wallet');
    }

    const body = JSON.parse(rawBody);
    const result = await registerWebhook(supabase, id, {
      url: body.url,
      events: body.events,
    });

    if (!result.success) {
      if (result.code === 'INVALID_URL' || result.code === 'INVALID_EVENT') {
        return WalletErrors.badRequest(result.code, result.error);
      }
      if (result.code === 'DUPLICATE_URL') {
        return WalletErrors.badRequest(result.code, result.error);
      }
      if (result.code === 'WEBHOOK_LIMIT') {
        return WalletErrors.badRequest(result.code, result.error);
      }
      return WalletErrors.serverError(result.error);
    }

    return walletSuccess(result.data as any, 201);
  } catch (error) {
    console.error('Register webhook error:', error);
    return WalletErrors.serverError();
  }
}

/**
 * GET /api/web-wallet/:id/webhooks
 * List all webhooks for a wallet.
 * Requires authentication.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateCheck = checkRateLimit(clientIp, 'balance_query');
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
      'GET',
      `/api/web-wallet/${id}/webhooks`
    );

    if (!auth.success) {
      return WalletErrors.unauthorized(auth.error);
    }

    if (auth.walletId !== id) {
      return WalletErrors.forbidden('Cannot access another wallet');
    }

    const result = await listWebhooks(supabase, id);

    if (!result.success) {
      return WalletErrors.serverError(result.error);
    }

    return walletSuccess({ webhooks: result.data } as any);
  } catch (error) {
    console.error('List webhooks error:', error);
    return WalletErrors.serverError();
  }
}
