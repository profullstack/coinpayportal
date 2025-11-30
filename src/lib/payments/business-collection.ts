/**
 * Business Payment Collection Service
 * 
 * This service handles collecting payments from business users (subscription fees, etc.)
 * by creating payment forward addresses that send 100% of funds to platform wallets
 * configured in environment variables.
 * 
 * Unlike regular merchant payments (which split 99.5%/0.5%), business collection
 * payments forward the entire amount to the platform's wallet addresses.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getProvider, getRpcUrl, type BlockchainType } from '../blockchain/providers';
import { generatePaymentAddress } from '../blockchain/wallets';
import { deliverWebhook, logWebhookAttempt, retryFailedWebhook } from '../webhooks/service';
import { decrypt } from '../crypto/encryption';

/**
 * Supported blockchains for business collection
 */
const SUPPORTED_BLOCKCHAINS = ['BTC', 'BCH', 'ETH', 'POL', 'SOL'] as const;

/**
 * Environment variable mapping for platform collection wallets
 */
const COLLECTION_WALLET_ENV_VARS: Record<BlockchainType, string> = {
  BTC: 'PLATFORM_FEE_WALLET_BTC',
  BCH: 'PLATFORM_FEE_WALLET_BCH',
  ETH: 'PLATFORM_FEE_WALLET_ETH',
  POL: 'PLATFORM_FEE_WALLET_POL',
  SOL: 'PLATFORM_FEE_WALLET_SOL',
};

/**
 * Business collection payment input
 */
export interface BusinessCollectionInput {
  businessId: string;
  merchantId: string;
  amount: number;
  currency: string;
  blockchain: BlockchainType;
  description?: string;
  metadata?: Record<string, any>;
}

/**
 * Business collection payment result
 */
export interface BusinessCollectionPayment {
  id: string;
  businessId: string;
  merchantId: string;
  paymentAddress: string;
  amount: number;
  currency: string;
  blockchain: BlockchainType;
  destinationWallet: string;
  status: string;
  description?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  expiresAt: string;
}

/**
 * Business collection result
 */
export interface BusinessCollectionResult {
  success: boolean;
  payment?: BusinessCollectionPayment;
  error?: string;
}

/**
 * Forwarding result for business collection
 */
export interface BusinessCollectionForwardingResult {
  success: boolean;
  txHash?: string;
  amount?: number;
  error?: string;
}

/**
 * Get platform collection wallet address from environment
 */
export function getCollectionWalletAddress(blockchain: BlockchainType): string {
  const envVar = COLLECTION_WALLET_ENV_VARS[blockchain];
  const address = process.env[envVar];

  if (!address) {
    throw new Error(`Collection wallet address not configured for ${blockchain}. Set ${envVar} in environment.`);
  }

  return address;
}

/**
 * Validate blockchain type
 */
export function isValidBlockchain(blockchain: string): blockchain is BlockchainType {
  return SUPPORTED_BLOCKCHAINS.includes(blockchain as any);
}

/**
 * Validate business collection input
 */
