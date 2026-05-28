import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

export type PlatformIdentity = {
  did: string;
  email: string;
  name?: string;
};

export type PayoutDestination =
  | { kind: 'crypto'; cryptocurrency: string; address: string }
  | { kind: 'stripe'; stripe_account_id: string };

export type ResolvedAccount = {
  merchantId: string;
  businessId: string;
};

const SUPPORTED_CRYPTOS = new Set([
  'BTC', 'BCH', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'POL',
]);

/**
 * Resolve (or silently provision) the CoinPay merchant + business that owns
 * invoices issued on behalf of an external-platform user (e.g. ugig.net).
 *
 * Idempotent: re-calling with the same (platform, did) returns the same rows.
 *
 * The merchant created here is marked `auth_provider='platform'` and gets a
 * non-loggable random password hash — the user can never sign into CoinPay
 * directly; the platform is their auth surface.
 */
export async function resolveOrProvisionPayee(
  supabase: SupabaseClient,
  platform: string,
  identity: PlatformIdentity,
  payout: PayoutDestination
): Promise<{ success: true; account: ResolvedAccount } | { success: false; error: string }> {
  const { did, email, name } = identity;
  const normalizedEmail = email.toLowerCase();

  const { data: existingBiz } = await supabase
    .from('businesses')
    .select('id, merchant_id')
    .eq('platform', platform)
    .eq('external_user_did', did)
    .maybeSingle();

  if (existingBiz) {
    await persistPayout(supabase, existingBiz.merchant_id, existingBiz.id, payout);
    return {
      success: true,
      account: { merchantId: existingBiz.merchant_id, businessId: existingBiz.id },
    };
  }

  // No business yet — find/create the merchant, then create the business.
  let merchantId: string | undefined;

  const { data: didRow } = await supabase
    .from('merchant_dids')
    .select('merchant_id')
    .eq('did', did)
    .maybeSingle();

  if (didRow?.merchant_id) {
    merchantId = didRow.merchant_id;
  } else {
    const { data: byEmail } = await supabase
      .from('merchants')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (byEmail) {
      merchantId = byEmail.id;
    } else {
      // password_hash is NOT NULL in schema — store a random sentinel that
      // no bcrypt verify will ever match. auth_provider='platform' marks the
      // account as un-loginable through the standard flow.
      const sentinelHash = `platform:${randomBytes(32).toString('hex')}`;
      const { data: created, error: createErr } = await supabase
        .from('merchants')
        .insert({
          email: normalizedEmail,
          password_hash: sentinelHash,
          name: name || null,
          auth_provider: 'platform',
        })
        .select('id')
        .single();
      if (createErr || !created) {
        return { success: false, error: `Failed to provision merchant: ${createErr?.message ?? 'unknown'}` };
      }
      merchantId = created.id;
    }

    // Link or create the DID record.
    if (didRow) {
      await supabase.from('merchant_dids').update({ merchant_id: merchantId }).eq('did', did);
    } else {
      await supabase.from('merchant_dids').insert({
        did,
        public_key: '',
        platform,
        email: normalizedEmail,
        merchant_id: merchantId,
        verified: true,
      });
    }
  }

  const { data: newBiz, error: bizErr } = await supabase
    .from('businesses')
    .insert({
      merchant_id: merchantId,
      name: name || `${platform} user ${did.slice(0, 24)}`,
      platform,
      external_user_did: did,
      auto_provisioned: true,
    })
    .select('id, merchant_id')
    .single();

  if (bizErr || !newBiz) {
    return { success: false, error: `Failed to provision business: ${bizErr?.message ?? 'unknown'}` };
  }

  await persistPayout(supabase, newBiz.merchant_id, newBiz.id, payout);

  return {
    success: true,
    account: { merchantId: newBiz.merchant_id, businessId: newBiz.id },
  };
}

/**
 * Find or create the client row for the payer on the payee's business.
 * Returns the client_id to attach to the invoice.
 */
export async function resolveOrProvisionPayerClient(
  supabase: SupabaseClient,
  payeeMerchantId: string,
  payeeBusinessId: string,
  platform: string,
  payer: { did?: string; email: string; name?: string }
): Promise<string | null> {
  const email = payer.email.toLowerCase();

  if (payer.did) {
    const { data: byDid } = await supabase
      .from('clients')
      .select('id')
      .eq('business_id', payeeBusinessId)
      .eq('platform', platform)
      .eq('external_user_did', payer.did)
      .maybeSingle();
    if (byDid) return byDid.id;
  }

  const { data: byEmail } = await supabase
    .from('clients')
    .select('id')
    .eq('business_id', payeeBusinessId)
    .eq('email', email)
    .maybeSingle();
  if (byEmail) return byEmail.id;

  const { data: created, error } = await supabase
    .from('clients')
    .insert({
      user_id: payeeMerchantId,
      business_id: payeeBusinessId,
      email,
      name: payer.name || null,
      platform,
      external_user_did: payer.did || null,
    })
    .select('id')
    .single();
  if (error) return null;
  return created?.id ?? null;
}

async function persistPayout(
  supabase: SupabaseClient,
  merchantId: string,
  businessId: string,
  payout: PayoutDestination
): Promise<void> {
  if (payout.kind === 'crypto') {
    const crypto = payout.cryptocurrency.toUpperCase();
    if (!SUPPORTED_CRYPTOS.has(crypto)) return;
    await supabase
      .from('merchant_wallets')
      .upsert(
        {
          merchant_id: merchantId,
          cryptocurrency: crypto,
          wallet_address: payout.address,
          is_active: true,
        },
        { onConflict: 'merchant_id,cryptocurrency' }
      );
    return;
  }

  if (payout.kind === 'stripe') {
    await supabase
      .from('stripe_accounts')
      .upsert(
        {
          id: payout.stripe_account_id,
          merchant_id: merchantId,
          business_id: businessId,
        },
        { onConflict: 'business_id' }
      );
  }
}
