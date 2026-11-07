/**
 * POST /api/pass/claim — count the deposits on the user's linked web wallets
 * and grant the free month once they reach $99.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSessionUser } from '@/lib/oauth/session-user';
import { claimPass } from '@/lib/pass/service';
import { syncWalletHistory } from '@/lib/web-wallet/tx-indexer';
import { getExchangeRate } from '@/lib/rates/tatum';

const headers = { 'Cache-Control': 'no-store' };

// Each claim scans chains through public RPCs; one per account per minute is plenty.
const lastClaim = new Map<string, number>();
const CLAIM_INTERVAL_MS = 60_000;

export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401, headers });
  }

  const now = Date.now();
  const last = lastClaim.get(user.id) ?? 0;
  if (now - last < CLAIM_INTERVAL_MS) {
    const retry = Math.ceil((CLAIM_INTERVAL_MS - (now - last)) / 1000);
    return NextResponse.json(
      { error: 'rate_limited', error_description: `Try again in ${retry}s` },
      { status: 429, headers: { ...headers, 'Retry-After': String(retry) } },
    );
  }
  lastClaim.set(user.id, now);

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  try {
    const result = await claimPass(supabase, user.id, {
      syncWallet: (walletId) => syncWalletHistory(supabase, walletId),
      usdRate: (symbol) => getExchangeRate(symbol, 'USD'),
    });
    return NextResponse.json(result, { headers });
  } catch (error) {
    console.error('[pass] claim failed', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Could not check your deposits. Try again shortly.' },
      { status: 500, headers },
    );
  }
}