export function validateBusinessCollectionInput(input: BusinessCollectionInput): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!input.businessId || input.businessId.trim() === '') {
    errors.push('Business ID is required');
  }

  if (!input.merchantId || input.merchantId.trim() === '') {
    errors.push('Merchant ID is required');
  }

  if (!input.amount || input.amount <= 0) {
    errors.push('Amount must be greater than zero');
  }

  if (!input.currency || input.currency.trim() === '') {
    errors.push('Currency is required');
  }

  if (!input.blockchain || !isValidBlockchain(input.blockchain)) {
    errors.push(`Invalid blockchain. Must be one of: ${SUPPORTED_BLOCKCHAINS.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create a business collection payment
 * 
 * This creates a payment that will forward 100% of received funds
 * to the platform's collection wallet for the specified blockchain.
 */
export async function createBusinessCollectionPayment(
  supabase: SupabaseClient,
  input: BusinessCollectionInput
): Promise<BusinessCollectionResult> {
  try {
    // Validate input
    const validation = validateBusinessCollectionInput(input);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.errors.join(', '),
      };
    }

    // Get the destination wallet address from environment
    let destinationWallet: string;
    try {
      destinationWallet = getCollectionWalletAddress(input.blockchain);
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Failed to get collection wallet',
      };
    }

    // Verify business exists and belongs to merchant
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id, name')
      .eq('id', input.businessId)
      .eq('merchant_id', input.merchantId)
      .single();

    if (businessError || !business) {
      return {
        success: false,
        error: 'Business not found or access denied',
      };
    }

    // Calculate expiration (24 hours for business payments)
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    // Create the payment record
    // Note: payment_address will be generated by the blockchain provider
    // For now, we'll use a placeholder that indicates this is a collection payment
    const { data: payment, error: paymentError } = await supabase
      .from('business_collection_payments')
      .insert({
        business_id: input.businessId,
        merchant_id: input.merchantId,
        amount: input.amount,
        currency: input.currency,
        blockchain: input.blockchain,
        destination_wallet: destinationWallet,
        status: 'pending',
        description: input.description,
        metadata: input.metadata || {},
        expires_at: expiresAt.toISOString(),
        forward_percentage: 100, // 100% forwarding
      })
      .select()
      .single();

    if (paymentError || !payment) {
      return {
        success: false,
        error: paymentError?.message || 'Failed to create collection payment',
      };
    }

    // Generate payment address using wallet service
    const paymentAddressResult = await generatePaymentAddress(
      `collection_${payment.id}`,
      input.blockchain
    );
    
    const paymentAddress = paymentAddressResult.address;
    
    // Update payment with generated address and encrypted private key
    await supabase
      .from('business_collection_payments')
      .update({
        payment_address: paymentAddress,
        private_key_encrypted: paymentAddressResult.encryptedPrivateKey,
      })
      .eq('id', payment.id);

    return {
      success: true,
      payment: {
        id: payment.id,
        businessId: payment.business_id,
        merchantId: payment.merchant_id,
        paymentAddress,
        amount: payment.amount,
        currency: payment.currency,
        blockchain: payment.blockchain,
        destinationWallet,
        status: payment.status,
        description: payment.description,
        metadata: payment.metadata,
        createdAt: payment.created_at,
        expiresAt: payment.expires_at,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create collection payment',
    };
  }
}

/**
 * Forward a confirmed business collection payment securely
 *
 * This forwards 100% of the received amount to the platform's collection wallet.
 * Private keys are retrieved from encrypted storage - NEVER passed via API.
 */
export async function forwardBusinessCollectionPaymentSecurely(
  supabase: SupabaseClient,
  paymentId: string
): Promise<BusinessCollectionForwardingResult> {
  try {
    // Get payment details
    const { data: payment, error: paymentError } = await supabase
      .from('business_collection_payments')
      .select('*')
      .eq('id', paymentId)
      .single();

    if (paymentError || !payment) {
      return {
        success: false,
        error: paymentError?.message || 'Payment not found',
      };
    }

    // Verify payment is confirmed
    if (payment.status !== 'confirmed') {
      return {
        success: false,
        error: `Payment is not confirmed. Current status: ${payment.status}`,
      };
    }

    // Get and decrypt the private key securely
    if (!payment.private_key_encrypted) {
      return {
        success: false,
        error: 'No encrypted private key found for this payment',
      };
    }

    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      return {
        success: false,
        error: 'Encryption key not configured',
      };
    }

    let privateKey: string;
    try {
      privateKey = decrypt(payment.private_key_encrypted, encryptionKey);
    } catch (decryptError) {
      console.error(`[SECURE] Failed to decrypt private key for business collection ${paymentId}`);
      return {
        success: false,
        error: 'Failed to decrypt private key',
      };
    }

    // Get blockchain provider
    const rpcUrl = getRpcUrl(payment.blockchain);
    const provider = getProvider(payment.blockchain, rpcUrl);

    let txHash: string | undefined;

    try {
      // Update status to forwarding
      await supabase
        .from('business_collection_payments')
        .update({ status: 'forwarding' })
        .eq('id', paymentId);

      // Forward 100% of the amount to destination wallet
      if (provider.sendTransaction) {
        txHash = await provider.sendTransaction(
          payment.payment_address,
          payment.destination_wallet,
          payment.crypto_amount.toString(),
          privateKey
        );
      } else {
        // Log for manual processing
        console.log(`Manual forwarding required for business collection ${paymentId}:`, {
          from: payment.payment_address,
          to: payment.destination_wallet,
          amount: payment.crypto_amount,
          blockchain: payment.blockchain,
        });
        txHash = `manual_collection_${paymentId}`;
      }

      // Update payment with forwarding details
      await supabase
        .from('business_collection_payments')
        .update({
          status: 'forwarded',
          forward_tx_hash: txHash,
          forwarded_at: new Date().toISOString(),
        })
        .eq('id', paymentId);

      // Send webhook notification for business collection
      await sendBusinessCollectionWebhook(
        supabase,
        payment.business_id,
        paymentId,
        'business_collection.forwarded',
        {
          amount: payment.amount,
          currency: payment.currency,
          crypto_amount: payment.crypto_amount,
          blockchain: payment.blockchain,
          tx_hash: txHash,
          destination_wallet: payment.destination_wallet,
        }
      );

      return {
        success: true,
        txHash,
        amount: payment.crypto_amount,
      };
    } catch (txError) {
      // Update status to forwarding_failed
      await supabase
        .from('business_collection_payments')
        .update({
          status: 'forwarding_failed',
          error_message: txError instanceof Error ? txError.message : 'Transaction failed',
        })
        .eq('id', paymentId);

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
 * Get business collection payment by ID
 */
export async function getBusinessCollectionPayment(
  supabase: SupabaseClient,
  paymentId: string,
  merchantId?: string
): Promise<BusinessCollectionResult> {
  try {
    let query = supabase
      .from('business_collection_payments')
      .select('*')
      .eq('id', paymentId);

    if (merchantId) {
      query = query.eq('merchant_id', merchantId);
    }

    const { data: payment, error } = await query.single();

    if (error || !payment) {
      return {
        success: false,
        error: error?.message || 'Payment not found',
      };
    }

    return {
      success: true,
      payment: {
        id: payment.id,
        businessId: payment.business_id,
        merchantId: payment.merchant_id,
        paymentAddress: payment.payment_address,
        amount: payment.amount,
        currency: payment.currency,
        blockchain: payment.blockchain,
        destinationWallet: payment.destination_wallet,
        status: payment.status,
        description: payment.description,
        metadata: payment.metadata,
        createdAt: payment.created_at,
        expiresAt: payment.expires_at,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get payment',
    };
  }
}

/**
 * List business collection payments for a merchant
 */
export async function listBusinessCollectionPayments(
  supabase: SupabaseClient,
  merchantId: string,
  options?: {
    businessId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{
  success: boolean;
  payments?: BusinessCollectionPayment[];
  total?: number;
  error?: string;
}> {
  try {
    let query = supabase
      .from('business_collection_payments')
      .select('*', { count: 'exact' })
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false });

    if (options?.businessId) {
      query = query.eq('business_id', options.businessId);
    }

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
    }

    const { data: payments, error, count } = await query;

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      payments: (payments || []).map((p) => ({
        id: p.id,
        businessId: p.business_id,
        merchantId: p.merchant_id,
        paymentAddress: p.payment_address,
        amount: p.amount,
        currency: p.currency,
        blockchain: p.blockchain,
        destinationWallet: p.destination_wallet,
        status: p.status,
        description: p.description,
        metadata: p.metadata,
        createdAt: p.created_at,
        expiresAt: p.expires_at,
      })),
      total: count || 0,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list payments',
    };
  }
}

/**
 * Send webhook for business collection events
 *
 * This is a custom webhook sender for business collection events
 * that doesn't require the strict WebhookEvent type.
 */
async function sendBusinessCollectionWebhook(
  supabase: SupabaseClient,
  businessId: string,
  paymentId: string,
  event: string,
  paymentData: Record<string, any>
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get business webhook configuration
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('webhook_url, webhook_secret')
      .eq('id', businessId)
      .single();

    if (businessError || !business) {
      return { success: false, error: 'Business not found' };
    }

    if (!business.webhook_url) {
      // No webhook configured, skip silently
      return { success: true };
    }

    // Prepare webhook payload
    const payload = {
      event,
      payment_id: paymentId,
      business_id: businessId,
      type: 'business_collection',
      ...paymentData,
      timestamp: new Date().toISOString(),
    };

    // Deliver webhook with retries
    const result = await retryFailedWebhook(
      business.webhook_url,
      payload,
      business.webhook_secret || '',
      3
    );

    // Log the attempt (using a generic event type for logging)
    await logWebhookAttempt(supabase, {
      business_id: businessId,
      payment_id: paymentId,
      event: 'payment.forwarded' as any, // Use closest matching event type for logging
      webhook_url: business.webhook_url,
      success: result.success,
      status_code: result.statusCode,
      error_message: result.error,
      attempt_number: result.attempts || 1,
    });

    return {
      success: result.success,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Process confirmed business collection payments securely
 *
 * This is called by the blockchain monitor when a payment reaches
 * the required number of confirmations.
 *
 * SECURITY: Private keys are decrypted internally - never passed via API.
 */
export async function processConfirmedBusinessCollectionPayment(
  supabase: SupabaseClient,
  paymentId: string
): Promise<BusinessCollectionForwardingResult> {
  // Use the secure forwarding function that handles decryption internally
  return forwardBusinessCollectionPaymentSecurely(supabase, paymentId);
}

/**
 * Batch process confirmed business collection payments
 */
export async function batchProcessConfirmedBusinessCollectionPayments(
  supabase: SupabaseClient,
  limit: number = 10
): Promise<{
  processed: number;
  successful: number;
  failed: number;
  results: BusinessCollectionForwardingResult[];
}> {
  // Get confirmed payments that need forwarding
  const { data: payments, error } = await supabase
    .from('business_collection_payments')
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

  const results: BusinessCollectionForwardingResult[] = [];
  let successful = 0;
  let failed = 0;

  for (const payment of payments) {
    const result = await processConfirmedBusinessCollectionPayment(supabase, payment.id);
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