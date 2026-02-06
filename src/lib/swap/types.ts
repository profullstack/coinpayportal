/**
 * Swap types for SideShift.ai integration
 */

export interface SideshiftCoin {
  coin: string;
  networks: string[];
  name: string;
  hasMemo: boolean;
}

export interface SideshiftPair {
  min: string;
  max: string;
  rate: string;
  depositCoin: string;
  depositNetwork: string;
  settleCoin: string;
  settleNetwork: string;
}

export interface QuoteRequest {
  depositCoin: string;
  depositNetwork: string;
  settleCoin: string;
  settleNetwork: string;
  depositAmount?: string;
  settleAmount?: string;
  affiliateId?: string;
}

export interface QuoteResponse {
  id?: string;
  createdAt?: string;
  depositCoin: string;
  depositNetwork: string;
  settleCoin: string;
  settleNetwork: string;
  depositAmount: string;
  settleAmount: string;
  rate: string;
  expiresAt?: string;
  minAmount?: number;
}

export interface ShiftRequest {
  quoteId: string;
  settleAddress: string;
  refundAddress?: string;
  affiliateId?: string;
}

export interface ShiftResponse {
  id: string;
  createdAt: string;
  depositCoin: string;
  depositNetwork: string;
  depositAddress: string;
  depositMin?: string;
  depositMax?: string;
  depositAmount: string;
  settleCoin: string;
  settleNetwork: string;
  settleAddress: string;
  settleAmount: string;
  status: ShiftStatus | string;
  expiresAt?: string;
}

export type ShiftStatus = 
  | 'pending'      // Waiting for deposit
  | 'processing'   // Deposit received, processing
  | 'review'       // Manual review
  | 'settling'     // Sending to settle address
  | 'settled'      // Complete
  | 'refund'       // Refunding
  | 'refunded'     // Refund complete
  | 'expired';     // Timed out

export interface SwapQuoteParams {
  from: string;
  fromNetwork?: string;
  to: string;
  toNetwork?: string;
  amount: string;
  amountType?: 'deposit' | 'settle';
}

export interface SwapCreateParams {
  quoteId: string;
  settleAddress: string;
  refundAddress?: string;
}

// Mapping our coin symbols to swap provider format
// Will be adapted based on chosen provider (ChangeNOW, etc.)
export const COIN_NETWORK_MAP: Record<string, { coin: string; network: string }> = {
  'BTC': { coin: 'btc', network: 'bitcoin' },
  'BCH': { coin: 'bch', network: 'bitcoincash' },
  'ETH': { coin: 'eth', network: 'ethereum' },
  'POL': { coin: 'matic', network: 'polygon' },
  'SOL': { coin: 'sol', network: 'solana' },
  'BNB': { coin: 'bnb', network: 'bsc' },
  'DOGE': { coin: 'doge', network: 'dogecoin' },
  'XRP': { coin: 'xrp', network: 'ripple' },
  'ADA': { coin: 'ada', network: 'cardano' },
  'USDT': { coin: 'usdt', network: 'ethereum' },
  'USDC': { coin: 'usdc', network: 'ethereum' },
  'USDC_ETH': { coin: 'usdc', network: 'ethereum' },
  'USDC_POL': { coin: 'usdc', network: 'polygon' },
  'USDC_SOL': { coin: 'usdc', network: 'solana' },
};
