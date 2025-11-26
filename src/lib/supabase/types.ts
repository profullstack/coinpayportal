// Database types for CoinPay

export type Blockchain =
  | 'btc'
  | 'bch'
  | 'eth'
  | 'matic'
  | 'sol'
  | 'usdc_eth'
  | 'usdc_matic'
  | 'usdc_sol';

export type PaymentStatus =
  | 'pending'
  | 'detected'
  | 'confirmed'
  | 'forwarding'
  | 'forwarded'
  | 'failed'
  | 'expired';

export type WebhookEvent =
  | 'payment.created'
  | 'payment.detected'
  | 'payment.confirmed'
  | 'payment.forwarding'
  | 'payment.forwarded'
  | 'payment.failed'
  | 'payment.expired';

export type EmailEventType =
  | 'payment.detected'
  | 'payment.confirmed'
  | 'payment.forwarded'
  | 'payment.failed';

export type EmailStatus = 'pending' | 'sent' | 'failed';

export interface Merchant {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Business {
  id: string;
  merchant_id: string;
  name: string;
  description: string | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  webhook_events: WebhookEvent[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaymentAddress {
  id: string;
  business_id: string;
  blockchain: Blockchain;
  address: string;
  private_key_encrypted: string;
  derivation_path: string;
  used: boolean;
  created_at: string;
  used_at: string | null;
}

export interface Payment {
  id: string;
  business_id: string;
  payment_address_id: string;
  amount: string;
  currency: string;
  blockchain: Blockchain;
  status: PaymentStatus;
  crypto_amount: string | null;
  crypto_currency: string | null;
  customer_paid_amount: string | null;
  merchant_received_amount: string | null;
  fee_amount: string | null;
  tx_hash: string | null;
  forward_tx_hash: string | null;
  confirmations: number;
  merchant_wallet_address: string;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  detected_at: string | null;
  confirmed_at: string | null;
  forwarded_at: string | null;
  expires_at: string;
}

export interface WebhookLog {
  id: string;
  business_id: string;
  payment_id: string;
  event: WebhookEvent;
  url: string;
  payload: Record<string, any>;
  response_status: number | null;
  response_body: string | null;
  attempt: number;
  created_at: string;
  next_retry_at: string | null;
}

export interface MerchantSettings {
  merchant_id: string;
  notifications_enabled: boolean;
  email_notifications: boolean;
  web_notifications: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmailQueue {
  id: string;
  merchant_id: string;
  payment_id: string | null;
  event_type: EmailEventType;
  recipient_email: string;
  subject: string;
  html_body: string;
  status: EmailStatus;
  attempts: number;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
  next_retry_at: string | null;
}

// Database schema type
export interface Database {
  public: {
    Tables: {
      merchants: {
        Row: Merchant;
        Insert: Omit<Merchant, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Merchant, 'id' | 'created_at'>>;
      };
      businesses: {
        Row: Business;
        Insert: Omit<Business, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Business, 'id' | 'created_at'>>;
      };
      payment_addresses: {
        Row: PaymentAddress;
        Insert: Omit<PaymentAddress, 'id' | 'created_at' | 'used_at'>;
        Update: Partial<Omit<PaymentAddress, 'id' | 'created_at'>>;
      };
      payments: {
        Row: Payment;
        Insert: Omit<
          Payment,
          'id' | 'created_at' | 'updated_at' | 'detected_at' | 'confirmed_at' | 'forwarded_at'
        >;
        Update: Partial<Omit<Payment, 'id' | 'created_at'>>;
      };
      webhook_logs: {
        Row: WebhookLog;
        Insert: Omit<WebhookLog, 'id' | 'created_at'>;
        Update: Partial<Omit<WebhookLog, 'id' | 'created_at'>>;
      };
      merchant_settings: {
        Row: MerchantSettings;
        Insert: Omit<MerchantSettings, 'created_at' | 'updated_at'>;
        Update: Partial<Omit<MerchantSettings, 'merchant_id' | 'created_at'>>;
      };
      email_queue: {
        Row: EmailQueue;
        Insert: Omit<EmailQueue, 'id' | 'created_at'>;
        Update: Partial<Omit<EmailQueue, 'id' | 'created_at'>>;
      };
    };
  };
}