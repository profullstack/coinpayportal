import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Whether an issuing platform may manage this merchant's account-level records.
 *
 * Several routes authenticate an issuer API key and then act on any
 * `merchant_id` in the request body: rebinding the merchant's DID
 * (`reputation/did/override`), writing their payout wallet
 * (`reputation/merchant-wallet`), resolving them as a payee (`p2p/request`).
 * None of them checked that the platform had any relationship with the merchant
 * named, so one platform could repoint another merchant's identity or payout
 * destination at something it controlled.
 *
 * Two conditions, both required:
 *
 *  1. The merchant is platform-provisioned. A self-registered CoinPay merchant
 *     (`auth_provider = 'self'`) owns their own identity and payout settings and
 *     manages them through authenticated account routes.
 *  2. This specific platform provisioned them — evidenced by a business carrying
 *     its name. Otherwise any issuer could manage every platform's users.
 *
 * Issuer keys are easy to come by (see `CP-002`: registration was open and
 * auto-activated), so treating one as authority over an arbitrary merchant id
 * made the real trust boundary "anyone with an email address".
 */
export async function platformMayManageMerchant(
  supabase: SupabaseClient,
  platformName: string,
  merchantId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, auth_provider')
    .eq('id', merchantId)
    .maybeSingle();

  if (!merchant) {
    return { ok: false, error: 'merchant not found', status: 404 };
  }

  if (merchant.auth_provider !== 'platform') {
    return {
      ok: false,
      error:
        'This merchant registered with CoinPay directly. Their account can only be changed from their own account.',
      status: 403,
    };
  }

  const { data: link } = await supabase
    .from('businesses')
    .select('id')
    .eq('merchant_id', merchantId)
    .eq('platform', platformName)
    .limit(1)
    .maybeSingle();

  if (!link) {
    return {
      ok: false,
      error: 'This merchant was not provisioned by your platform',
      status: 403,
    };
  }

  return { ok: true };
}
