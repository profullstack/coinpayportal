import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getWalletBalances } from '@/lib/web-wallet/balance';
import { getExchangeRate } from '@/lib/rates/tatum';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { checkRateLimit } from '@/lib/web-wallet/rate-limit';

/**
 * Chain symbol → exchange rate lookup symbol.
 * USDC variants always map to USDC (~$1).
 */
const CHAIN_TO_RATE_SYMBOL: Record<string, string> = {
  BTC: 'BTC',
  BCH: 'BCH',
  ETH: 'ETH',
  POL: 'POL',
  SOL: 'SOL',
  USDC_ETH: 'USDC',
  USDC_POL: 'USDC',
  USDC_SOL: 'USDC',
};

/**
 * GET /api/web-wallet/:id/balances/total-usd
 * Get total wallet balance in USD across all chains.
 * Requires authentication.
 * Rate limited: 30 requests/minute per IP.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Rate limit by IP
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

    // Authenticate
    const authHeader = request.headers.get('authorization');
    const auth = await authenticateWalletRequest(
      supabase,
      authHeader,
      'GET',
      `/api/web-wallet/${id}/balances/total-usd`
    );

    if (!auth.success) {
      return WalletErrors.unauthorized(auth.error);
    }

    if (auth.walletId !== id) {
      return WalletErrors.forbidden('Cannot access another wallet');
    }

    // Get all balances
    const balancesResult = await getWalletBalances(supabase, id);
    if (!balancesResult.success) {
      return WalletErrors.serverError(balancesResult.error);
    }

    const balances = balancesResult.data;

    // Get unique chains and fetch rates
    const uniqueChains = [...new Set(balances.map((b) => b.chain))];
    const rates: Record<string, number> = {};

    await Promise.allSettled(
      uniqueChains.map(async (chain) => {
        const symbol = CHAIN_TO_RATE_SYMBOL[chain] || chain;
        try {
          rates[chain] = await getExchangeRate(symbol, 'USD');
        } catch {
          rates[chain] = 0;
        }
      })
    );

    // Calculate USD values
    let totalUsd = 0;
    const balancesWithUsd = balances.map((b) => {
      const rate = rates[b.chain] || 0;
      const balanceNum = parseFloat(b.balance) || 0;
      const usdValue = Math.round(balanceNum * rate * 100) / 100;
      totalUsd += usdValue;
      return {
        chain: b.chain,
        address: b.address,
        balance: b.balance,
        usd_value: usdValue,
        rate,
        updated_at: b.updatedAt,
      };
    });

    totalUsd = Math.round(totalUsd * 100) / 100;

    return walletSuccess({
      total_usd: totalUsd,
      balances: balancesWithUsd,
    });
  } catch (error) {
    console.error('Get total balance USD error:', error);
    return WalletErrors.serverError();
  }
}
