import type { SupabaseClient } from '@supabase/supabase-js';
import { getCryptoPrice } from '../rates/tatum';
import { z } from 'zod';

/**
 * Supported blockchains
 */
export type Blockchain = 'BTC' | 'BCH' | 'ETH' | 'MATIC' | 'SOL' | 'USDC_ETH' | 'USDC_MATIC' | 'USDC_SOL';

/**
 * Validation schemas
 */
const blockchainSchema = z.enum(['BTC', 'BCH', 'ETH', 'MATIC', 'SOL', 'USDC_ETH', 'USDC_MATIC', 'USDC_SOL']);
const amountSchema = z.number().positive('Amount must be greater than zero');
const businessIdSchema = z.string().uuid('Invalid business ID');

/**
 * Types
 */
export interface CreatePaymentInput {
  business_id: string;
  amount: number;
  currency: string;
  blockchain: Blockchain;
  merchant_wallet_address: string;
  metadata?: Record<string, any>;
}

export interface Payment {
  id: string;
  business_id: string;
  amount: number;
  currency: string;
  blockchain: Blockchain;
  status: string;
  crypto_amount?: number;
  crypto_currency?: string;
  merchant_wallet_address: string;
  payment_address?: string;
  tx_hash?: string;
  confirmations?: number;
  metadata?: Record<string, any>;
  created_at: string;
  expires_at?: string;
}

export interface PaymentResult {
  success: boolean;
  payment?: Payment;
  error?: string;
}

export interface PaymentListResult {
  success: boolean;
  payments?: Payment[];
  error?: string;
}

/**
 * Create a new payment
 */
export async function createPayment(
  supabase: SupabaseClient,
  input: CreatePaymentInput
): Promise<PaymentResult> {
  try {
    // Validate amount first
    const amountResult = amountSchema.safeParse(input.amount);
    if (!amountResult.success) {
      return {
        success: false,
        error: amountResult.error.errors[0].message,
      };
    }

    // Validate blockchain
    const blockchainResult = blockchainSchema.safeParse(input.blockchain);
    if (!blockchainResult.success) {
      return {
        success: false,
        error: 'Invalid blockchain type',
      };
    }

    // Validate business ID
    const businessIdResult = businessIdSchema.safeParse(input.business_id);
    if (!businessIdResult.success) {
      return {
        success: false,
        error: businessIdResult.error.errors[0].message,
      };
    }

    // Calculate crypto amount
    const cryptoCurrency = input.blockchain.startsWith('USDC_') 
      ? 'USDC' 
      : input.blockchain;
    
    const cryptoAmount = await getCryptoPrice(
      input.amount,
      input.currency,
      cryptoCurrency
    );

    // Calculate expiration (1 hour from now)
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    // Insert payment
    const { data: payment, error } = await supabase
      .from('payments')
      .insert({
        business_id: input.business_id,
        amount: input.amount,
        currency: input.currency,
        blockchain: input.blockchain,
        status: 'pending',
        crypto_amount: cryptoAmount,
        crypto_currency: cryptoCurrency,
        merchant_wallet_address: input.merchant_wallet_address,
        metadata: input.metadata || {},
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error || !payment) {
      return {
        success: false,
        error: error?.message || 'Failed to create payment',
      };
    }

    return {
      success: true,
      payment: payment as Payment,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Payment creation failed',
    };
  }
}

/**
 * Get a payment by ID
 */
export async function getPayment(
  supabase: SupabaseClient,
  paymentId: string
): Promise<PaymentResult> {
  try {
    const { data: payment, error } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .single();

    if (error || !payment) {
      return {
        success: false,
        error: error?.message || 'Payment not found',
      };
    }

    return {
      success: true,
      payment: payment as Payment,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get payment',
    };
  }
}

/**
 * List payments for a business
 */
export async function listPayments(
  supabase: SupabaseClient,
  businessId: string
): Promise<PaymentListResult> {
  try {
    const { data: payments, error } = await supabase
      .from('payments')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      payments: (payments || []) as Payment[],
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list payments',
    };
  }
}