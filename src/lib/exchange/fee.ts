/**
 * CoinPay's swap fee.
 *
 * Same shape as CoinPay's payment fee (free tier pays double the paid tier):
 *   free tier  2%   (EXCHANGE_FEE_BPS_FREE, default 200)
 *   paid tier  1%   (EXCHANGE_FEE_BPS_PAID, default 100)
 * A wallet is paid tier when it is linked (wallet_account_links, which needs a
 * signed proof of control) to a merchant on a paid plan.
 *
 * Still non-custodial: the fee is taken off the amount being swapped, the
 * provider is quoted on the remainder, and the user's wallet makes two sends,
 * one to the provider and one straight to CoinPay's fee wallet for that asset
 * (PLATFORM_FEE_WALLET_<ASSET>, the same wallets payment commission lands in).
 * CoinPay never holds the swap itself.
 *
 * Off unless EXCHANGE_FEE_ENABLED=true. No fee wallet for an asset, or a fee
 * below that chain's dust floor, means no fee leg rather than a broken swap.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAsset } from './assets';
import { fromBaseUnits, toBaseUnits } from './decimal';
import { isPaidTier } from '@/lib/entitlements/service';

export interface SwapFee {
  /** Fee in whole units of the source asset. "0" when no fee applies. */
  amount: string;
  /** Amount left to swap after the fee. */
  netAmount: string;
  bps: number;
  /** Where the fee goes. Null when no fee applies. */
  address: string | null;
  tier: 'free' | 'paid';
}

/** Below these a fee output is dust or costs more to send than it is worth. */
const MIN_FEE: Record<string, string> = {
  BTC: '0.00001',
  BCH: '0.00001',
  DOGE: '1',
  XRP: '0.1',
  ADA: '1',
  SOL: '0.001',
};

function bpsEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  // Capped at 5%: a typo must never take a large slice of someone's swap.
  return Number.isInteger(n) && n >= 0 && n <= 500 ? n : fallback;
}

export function isFeeEnabled(): boolean {
  return process.env.EXCHANGE_FEE_ENABLED === 'true';
}

export function feeBpsFor(tier: 'free' | 'paid'): number {
  if (!isFeeEnabled()) return 0;
  return tier === 'paid' ? bpsEnv('EXCHANGE_FEE_BPS_PAID', 100) : bpsEnv('EXCHANGE_FEE_BPS_FREE', 200);
}

export function feeAddressFor(asset: string): string | null {
  return process.env[`PLATFORM_FEE_WALLET_${asset}`]?.trim() || null;
}

/** Exact integer math in the asset's base units; the fee rounds down. */
export function computeFee(amount: string, asset: string, tier: 'free' | 'paid'): SwapFee {
  const none: SwapFee = { amount: '0', netAmount: amount, bps: 0, address: null, tier };
  const info = getAsset(asset);
  const bps = feeBpsFor(tier);
  const address = feeAddressFor(asset);
  if (!info || bps === 0 || !address) return none;

  const units = toBaseUnits(amount, info.decimals);
  const feeUnits = (units * BigInt(bps)) / 10_000n;
  const floor = MIN_FEE[asset] ? toBaseUnits(MIN_FEE[asset], info.decimals) : 1n;
  if (feeUnits < floor || feeUnits >= units) return none;

  return {
    amount: fromBaseUnits(feeUnits, info.decimals),
    netAmount: fromBaseUnits(units - feeUnits, info.decimals),
    bps,
    address,
    tier,
  };
}

/** Paid tier if the wallet is linked to any merchant on a paid plan. */
export async function resolveWalletTier(supabase: SupabaseClient, walletId: string | null): Promise<'free' | 'paid'> {
  if (!walletId || !isFeeEnabled()) return 'free';
  try {
    const { data } = await supabase.from('wallet_account_links').select('merchant_id').eq('wallet_id', walletId);
    const merchants = [...new Set((data ?? []).map((r: { merchant_id: string }) => r.merchant_id))];
    for (const m of merchants) {
      if (await isPaidTier(supabase, m)) return 'paid';
    }
  } catch (e) {
    console.warn('[exchange] tier lookup failed, using free tier', e instanceof Error ? e.message : e);
  }
  return 'free';
}

/** gross - fee, exactly, in the asset's own decimals. */
export function netOfFee(gross: string, fee: string, asset: string): string {
  const d = getAsset(asset)?.decimals ?? 18;
  const net = toBaseUnits(gross, d) - toBaseUnits(fee, d);
  if (net <= 0n) throw new Error('Fee exceeds the amount');
  return fromBaseUnits(net, d);
}
