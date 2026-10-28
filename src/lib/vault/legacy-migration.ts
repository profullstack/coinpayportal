import { getSupabaseAdmin } from '../supabase/server';
import { decrypt } from '../crypto/encryption';
import { requireEncryptionKey } from '../crypto/require-key';
import { legacyKeyMigrationEnabled } from '../crypto/legacy-migration';
import { isSealed, sealForMerchant, getVaultPublicKey } from './vault-service';

/**
 * Re-seal one merchant's legacy secrets (encrypted under server-held keys) to
 * their secrets vault. Sealing needs only the vault PUBLIC key, so this runs
 * as soon as the vault exists (POST /api/vault) and from
 * scripts/seal-merchant-secrets.mts for merchants who set one up before a
 * failure. The legacy ciphertext is replaced in the same update; nothing is
 * deleted that is not replaced by its sealed form.
 *
 * Closed by LEGACY_KEY_MIGRATION=off (then legacy rows stay as they are and
 * can no longer be opened at all).
 */
export interface LegacyMigrationResult {
  financeConnections: number;
  crawlproof: number;
  payoutWallets: number;
  paypalAccounts: number;
  bankSessions: number;
  files: number;
  errors: string[];
}

export async function migrateLegacyMerchantSecrets(merchantId: string): Promise<LegacyMigrationResult> {
  const result: LegacyMigrationResult = {
    financeConnections: 0,
    crawlproof: 0,
    payoutWallets: 0,
    paypalAccounts: 0,
    bankSessions: 0,
    files: 0,
    errors: [],
  };
  if (!legacyKeyMigrationEnabled()) return result;
  if (!(await getVaultPublicKey('merchant', merchantId))) return result;
  const supabase = getSupabaseAdmin();
  const step = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      result.errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  await step('finance_connections', async () => {
    const { connectionAad } = await import('../finances/sync');
    const { data } = await supabase
      .from('finance_connections')
      .select('id, access_url_encrypted')
      .eq('merchant_id', merchantId)
      .neq('access_url_encrypted', '');
    for (const row of data ?? []) {
      const stored = row.access_url_encrypted as string | null;
      if (!stored || isSealed(stored)) continue;
      const plain = decrypt(stored, requireEncryptionKey('finance connection access'));
      const sealed = await sealForMerchant(merchantId, plain, connectionAad(merchantId));
      await supabase.from('finance_connections').update({ access_url_encrypted: sealed, seal_version: 2 }).eq('id', row.id);
      result.financeConnections += 1;
    }
  });

  await step('merchant_crawlproof_connections', async () => {
    const { tokenAad } = await import('../integrations/crawlproof');
    const { data } = await supabase
      .from('merchant_crawlproof_connections')
      .select('token_encrypted')
      .eq('merchant_id', merchantId)
      .maybeSingle();
    const stored = data?.token_encrypted as string | undefined;
    if (stored && !isSealed(stored)) {
      const plain = decrypt(stored, requireEncryptionKey('crawlproof token access'));
      const sealed = await sealForMerchant(merchantId, plain, tokenAad(merchantId));
      await supabase.from('merchant_crawlproof_connections').update({ token_encrypted: sealed, seal_version: 2 }).eq('merchant_id', merchantId);
      result.crawlproof += 1;
    }
  });

  const { data: businesses } = await supabase.from('businesses').select('id').eq('merchant_id', merchantId);
  const businessIds = (businesses ?? []).map((b) => b.id as string);

  if (businessIds.length) {
    await step('business_payout_wallets', async () => {
      const { payoutKeyAad } = await import('../payouts/payout-wallet');
      const { data } = await supabase
        .from('business_payout_wallets')
        .select('id, business_id, family, address, encrypted_private_key')
        .in('business_id', businessIds);
      for (const row of data ?? []) {
        const stored = row.encrypted_private_key as string;
        if (!stored || isSealed(stored)) continue;
        const plain = decrypt(stored, requireEncryptionKey('payout'));
        const sealed = await sealForMerchant(merchantId, plain, payoutKeyAad(row.business_id, row.family, row.address));
        await supabase.from('business_payout_wallets').update({ encrypted_private_key: sealed, seal_version: 2 }).eq('id', row.id);
        result.payoutWallets += 1;
      }
    });

    await step('paypal_accounts', async () => {
      const { decryptLegacyPaypalSecret, sealPaypalSecret } = await import('../paypal/accounts');
      const { data } = await supabase
        .from('paypal_accounts')
        .select('business_id, paypal_client_secret_encrypted')
        .in('business_id', businessIds);
      for (const row of data ?? []) {
        const stored = row.paypal_client_secret_encrypted as string | null;
        if (!stored || isSealed(stored)) continue;
        const plain = decryptLegacyPaypalSecret(stored, row.business_id);
        const sealed = await sealPaypalSecret(plain, row.business_id);
        await supabase.from('paypal_accounts').update({ paypal_client_secret_encrypted: sealed, seal_version: 2 }).eq('business_id', row.business_id);
        result.paypalAccounts += 1;
      }
    });
  }

  await step('finance_bank_sessions', async () => {
    const { listBankSessions, openLegacyState, sealState } = await import('../finances/bank-sessions');
    const { getObject, putObject, deleteObject } = await import('../finances/files');
    const { isSealedBinary } = await import('./sealed-vault');
    for (const row of await listBankSessions(merchantId)) {
      if (!row.object_key) continue;
      const stored = await getObject(row.object_key);
      if (isSealedBinary(stored)) continue;
      const state = openLegacyState(stored, merchantId, row.institution_key);
      const next = await putObject('bank-sessions', merchantId, await sealState(state, merchantId, row.institution_key));
      const { error } = await supabase
        .from('finance_bank_sessions')
        .update({ object_key: next.objectKey })
        .eq('id', row.id)
        .eq('object_key', row.object_key);
      if (error) {
        await deleteObject(next.objectKey).catch(() => undefined);
        throw new Error(error.message);
      }
      await deleteObject(row.object_key).catch(() => undefined);
      result.bankSessions += 1;
    }
  });

  await step('finance files', async () => {
    const { resealLegacyObjects } = await import('../finances/files');
    result.files = await resealLegacyObjects(merchantId);
  });

  return result;
}
