import type { SupabaseClient } from '@supabase/supabase-js';

export const CRYPTO_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  BCH: 'Bitcoin Cash',
  ETH: 'Ethereum',
  POL: 'Polygon',
  SOL: 'Solana',
  USDT: 'Tether',
  USDT_ETH: 'Tether (Ethereum)',
  USDT_POL: 'Tether (Polygon)',
  USDT_SOL: 'Tether (Solana)',
  USDC: 'USD Coin',
  USDC_ETH: 'USD Coin (Ethereum)',
  USDC_POL: 'USD Coin (Polygon)',
  USDC_SOL: 'USD Coin (Solana)',
  BNB: 'BNB',
  XRP: 'XRP',
  ADA: 'Cardano',
  DOGE: 'Dogecoin',
};

const TOKEN_CHAIN_NAMES: Record<string, string> = {
  ETH: 'Ethereum',
  POL: 'Polygon',
  SOL: 'Solana',
  BSC: 'BNB Chain',
};

export type WalletSource = 'business' | 'merchant_global';

export interface WalletRecord {
  cryptocurrency: string;
  wallet_address: string;
  is_active: boolean;
  source?: WalletSource;
}

export interface SupportedCoin {
  symbol: string;
  name: string;
  is_active: boolean;
  has_wallet: boolean;
  wallet_source: WalletSource;
}

export interface SupportedToken extends SupportedCoin {
  code: string;
  ticker: string;
  chain?: string;
}

export interface BusinessAccessResult {
  ok: boolean;
  error?: string;
  status?: number;
}

export function getCryptoName(symbol: string): string {
  return CRYPTO_NAMES[symbol] || symbol;
}

export function parseTokenSymbol(symbol: string, name = getCryptoName(symbol)): { ticker: string; chain?: string } {
  const match = symbol.match(/^([A-Z]+)_([A-Z]+)$/);
  if (match) {
    return {
      ticker: match[1],
      chain: TOKEN_CHAIN_NAMES[match[2]] ?? match[2],
    };
  }
  const paren = name.match(/\(([^)]+)\)/);
  return { ticker: symbol, chain: paren?.[1] };
}

export function walletToSupportedCoin(wallet: WalletRecord): SupportedCoin {
  return {
    symbol: wallet.cryptocurrency,
    name: getCryptoName(wallet.cryptocurrency),
    is_active: wallet.is_active,
    has_wallet: true,
    wallet_source: wallet.source ?? 'business',
  };
}

export function coinToSupportedToken(coin: SupportedCoin): SupportedToken {
  const { ticker, chain } = parseTokenSymbol(coin.symbol, coin.name);
  return {
    ...coin,
    code: coin.symbol.toLowerCase(),
    ticker,
    chain,
  };
}

export async function verifyBusinessAccess(
  supabase: SupabaseClient,
  businessId: string,
  merchantId: string,
): Promise<BusinessAccessResult> {
  const { data: business, error } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .eq('merchant_id', merchantId)
    .single();

  if (error || !business) {
    return { ok: false, error: 'Business not found or access denied', status: 404 };
  }

  return { ok: true };
}

export async function getSupportedWalletsForBusiness(
  supabase: SupabaseClient,
  businessId: string,
  merchantId: string,
  activeOnly = false,
): Promise<{ wallets?: WalletRecord[]; error?: string }> {
  let businessQuery = supabase
    .from('business_wallets')
    .select('cryptocurrency, wallet_address, is_active')
    .eq('business_id', businessId)
    .order('cryptocurrency', { ascending: true });

  if (activeOnly) {
    businessQuery = businessQuery.eq('is_active', true);
  }

  const { data: businessWallets, error: businessError } = await businessQuery;
  if (businessError) {
    return { error: businessError.message };
  }

  let globalQuery = supabase
    .from('merchant_wallets')
    .select('cryptocurrency, wallet_address, is_active')
    .eq('merchant_id', merchantId)
    .order('cryptocurrency', { ascending: true });

  if (activeOnly) {
    globalQuery = globalQuery.eq('is_active', true);
  }

  const { data: globalWallets, error: globalError } = await globalQuery;
  if (globalError) {
    return { error: globalError.message };
  }

  const merged = new Map<string, WalletRecord>();
  for (const wallet of businessWallets ?? []) {
    merged.set(wallet.cryptocurrency, {
      ...(wallet as WalletRecord),
      source: 'business',
    });
  }
  for (const wallet of globalWallets ?? []) {
    if (!merged.has(wallet.cryptocurrency)) {
      merged.set(wallet.cryptocurrency, {
        ...(wallet as WalletRecord),
        source: 'merchant_global',
      });
    }
  }

  return {
    wallets: Array.from(merged.values()).sort((a, b) =>
      a.cryptocurrency.localeCompare(b.cryptocurrency),
    ),
  };
}

export async function getPaymentReceivingWallet(
  supabase: SupabaseClient,
  input: {
    businessId: string;
    merchantId: string;
    cryptocurrency: string;
  },
): Promise<{ walletAddress?: string; source?: WalletSource; error?: string }> {
  const { data: businessWallet, error: businessError } = await supabase
    .from('business_wallets')
    .select('wallet_address')
    .eq('business_id', input.businessId)
    .eq('cryptocurrency', input.cryptocurrency)
    .eq('is_active', true)
    .single();

  if (businessWallet?.wallet_address) {
    return { walletAddress: businessWallet.wallet_address, source: 'business' };
  }

  if (businessError && businessError.code && businessError.code !== 'PGRST116') {
    return { error: businessError.message };
  }

  const { data: globalWallet, error: globalError } = await supabase
    .from('merchant_wallets')
    .select('wallet_address')
    .eq('merchant_id', input.merchantId)
    .eq('cryptocurrency', input.cryptocurrency)
    .eq('is_active', true)
    .single();

  if (globalWallet?.wallet_address) {
    return { walletAddress: globalWallet.wallet_address, source: 'merchant_global' };
  }

  if (globalError && globalError.code && globalError.code !== 'PGRST116') {
    return { error: globalError.message };
  }

  return { error: `No ${input.cryptocurrency} wallet configured for this business or merchant global wallet.` };
}
