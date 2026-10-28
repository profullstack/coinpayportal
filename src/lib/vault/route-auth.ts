import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../supabase/server';
import { authenticateRequest } from '../auth/middleware';
import { isOAuthCaller } from '../auth/oauth-funds';

/**
 * Who may manage a merchant's secrets vault: the merchant's dashboard session
 * or one of their API keys (so a script can unlock a payout session). Apps
 * signed in with CoinPay (OAuth) never can.
 */
export async function vaultMerchant(request: NextRequest): Promise<{ merchantId: string } | NextResponse> {
  const auth = await authenticateRequest(getSupabaseAdmin(), request.headers.get('authorization'));
  if (!auth.success || !auth.context) {
    return NextResponse.json({ success: false, error: auth.error || 'Authentication required' }, { status: 401 });
  }
  if (isOAuthCaller(auth.context)) {
    return NextResponse.json(
      { success: false, error: 'Apps signed in with CoinPay cannot manage the secrets vault', code: 'oauth_not_allowed' },
      { status: 403 },
    );
  }
  return { merchantId: auth.context.merchantId };
}
