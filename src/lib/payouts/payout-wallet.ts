/**
 * Business payout (sending) wallets.
 *
 * A business's receive wallets (business_wallets) are its own addresses and
 * carry no key, so they cannot sign a payout. A payout wallet is a hot wallet
 * CoinPay generates; the merchant funds it and /api/payouts/create sends from
 * it. One EVM key covers every EVM coin.
 *
 * The key is sealed to the owning merchant's secrets vault (2026-10-28): it
 * can be generated while they are away (sealing uses the public key) but only
 * signs while they have unlocked a payout session. Legacy keys under
 * ENCRYPTION_KEY are re-sealed on first use while unlocked, or by the vault's
 * legacy migration.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;
import { ethers } from 'ethers';
import { decrypt } from '@/lib/crypto/encryption';
import { requireEncryptionKey } from '@/lib/crypto/require-key';
import { openMerchantSecret, sealForMerchant } from '@/lib/vault/merchant-secret';
import { merchantIdForBusiness } from '@/lib/vault/vault-service';

export type PayoutWalletFamily = 'evm';

/** ERC-20 payout coins: contract + decimals. */
export const EVM_PAYOUT_TOKENS: Record<string, { contract: string; decimals: number; native: string }> = {
  USDC_POL: { contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6, native: 'POL' },
  USDT_POL: { contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, native: 'POL' },
  USDC_ETH: { contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, native: 'ETH' },
  USDT_ETH: { contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, native: 'ETH' },
  USDC_BASE: { contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, native: 'ETH' },
};

const EVM_NATIVE = new Set(['ETH', 'POL', 'BNB']);

export function payoutFamilyFor(cryptocurrency: string): PayoutWalletFamily | null {
  const c = cryptocurrency.toUpperCase();
  return EVM_NATIVE.has(c) || c in EVM_PAYOUT_TOKENS ? 'evm' : null;
}

export interface PayoutWalletRow {
  id: string;
  business_id: string;
  family: PayoutWalletFamily;
  address: string;
  encrypted_private_key: string;
  created_at: string;
}

export async function getPayoutWallet(
  supabase: SupabaseClient,
  businessId: string,
  family: PayoutWalletFamily
): Promise<PayoutWalletRow | null> {
  const { data, error } = await supabase
    .from('business_payout_wallets')
    .select('id, business_id, family, address, encrypted_private_key, created_at')
    .eq('business_id', businessId)
    .eq('family', family)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

/**
 * Create the business's payout wallet, or return the existing one. Never
 * rotates a key: the old wallet may still hold funds.
 */
export async function ensurePayoutWallet(
  supabase: SupabaseClient,
  businessId: string,
  family: PayoutWalletFamily = 'evm',
  createdBy: string | null = null
): Promise<{ address: string; created: boolean }> {
  const existing = await getPayoutWallet(supabase, businessId, family);
  if (existing) return { address: existing.address, created: false };

  const merchantId = await merchantIdForBusiness(businessId);
  if (!merchantId) throw new Error('Business not found');
  const wallet = ethers.Wallet.createRandom();
  // Throws VaultMissingError before anything is stored when there is no vault.
  const sealed = await sealForMerchant(merchantId, wallet.privateKey, payoutKeyAad(businessId, family, wallet.address));
  const { error } = await supabase.from('business_payout_wallets').insert({
    business_id: businessId,
    family,
    address: wallet.address,
    encrypted_private_key: sealed,
    seal_version: 2,
    created_by: createdBy,
  });
  if (error) {
    // Lost a race to a concurrent create: the winner's wallet stands.
    const raced = await getPayoutWallet(supabase, businessId, family);
    if (raced) return { address: raced.address, created: false };
    throw new Error(`Failed to create payout wallet: ${error.message}`);
  }
  return { address: wallet.address, created: true };
}

export function payoutKeyAad(businessId: string, family: PayoutWalletFamily, address: string): string {
  return `business_payout_wallets:${businessId}:${family}:${address.toLowerCase()}`;
}

/**
 * The payout wallet's private key, for signing one payout. Needs the merchant's
 * unlock (VaultLockedError / VaultMissingError otherwise). Drop the returned
 * string as soon as the transaction is signed.
 */
export async function openPayoutWalletKey(supabase: SupabaseClient, row: PayoutWalletRow): Promise<string> {
  const merchantId = await merchantIdForBusiness(row.business_id);
  if (!merchantId) throw new Error('Business not found');
  return openMerchantSecret({
    merchantId,
    stored: row.encrypted_private_key,
    aad: payoutKeyAad(row.business_id, row.family, row.address),
    legacyDecrypt: (v) => decrypt(v, requireEncryptionKey('payout')),
    persist: (sealed) =>
      Promise.resolve(supabase.from('business_payout_wallets').update({ encrypted_private_key: sealed, seal_version: 2 }).eq('id', row.id)),
  });
}
