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

export type TabType = 'general' | 'wallets' | 'webhooks' | 'api-keys';

export const SUPPORTED_CRYPTOS = [
  { value: 'BTC', label: 'Bitcoin (BTC)' },
  { value: 'BCH', label: 'Bitcoin Cash (BCH)' },
  { value: 'ETH', label: 'Ethereum (ETH)' },
  { value: 'USDT', label: 'Tether (USDT)' },
  { value: 'USDC', label: 'USD Coin (USDC)' },
  { value: 'BNB', label: 'Binance Coin (BNB)' },
  { value: 'SOL', label: 'Solana (SOL)' },
  { value: 'XRP', label: 'Ripple (XRP)' },
  { value: 'ADA', label: 'Cardano (ADA)' },
  { value: 'DOGE', label: 'Dogecoin (DOGE)' },
  { value: 'POL', label: 'Polygon (POL)' },
];