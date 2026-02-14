export interface Business {
  id: string;
  name: string;
  description: string | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  api_key: string | null;
  created_at: string;
}

export interface Wallet {
  id: string;
  business_id: string;
  cryptocurrency: string;
  wallet_address: string;
  is_active: boolean;
  created_at: string;
}

export type PaymentMode = 'crypto' | 'card';

export type TabType =
  | 'general'
  | 'wallets'
  | 'webhooks'
  | 'api-keys'
  | 'stripe'
  | 'stripe-connect'
  | 'stripe-transactions'
  | 'stripe-disputes'
  | 'stripe-payouts'
  | 'stripe-escrows'
  | 'stripe-webhooks'
  | 'stripe-api-keys';

export const SUPPORTED_CRYPTOS = [
  { value: 'BTC', label: 'Bitcoin (BTC)' },
  { value: 'BCH', label: 'Bitcoin Cash (BCH)' },
  { value: 'ETH', label: 'Ethereum (ETH)' },
  { value: 'POL', label: 'Polygon (POL)' },
  { value: 'SOL', label: 'Solana (SOL)' },
  { value: 'DOGE', label: 'Dogecoin (DOGE)' },
  { value: 'XRP', label: 'Ripple (XRP)' },
  { value: 'ADA', label: 'Cardano (ADA)' },
  { value: 'BNB', label: 'BNB Chain (BNB)' },
  { value: 'USDT', label: 'Tether (USDT)' },
  { value: 'USDC', label: 'USD Coin (USDC)' },
  { value: 'USDC_ETH', label: 'USDC (Ethereum)' },
  { value: 'USDC_POL', label: 'USDC (Polygon) — Low Fees' },
  { value: 'USDC_SOL', label: 'USDC (Solana) — Low Fees' },
];