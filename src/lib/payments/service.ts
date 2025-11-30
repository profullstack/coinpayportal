import type { SupabaseClient } from '@supabase/supabase-js';
import { getCryptoPrice } from '../rates/tatum';
import { z } from 'zod';
import { generatePaymentAddress, type SystemBlockchain } from '../wallets/system-wallet';
import { ESTIMATED_NETWORK_FEES_USD, getEstimatedNetworkFee, getEstimatedNetworkFeeSync } from './network-fees';

// Re-export network fee utilities for backward compatibility
export { ESTIMATED_NETWORK_FEES_USD, getEstimatedNetworkFee, getEstimatedNetworkFeeSync };

/**
 * Supported blockchains
 */
export type Blockchain = 'BTC' | 'BCH' | 'ETH' | 'POL' | 'SOL' | 'USDC_ETH' | 'USDC_POL' | 'USDC_SOL';

/**
 * Payment expiration time in minutes
 * Users have 15 minutes to complete their payment
 */
export const PAYMENT_EXPIRATION_MINUTES = 15;

/**
 * Validation schemas
 */
const blockchainSchema = z.enum(['BTC', 'BCH', 'ETH', 'POL', 'SOL', 'USDC_ETH', 'USDC_POL', 'USDC_SOL']);
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
  merchant_wallet_address?: string; // Optional - will use platform wallet if not provided
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
  merchant_wallet_address?: string; // Optional - may use platform wallet
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
    
    // Add estimated network fee to the amount so merchant receives full amount after forwarding
    // Use dynamic fee estimation from Tatum API
    const networkFeeUsd = await getEstimatedNetworkFee(input.blockchain);
    const totalAmountUsd = input.amount + networkFeeUsd;
    
    const cryptoAmount = await getCryptoPrice(
      totalAmountUsd,
      input.currency,
      cryptoCurrency
    );
    
    console.log(`[Payment] Amount: $${input.amount}, Network fee: $${networkFeeUsd}, Total: $${totalAmountUsd}, Crypto: ${cryptoAmount} ${cryptoCurrency}`);

    // Calculate expiration (15 minutes from now)
    // Users must complete payment within this window
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + PAYMENT_EXPIRATION_MINUTES);

    // Build payment data - merchant_wallet_address is optional
    const paymentData: Record<string, any> = {
      business_id: input.business_id,
      amount: input.amount, // Original amount (without network fee)
      currency: input.currency,
      blockchain: input.blockchain,
      status: 'pending',
      crypto_amount: cryptoAmount, // Includes network fee
      crypto_currency: cryptoCurrency,
      metadata: {
        ...input.metadata,
        network_fee_usd: networkFeeUsd,
        total_amount_usd: totalAmountUsd,
      },
      expires_at: expiresAt.toISOString(),
    };
    
    // Only include merchant_wallet_address if provided
    if (input.merchant_wallet_address) {
      paymentData.merchant_wallet_address = input.merchant_wallet_address;
    }

    // Insert payment
    const { data: payment, error } = await supabase
      .from('payments')
      .insert(paymentData)
      .select()
      .single();

    if (error || !payment) {
      return {
        success: false,
        error: error?.message || 'Failed to create payment',
      };
    }

    // Generate a unique payment address using the system wallet
    // This is the address customers will pay to
    const baseBlockchain = input.blockchain.startsWith('USDC_')
      ? input.blockchain.replace('USDC_', '') as SystemBlockchain
      : input.blockchain as SystemBlockchain;
    
    // Only generate system wallet address for supported blockchains
    const supportedBlockchains: SystemBlockchain[] = ['BTC', 'BCH', 'ETH', 'POL', 'SOL'];
    if (supportedBlockchains.includes(baseBlockchain)) {
      const addressResult = await generatePaymentAddress(
        supabase,
        payment.id,
        input.business_id,
        baseBlockchain,
        input.merchant_wallet_address || '', // Merchant's wallet for forwarding
        cryptoAmount
      );

      if (!addressResult.success) {
        // Payment was created but address generation failed
        // Update payment status to indicate the issue
        await supabase
          .from('payments')
          .update({
            status: 'failed',
            metadata: {
              ...input.metadata,
              error: addressResult.error
            }
          })
          .eq('id', payment.id);

        return {
          success: false,
          error: `Payment created but address generation failed: ${addressResult.error}`,
        };
      }

      // Return payment with the generated address
      return {
        success: true,
        payment: {
          ...payment,
          payment_address: addressResult.address,
        } as Payment,
      };
    }

    // For unsupported blockchains, return without system wallet address
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

/**
 * Check if a payment has expired
 */
export function isPaymentExpired(payment: Payment): boolean {
  if (!payment.expires_at) return false;
  return new Date(payment.expires_at) < new Date();
}

/**
 * Get time remaining for a payment in seconds
 * Returns 0 if expired
 */
export function getPaymentTimeRemaining(payment: Payment): number {
  if (!payment.expires_at) return 0;
  const expiresAt = new Date(payment.expires_at);
  const now = new Date();
  const remaining = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  return remaining;
}

/**
 * Format time remaining as MM:SS
 */
export function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return '00:00';
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Expire a pending payment
 */
export async function expirePayment(
  supabase: SupabaseClient,
  paymentId: string
): Promise<PaymentResult> {
  try {
    const { data: payment, error } = await supabase
      .from('payments')
      .update({
        status: 'expired',
        updated_at: new Date().toISOString(),
      })
      .eq('id', paymentId)
      .eq('status', 'pending') // Only expire pending payments
      .select()
      .single();

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    if (!payment) {
      return {
        success: false,
        error: 'Payment not found or already processed',
      };
    }

    return {
      success: true,
      payment: payment as Payment,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to expire payment',
    };
  }
}

/**
 * Get payment with expiration status
 * Automatically marks expired payments
 */
export async function getPaymentWithExpirationCheck(
  supabase: SupabaseClient,
  paymentId: string
): Promise<PaymentResult> {
  try {
    const result = await getPayment(supabase, paymentId);
    
    if (!result.success || !result.payment) {
      return result;
    }

    // Check if payment should be expired
    if (result.payment.status === 'pending' && isPaymentExpired(result.payment)) {
      // Expire the payment
      const expireResult = await expirePayment(supabase, paymentId);
      if (expireResult.success && expireResult.payment) {
        return {
          success: true,
          payment: expireResult.payment,
        };
      }
    }

    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get payment',
    };
  }
}

/**
 * Batch expire all pending payments that have exceeded their time limit
 */
export async function batchExpirePayments(
  supabase: SupabaseClient
): Promise<{ success: boolean; expiredCount: number; error?: string }> {
  try {
    const now = new Date().toISOString();
    
    const { data, error } = await supabase
      .from('payments')
      .update({
        status: 'expired',
        updated_at: now,
      })
      .eq('status', 'pending')
      .lt('expires_at', now)
      .select('id');

    if (error) {
      return {
        success: false,
        expiredCount: 0,
        error: error.message,
      };
    }

    return {
      success: true,
      expiredCount: data?.length || 0,
    };
  } catch (error) {
    return {
      success: false,
      expiredCount: 0,
      error: error instanceof Error ? error.message : 'Failed to batch expire payments',
    };
  }
}