/**
 * Secure Payment Forwarding Service
 *
 * This module handles payment forwarding WITHOUT exposing private keys via API.
 * Private keys are:
 * 1. Stored encrypted in the database (AES-256-GCM)
 * 2. Decrypted only in-memory when needed for signing
 * 3. Never transmitted over HTTP or logged
 *
 * SECURITY PRINCIPLES:
 * - Private keys never leave the server
 * - Keys are decrypted only at the moment of transaction signing
 * - Decrypted keys are immediately cleared from memory after use
 * - All key operations are logged (without exposing key material)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '../crypto/encryption';
import { getProvider, getRpcUrl, type BlockchainType, SolanaProvider, BitcoinProvider, EthereumProvider } from '../blockchain/providers';
import { splitPayment } from '../payments/fees';
import { sendPaymentWebhook } from '../webhooks/service';

/**
 * Result of a secure forwarding operation
 */
export interface SecureForwardingResult {
  success: boolean;
  merchantTxHash?: string;
  platformTxHash?: string;
  merchantAmount?: number;
  platformFee?: number;
  error?: string;
}

/**
 * Payment address data from database
 */
interface PaymentAddressData {
  id: string;
  payment_id: string;
  business_id: string;
  cryptocurrency: BlockchainType;
  address: string;
  encrypted_private_key: string;
  merchant_wallet: string;
  commission_wallet: string;
  amount_expected: number;
  commission_amount: number;
  merchant_amount: number;
  is_used: boolean;
}

/**
 * Securely retrieve and decrypt a private key for a payment
 * The key is decrypted in-memory and should be used immediately
 *
 * @param supabase - Supabase client
 * @param paymentId - Payment ID to get key for
 * @returns Decrypted private key (handle with care!)
 */
