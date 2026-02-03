import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { checkRateLimit } from '@/lib/web-wallet/rate-limit';
import { syncWalletHistory } from '@/lib/web-wallet/tx-indexer';
import { isValidChain } from '@/lib/web-wallet/identity';
import type { WalletChain } from '@/lib/web-wallet/identity';

/**
 * POST /api/web-wallet/:id/sync-history
 * Sync on-chain transaction history for a wallet.
 * Fetches transactions from blockchain APIs and upserts into wallet_transactions.
 *
 * Requires authentication.
 * Rate limited: 10 requests/minute per IP.
 *
 * Body (optional):
 *   { chain?: string }  — Filter sync to a specific chain
 *
 * Returns:
 *   { new_transactions: number, results: SyncResult[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Rate limit by IP (stricter than normal — indexing is expensive)
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    const rateCheck = checkRateLimit(clientIp, 'sync_history');
    if (!rateCheck.allowed) {
      return WalletErrors.rateLimited(
        rateCheck.resetAt - Math.floor(Date.now() / 1000)
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return WalletErrors.configError();
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Read body first (needed for both auth verification and chain filter)
    let rawBody = '';
    let parsedBody: { chain?: string } = {};
    try {
      rawBody = await request.text();
      if (rawBody) {
        parsedBody = JSON.parse(rawBody);
      }
    } catch {
      // Empty or invalid body is fine
    }

    // Authenticate (pass body for signature verification)
    const authHeader = request.headers.get('authorization');
    const auth = await authenticateWalletRequest(
      supabase,
      authHeader,
      'POST',
      `/api/web-wallet/${id}/sync-history`,
      rawBody
    );

    if (!auth.success) {
      return WalletErrors.unauthorized(auth.error);
    }

    if (auth.walletId !== id) {
      return WalletErrors.forbidden('Cannot access another wallet');
    }

    // Verify wallet exists
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('id, status')
      .eq('id', id)
      .single();

    if (walletError || !wallet) {
      return WalletErrors.notFound('wallet');
    }

    if (wallet.status !== 'active') {
      return WalletErrors.badRequest(
        'WALLET_INACTIVE',
        'Wallet is not active'
      );
    }

    // Parse chain filter from body
    let chainFilter: WalletChain | undefined;
    if (parsedBody.chain) {
      if (!isValidChain(parsedBody.chain)) {
        return WalletErrors.invalidChain(
          `Unsupported chain: ${parsedBody.chain}`
        );
      }
      chainFilter = parsedBody.chain;
    }

    // Perform sync
    const syncResult = await syncWalletHistory(supabase, id, chainFilter);

    return walletSuccess({
      new_transactions: syncResult.newTransactions,
      results: syncResult.results.map((r) => ({
        chain: r.chain,
        address: r.address,
        new_transactions: r.newTransactions,
        errors: r.errors,
      })),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Sync history error:', msg);
    return WalletErrors.serverError();
  }
}
