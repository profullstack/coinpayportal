import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../supabase/server';
import { authenticateRequest } from '../auth/middleware';
import { isOAuthCaller } from '../auth/oauth-funds';
import { scopesSatisfy } from '../auth/scoped-keys';

export type VaultKeyPolicy = {
  /**
   * May a business API key do this? 'payouts' = only a key with
   * `payouts:create` (or a legacy all-scope key), so a payout script can read
   * the record and unlock/lock a session. 'never' = the owner's dashboard
   * session only (creating the vault, changing its passphrase): a business
   * key used to create a merchant's vault, which re-sealed EVERY business's
   * payout keys to whoever held the key.
   */
  apiKey: 'payouts' | 'never';
};

/**
 * Who may manage a merchant's secrets vault: the merchant's dashboard session,
 * or (per `policy`) a business API key with the payouts scope. Apps signed in
 * with CoinPay (OAuth) never can.
 */
export async function vaultMerchant(
  request: NextRequest,
  policy: VaultKeyPolicy = { apiKey: 'never' },
): Promise<{ merchantId: string } | NextResponse> {
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
  if (auth.context.type === 'business') {
    if (policy.apiKey === 'never') {
      return NextResponse.json(
        { success: false, error: 'This needs the account owner signed in; an API key cannot do it', code: 'session_required' },
        { status: 403 },
      );
    }
    if (!scopesSatisfy(auth.context.scopes ?? [], 'payouts:create')) {
      return NextResponse.json(
        { success: false, error: 'API key missing required scope: payouts:create' },
        { status: 403 },
      );
    }
  }
  return { merchantId: auth.context.merchantId };
}