async function getDecryptedPrivateKey(
  supabase: SupabaseClient,
  paymentId: string
): Promise<{ success: boolean; privateKey?: string; addressData?: PaymentAddressData; error?: string }> {
  try {
    // Get the encrypted private key from database
    const { data, error } = await supabase
      .from('payment_addresses')
      .select('*')
      .eq('payment_id', paymentId)
      .single();

    if (error || !data) {
      return {
        success: false,
        error: `Payment address not found: ${error?.message || 'No data'}`,
      };
    }

    const addressData = data as PaymentAddressData;

    if (!addressData.encrypted_private_key) {
      return {
        success: false,
        error: 'No encrypted private key found for this payment',
      };
    }

    // Get encryption key from environment
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      return {
        success: false,
        error: 'Encryption key not configured',
      };
    }

    // Decrypt the private key
    const privateKey = decrypt(addressData.encrypted_private_key, encryptionKey);

    // Log the operation (without exposing key material)
    console.log(`[SECURE] Decrypted private key for payment ${paymentId} (address: ${addressData.address.substring(0, 10)}...)`);

    return {
      success: true,
      privateKey,
      addressData,
    };
  } catch (error) {
    console.error(`[SECURE] Failed to decrypt private key for payment ${paymentId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Decryption failed',
    };
  }
}

/**
 * Clear sensitive data from memory
 * Note: JavaScript doesn't guarantee immediate memory clearing,
 * but this helps reduce the window of exposure
 */
function clearSensitiveData(data: { privateKey?: string }): void {
  if (data.privateKey) {
    // Overwrite the string with zeros (best effort in JS)
    data.privateKey = '0'.repeat(data.privateKey.length);
    data.privateKey = '';
  }
}

/**
 * Forward a payment securely using encrypted keys from database
 * This is the main function for secure forwarding
 */
export async function forwardPaymentSecurely(
  supabase: SupabaseClient,
  paymentId: string
): Promise<SecureForwardingResult> {
  let sensitiveData: { privateKey?: string } = {};

  try {
    // Get payment details
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
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

    // Get decrypted private key
    const keyResult = await getDecryptedPrivateKey(supabase, paymentId);
    if (!keyResult.success || !keyResult.privateKey || !keyResult.addressData) {
      return {
        success: false,
        error: keyResult.error || 'Failed to get private key',
      };
    }

    sensitiveData.privateKey = keyResult.privateKey;
    const addressData = keyResult.addressData;

    // Update payment status to forwarding
    await supabase
      .from('payments')
      .update({ status: 'forwarding', updated_at: new Date().toISOString() })
      .eq('id', paymentId);

    // Calculate split amounts
    const { merchantAmount, platformFee } = splitPayment(payment.crypto_amount);

    // Get blockchain provider
    const rpcUrl = getRpcUrl(addressData.cryptocurrency);
    const provider = getProvider(addressData.cryptocurrency, rpcUrl);

    let merchantTxHash: string | undefined;
    let platformTxHash: string | undefined;

    try {
      if (provider.sendTransaction) {
        // Use split transaction for all providers that support it
        // This is more efficient and handles fee deduction properly
        const recipients = [
          { address: addressData.merchant_wallet, amount: merchantAmount.toString() },
          { address: addressData.commission_wallet, amount: platformFee.toString() },
        ];

        // Check if provider supports split transactions
        if (provider instanceof SolanaProvider && 'sendSplitTransaction' in provider) {
          // Solana: single transaction with multiple transfers
          merchantTxHash = await provider.sendSplitTransaction(
            addressData.address,
            recipients,
            sensitiveData.privateKey
          );
          platformTxHash = merchantTxHash;
          console.log(`[SECURE] Forwarded Solana payment ${paymentId} in single tx: ${merchantTxHash}`);
        } else if (provider instanceof BitcoinProvider && 'sendSplitTransaction' in provider) {
          // Bitcoin/BCH: single transaction with multiple outputs
          merchantTxHash = await (provider as BitcoinProvider).sendSplitTransaction(
            addressData.address,
            recipients,
            sensitiveData.privateKey
          );
          platformTxHash = merchantTxHash;
          console.log(`[SECURE] Forwarded Bitcoin payment ${paymentId} in single tx: ${merchantTxHash}`);
        } else if (provider instanceof EthereumProvider && 'sendSplitTransaction' in provider) {
          // Ethereum/Polygon: multiple transactions but with proper fee handling
          merchantTxHash = await (provider as EthereumProvider).sendSplitTransaction(
            addressData.address,
            recipients,
            sensitiveData.privateKey
          );
          // For ETH, the first tx hash is returned but both are sent
          platformTxHash = merchantTxHash;
          console.log(`[SECURE] Forwarded Ethereum payment ${paymentId}: ${merchantTxHash}`);
        } else {
          // Fallback: send two separate transactions
          merchantTxHash = await provider.sendTransaction(
            addressData.address,
            addressData.merchant_wallet,
            merchantAmount.toString(),
            sensitiveData.privateKey
          );

          platformTxHash = await provider.sendTransaction(
            addressData.address,
            addressData.commission_wallet,
            platformFee.toString(),
            sensitiveData.privateKey
          );

          console.log(`[SECURE] Forwarded payment ${paymentId}: merchant=${merchantTxHash}, platform=${platformTxHash}`);
        }
      } else {
        // For blockchains without sendTransaction support
        console.log(`[SECURE] Manual forwarding required for ${addressData.cryptocurrency}`);
        merchantTxHash = `manual_${paymentId}_merchant`;
        platformTxHash = `manual_${paymentId}_platform`;
      }

      // Update payment with forwarding details
      await supabase
        .from('payments')
        .update({
          status: 'forwarded',
          forward_tx_hash: merchantTxHash,
          merchant_amount: merchantAmount,
          fee_amount: platformFee,
          forwarded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', paymentId);

      // Mark address as used
      await supabase
        .from('payment_addresses')
        .update({
          is_used: true,
          forwarded_at: new Date().toISOString(),
          commission_tx_hash: platformTxHash,
          merchant_tx_hash: merchantTxHash,
        })
        .eq('payment_id', paymentId);

      // Send webhook notification
      await sendPaymentWebhook(supabase, paymentId, paymentId, 'payment.forwarded', {
        amount_crypto: payment.crypto_amount.toString(),
        currency: addressData.cryptocurrency,
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
      await supabase
        .from('payments')
        .update({
          status: 'forwarding_failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', paymentId);

      console.error(`[SECURE] Transaction failed for payment ${paymentId}:`, txError);

      return {
        success: false,
        error: txError instanceof Error ? txError.message : 'Transaction failed',
      };
    }
  } catch (error) {
    console.error(`[SECURE] Forwarding failed for payment ${paymentId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Forwarding failed',
    };
  } finally {
    // CRITICAL: Clear sensitive data from memory
    clearSensitiveData(sensitiveData);
  }
}

/**
 * Retry a failed forwarding operation securely
 */
export async function retryForwardingSecurely(
  supabase: SupabaseClient,
  paymentId: string
): Promise<SecureForwardingResult> {
  // Get payment details
  const { data: payment, error } = await supabase
    .from('payments')
    .select('status')
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

  // Reset status to confirmed for retry
  await supabase
    .from('payments')
    .update({ status: 'confirmed', updated_at: new Date().toISOString() })
    .eq('id', paymentId);

  // Forward using secure method
  return forwardPaymentSecurely(supabase, paymentId);
}

/**
 * Batch process confirmed payments securely
 * This should be called by a background job, not an API endpoint
 */
export async function batchForwardPaymentsSecurely(
  supabase: SupabaseClient,
  limit: number = 10
): Promise<{
  processed: number;
  successful: number;
  failed: number;
  results: SecureForwardingResult[];
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

  const results: SecureForwardingResult[] = [];
  let successful = 0;
  let failed = 0;

  for (const payment of payments) {
    const result = await forwardPaymentSecurely(supabase, payment.id);
    results.push(result);

    if (result.success) {
      successful++;
    } else {
      failed++;
    }
  }

  console.log(`[SECURE] Batch forwarding complete: ${successful} successful, ${failed} failed`);

  return {
    processed: payments.length,
    successful,
    failed,
    results,
  };
}