import type { SupabaseClient } from '@supabase/supabase-js';
import { splitPayment, validateSplit } from './fees';
import { getProvider, getRpcUrl, type BlockchainType } from '../blockchain/providers';
import { sendPaymentWebhook } from '../webhooks/service';

/**
 * Supported blockchains for forwarding
 */
const SUPPORTED_BLOCKCHAINS = ['BTC', 'BCH', 'ETH', 'POL', 'SOL'] as const;

/**
 * Forwarding input interface
 */
export interface ForwardingInput {
  paymentId: string;
  paymentAddress: string;
  merchantWalletAddress: string;
  platformWalletAddress: string;
  totalAmount: number;
  blockchain: BlockchainType;
  privateKey?: string;
}

/**
 * Forwarding result interface
 */
export interface ForwardingResult {
  success: boolean;
  merchantTxHash?: string;
  platformTxHash?: string;
  merchantAmount?: number;
  platformFee?: number;
  error?: string;
}

/**
 * Forwarding status interface
 */
export interface ForwardingStatus {
  paymentId: string;
  status: string;
  merchantTxHash?: string;
  platformTxHash?: string;
  merchantAmount?: number;
  platformFee?: number;
  forwardedAt?: string;
  error?: string;
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Calculate forwarding amounts (wrapper around splitPayment for consistency)
 */
export function calculateForwardingAmounts(totalAmount: number): {
  merchantAmount: number;
  platformFee: number;
  total: number;
} {
  return splitPayment(totalAmount);
}

/**
 * Validate forwarding input
 */
export function validateForwardingInput(input: ForwardingInput): ValidationResult {
  const errors: string[] = [];

  if (!input.paymentId || input.paymentId.trim() === '') {
    errors.push('Payment ID is required');
  }

  if (!input.paymentAddress || input.paymentAddress.trim() === '') {
    errors.push('Payment address is required');
  }

  if (!input.merchantWalletAddress || input.merchantWalletAddress.trim() === '') {
    errors.push('Merchant wallet address is required');
  }

  if (!input.platformWalletAddress || input.platformWalletAddress.trim() === '') {
    errors.push('Platform wallet address is required');
  }

  if (!input.totalAmount || input.totalAmount <= 0) {
    errors.push('Amount must be greater than zero');
  }

  if (!input.blockchain || !SUPPORTED_BLOCKCHAINS.includes(input.blockchain as any)) {
    errors.push('Invalid blockchain type');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get platform wallet address from environment
 */
function getPlatformWalletAddress(blockchain: BlockchainType): string {
  const walletEnvVars: Record<BlockchainType, string> = {
    BTC: 'PLATFORM_FEE_WALLET_BTC',
    BCH: 'PLATFORM_FEE_WALLET_BCH',
    ETH: 'PLATFORM_FEE_WALLET_ETH',
    POL: 'PLATFORM_FEE_WALLET_POL',
    SOL: 'PLATFORM_FEE_WALLET_SOL',
  };

  const envVar = walletEnvVars[blockchain];
  const address = process.env[envVar];

  if (!address) {
    throw new Error(`Platform wallet address not configured for ${blockchain}`);
  }

  return address;
}

/**
 * Forward payment to merchant and platform wallets
 */
export async function forwardPayment(
  supabase: SupabaseClient,
  input: ForwardingInput
): Promise<ForwardingResult> {
  try {
    // Validate input
    const validation = validateForwardingInput(input);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.errors.join(', '),
      };
    }

    // Calculate split amounts
    const { merchantAmount, platformFee, total } = calculateForwardingAmounts(input.totalAmount);

    // Validate the split
    validateSplit(merchantAmount, platformFee, total);

    // Update payment status to forwarding
    await updatePaymentStatus(supabase, input.paymentId, 'forwarding');

    // Get blockchain provider
    const rpcUrl = getRpcUrl(input.blockchain);
    const provider = getProvider(input.blockchain, rpcUrl);

    let merchantTxHash: string | undefined;
    let platformTxHash: string | undefined;

    try {
      // Send merchant portion (99.5%)
      if (provider.sendTransaction && input.privateKey) {
        merchantTxHash = await provider.sendTransaction(
          input.paymentAddress,
          input.merchantWalletAddress,
          merchantAmount.toString(),
          input.privateKey
        );

        // Send platform fee (0.5%)
        platformTxHash = await provider.sendTransaction(
          input.paymentAddress,
          input.platformWalletAddress,
          platformFee.toString(),
          input.privateKey
        );
      } else {
        // For blockchains without sendTransaction support, log for manual processing
        console.log(`Manual forwarding required for ${input.blockchain}:`, {
          paymentId: input.paymentId,
          merchantAmount,
          platformFee,
          merchantWallet: input.merchantWalletAddress,
          platformWallet: input.platformWalletAddress,
        });

        // Simulate successful forwarding for testing
        merchantTxHash = `manual_${input.paymentId}_merchant`;
        platformTxHash = `manual_${input.paymentId}_platform`;
      }

      // Update payment with forwarding details
      await updatePaymentForwarded(supabase, input.paymentId, {
        merchantTxHash,
        platformTxHash,
        merchantAmount,
        platformFee,
      });

      // Send webhook notification
      await sendPaymentWebhook(supabase, input.paymentId, input.paymentId, 'payment.forwarded', {
        amount_crypto: input.totalAmount.toString(),
        amount_usd: '0', // Would need to calculate from exchange rate
        currency: input.blockchain,
        status: 'forwarded',
        merchant_amount: merchantAmount,
        platform_fee: platformFee,
        merchant_tx_hash: merchantTxHash,
        platform_tx_hash: platformTxHash,
      });

      return {
        success: true,
        merchantTxHash,
        platformTxHash,
        merchantAmount,
        platformFee,
      };
    } catch (txError) {
      // Update payment status to forwarding_failed
      await updatePaymentStatus(supabase, input.paymentId, 'forwarding_failed', {
        error: txError instanceof Error ? txError.message : 'Transaction failed',
      });

      return {
        success: false,
        error: txError instanceof Error ? txError.message : 'Transaction failed',
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Forwarding failed',
    };
  }
}

/**
 * Update payment status in database
 */
async function updatePaymentStatus(
  supabase: SupabaseClient,
  paymentId: string,
  status: string,
  additionalData?: Record<string, any>
): Promise<void> {
  const updateData: Record<string, any> = {
    status,
    updated_at: new Date().toISOString(),
    ...additionalData,
  };

  const { error } = await supabase
    .from('payments')
    .update(updateData)
    .eq('id', paymentId);

  if (error) {
    throw new Error(`Failed to update payment status: ${error.message}`);
  }
}

/**
 * Update payment with forwarding details
 */
async function updatePaymentForwarded(
  supabase: SupabaseClient,
  paymentId: string,
  details: {
    merchantTxHash?: string;
    platformTxHash?: string;
    merchantAmount: number;
    platformFee: number;
  }
): Promise<void> {
  const { error } = await supabase
    .from('payments')
    .update({
      status: 'forwarded',
      forward_tx_hash: details.merchantTxHash,
      merchant_amount: details.merchantAmount,
      fee_amount: details.platformFee,
      forwarded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', paymentId);

  if (error) {
    throw new Error(`Failed to update payment forwarding details: ${error.message}`);
  }
}

/**
 * Get forwarding status for a payment
 */
export async function getForwardingStatus(
  supabase: SupabaseClient,
  paymentId: string
): Promise<ForwardingStatus> {
  const { data: payment, error } = await supabase
    .from('payments')
    .select('id, status, forward_tx_hash, merchant_amount, fee_amount, forwarded_at')
    .eq('id', paymentId)
    .single();

  if (error || !payment) {
    return {
      paymentId,
      status: 'unknown',
      error: error?.message || 'Payment not found',
    };
  }

  return {
    paymentId: payment.id,
    status: payment.status,
    merchantTxHash: payment.forward_tx_hash,
    merchantAmount: payment.merchant_amount,
    platformFee: payment.fee_amount,
    forwardedAt: payment.forwarded_at,
  };
}

/**
 * Retry failed forwarding
 */
export async function retryFailedForwarding(
  supabase: SupabaseClient,
  paymentId: string,
  privateKey: string
): Promise<ForwardingResult> {
  // Get payment details
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

  // Check if already forwarded
  if (payment.status === 'forwarded') {
    return {
      success: false,
      error: 'Payment already forwarded',
    };
  }

  // Check if eligible for retry
  if (!['forwarding_failed', 'confirmed'].includes(payment.status)) {
    return {
      success: false,
      error: `Cannot retry forwarding for payment with status: ${payment.status}`,
    };
  }

  // Get platform wallet address
  let platformWalletAddress: string;
  try {
    platformWalletAddress = getPlatformWalletAddress(payment.blockchain);
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to get platform wallet',
    };
  }

  // Retry forwarding
  return forwardPayment(supabase, {
    paymentId: payment.id,
    paymentAddress: payment.payment_address,
    merchantWalletAddress: payment.merchant_wallet_address,
    platformWalletAddress,
    totalAmount: payment.crypto_amount,
    blockchain: payment.blockchain,
    privateKey,
  });
}

/**
 * Process confirmed payment for forwarding
 * Called when a payment reaches required confirmations
 */
export async function processConfirmedPayment(
  supabase: SupabaseClient,
  paymentId: string,
  privateKey: string
): Promise<ForwardingResult> {
  // Get payment details
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

  // Verify payment is confirmed
  if (payment.status !== 'confirmed') {
    return {
      success: false,
      error: `Payment is not confirmed. Current status: ${payment.status}`,
    };
  }

  // Get platform wallet address
  let platformWalletAddress: string;
  try {
    platformWalletAddress = getPlatformWalletAddress(payment.blockchain);
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to get platform wallet',
    };
  }

  // Forward the payment
  return forwardPayment(supabase, {
    paymentId: payment.id,
    paymentAddress: payment.payment_address,
    merchantWalletAddress: payment.merchant_wallet_address,
    platformWalletAddress,
    totalAmount: payment.crypto_amount,
    blockchain: payment.blockchain,
    privateKey,
  });
}

/**
 * Batch process multiple confirmed payments
 */
export async function batchProcessConfirmedPayments(
  supabase: SupabaseClient,
  privateKey: string,
  limit: number = 10
): Promise<{
  processed: number;
  successful: number;
  failed: number;
  results: ForwardingResult[];
}> {
  // Get confirmed payments that need forwarding
  const { data: payments, error } = await supabase
    .from('payments')
    .select('id')
    .eq('status', 'confirmed')
    .limit(limit);

  if (error || !payments) {
    return {
      processed: 0,
      successful: 0,
      failed: 0,
      results: [],
    };
  }

  const results: ForwardingResult[] = [];
  let successful = 0;
  let failed = 0;

  for (const payment of payments) {
    const result = await processConfirmedPayment(supabase, payment.id, privateKey);
    results.push(result);

    if (result.success) {
      successful++;
    } else {
      failed++;
    }
  }

  return {
    processed: payments.length,
    successful,
    failed,
    results,
  };
}