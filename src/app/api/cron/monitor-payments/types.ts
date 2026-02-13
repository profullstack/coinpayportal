/**
 * Shared types for the monitor-payments cron job
 */

export interface Payment {
  id: string;
  business_id: string;
  blockchain: string;
  crypto_amount: number;
  status: string;
  payment_address: string;
  created_at: string;
  expires_at: string;
  merchant_wallet_address: string;
}

export interface MonitorStats {
  checked: number;
  confirmed: number;
  expired: number;
  errors: number;
}

export interface EscrowStats {
  checked: number;
  funded: number;
  expired: number;
  errors: number;
}
