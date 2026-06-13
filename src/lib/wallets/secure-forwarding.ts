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
import { ethers } from 'ethers';
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction as SolanaTransaction,
  TransactionInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { decrypt } from '../crypto/encryption';
import { getProvider, getRpcUrl, type BlockchainType, SolanaProvider, BitcoinProvider, EthereumProvider } from '../blockchain/providers';
import { splitTieredPayment } from '../payments/fees';
import { sendPaymentWebhook } from '../webhooks/service';
import { isBusinessPaidTier } from '../entitlements/service';

const EVM_TOKEN_CONFIG = {
  USDT: { contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  USDT_ETH: { contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  USDT_POL: { contractAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
  USDC: { contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  USDC_ETH: { contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  USDC_POL: { contractAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
  USDC_BASE: { contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
} as const;

const SOLANA_TOKEN_CONFIG = {
  USDT_SOL: { mintAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  USDC_SOL: { mintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
} as const;

const ERC20_TRANSFER_ABI = ['function transfer(address to, uint256 amount) returns (bool)'];
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1Q2hvZbsiqW5xWH25efTNsLJA8knL');

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
  is_escrow?: boolean;
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

function isEVMToken(chain: BlockchainType): chain is keyof typeof EVM_TOKEN_CONFIG {
  return chain in EVM_TOKEN_CONFIG;
}

function isSolanaToken(chain: BlockchainType): chain is keyof typeof SOLANA_TOKEN_CONFIG {
  return chain in SOLANA_TOKEN_CONFIG;
}

function toTokenUnits(amount: number, decimals: number): bigint {
  return BigInt(Math.round(amount * 10 ** decimals));
}

async function forwardEVMTokenSplit(
  chain: BlockchainType,
  rpcUrl: string,
  privateKey: string,
  recipients: Array<{ address: string; amount: number }>
): Promise<{ merchantTxHash?: string; platformTxHash?: string }> {
  const config = EVM_TOKEN_CONFIG[chain as keyof typeof EVM_TOKEN_CONFIG];
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`, provider);
  const token = new ethers.Contract(config.contractAddress, ERC20_TRANSFER_ABI, wallet);

  const txHashes: string[] = [];
  for (const recipient of recipients) {
    const amountUnits = toTokenUnits(recipient.amount, config.decimals);
    if (amountUnits <= 0n) continue;

    const tx = await token.transfer(recipient.address, amountUnits);
    await tx.wait();
    txHashes.push(tx.hash);
  }

  return {
    merchantTxHash: txHashes[0],
    platformTxHash: txHashes[1] || txHashes[0],
  };
}

async function deriveFullSolanaKeypair(seed: Uint8Array): Promise<Uint8Array> {
  const { createPrivateKey, createPublicKey } = await import('crypto');
  const privateKeyObj = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(seed),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKeyObj = createPublicKey(privateKeyObj);
  const publicKeyDer = publicKeyObj.export({ format: 'der', type: 'spki' });
  const publicKey = publicKeyDer.subarray(-32);
  const fullKeypair = new Uint8Array(64);
  fullKeypair.set(seed, 0);
  fullKeypair.set(publicKey, 32);
  return fullKeypair;
}

async function parseSolanaKeypair(privateKey: string): Promise<Keypair> {
  try {
    const decoded = bs58.decode(privateKey);
    if (decoded.length === 64) return Keypair.fromSecretKey(decoded);
    if (decoded.length === 32) return Keypair.fromSecretKey(await deriveFullSolanaKeypair(decoded));
  } catch {
    // Fall back to hex below.
  }

  const hexBytes = Uint8Array.from(Buffer.from(privateKey, 'hex'));
  if (hexBytes.length === 64) return Keypair.fromSecretKey(hexBytes);
  if (hexBytes.length === 32) return Keypair.fromSecretKey(await deriveFullSolanaKeypair(hexBytes));
  throw new Error(`Invalid Solana private key length: ${hexBytes.length}`);
}

function getAssociatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

async function addCreateAssociatedTokenAccountIfMissing(
  connection: Connection,
  transaction: SolanaTransaction,
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey
): Promise<PublicKey> {
  const associatedTokenAddress = getAssociatedTokenAddress(owner, mint);
  const existing = await connection.getAccountInfo(associatedTokenAddress);
  if (existing) return associatedTokenAddress;

  transaction.add(new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAddress, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0),
  }));

  return associatedTokenAddress;
}

function createSplTransferInstruction(
  sourceTokenAccount: PublicKey,
  destinationTokenAccount: PublicKey,
  owner: PublicKey,
  amountUnits: bigint
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0);
  data.writeBigUInt64LE(amountUnits, 1);

  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: sourceTokenAccount, isSigner: false, isWritable: true },
      { pubkey: destinationTokenAccount, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

async function forwardSolanaTokenSplit(
  chain: BlockchainType,
  rpcUrl: string,
  privateKey: string,
  recipients: Array<{ address: string; amount: number }>
): Promise<{ merchantTxHash?: string; platformTxHash?: string }> {
  const config = SOLANA_TOKEN_CONFIG[chain as keyof typeof SOLANA_TOKEN_CONFIG];
  const connection = new Connection(rpcUrl, 'confirmed');
  const keypair = await parseSolanaKeypair(privateKey);
  const mint = new PublicKey(config.mintAddress);
  const sourceAccounts = await connection.getTokenAccountsByOwner(keypair.publicKey, { mint });
  const sourceTokenAccount = sourceAccounts.value[0]?.pubkey;

  if (!sourceTokenAccount) {
    throw new Error(`No source ${chain} token account found for ${keypair.publicKey.toString()}`);
  }

  const transaction = new SolanaTransaction();
  for (const recipient of recipients) {
    const amountUnits = toTokenUnits(recipient.amount, config.decimals);
    if (amountUnits <= 0n) continue;

    const recipientOwner = new PublicKey(recipient.address);
    const recipientTokenAccount = await addCreateAssociatedTokenAccountIfMissing(
      connection,
      transaction,
      keypair.publicKey,
      recipientOwner,
      mint
    );
    transaction.add(createSplTransferInstruction(sourceTokenAccount, recipientTokenAccount, keypair.publicKey, amountUnits));
  }

  const signature = await sendAndConfirmTransaction(connection, transaction, [keypair], { commitment: 'confirmed' });
  return {
    merchantTxHash: signature,
    platformTxHash: signature,
  };
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

    // GUARD: Never auto-forward escrow-held addresses
    if (addressData.is_escrow) {
      return {
        success: false,
        error: 'Address holds escrow funds — use /api/escrow/:id/settle instead',
      };
    }

    // Update payment status to forwarding
    await supabase
      .from('payments')
      .update({ status: 'forwarding', updated_at: new Date().toISOString() })
      .eq('id', paymentId);

    // Check if merchant has a paid subscription tier for commission rate
    // Paid tier (Professional) = 0.5% commission, Free tier (Starter) = 1% commission
    const isPaidTier = await isBusinessPaidTier(supabase, payment.business_id);

    // Calculate split amounts based on subscription tier
    const { merchantAmount, platformFee, feePercentage } = splitTieredPayment(payment.crypto_amount, isPaidTier);

    console.log(`[SECURE] Commission rate for business ${payment.business_id}: ${feePercentage * 100}% (${isPaidTier ? 'paid' : 'free'} tier)`);

    // Get blockchain provider
    const rpcUrl = getRpcUrl(addressData.cryptocurrency);
    const provider = getProvider(addressData.cryptocurrency, rpcUrl);

    let merchantTxHash: string | undefined;
    let platformTxHash: string | undefined;

    try {
      if (isEVMToken(addressData.cryptocurrency)) {
        const tokenTxHashes = await forwardEVMTokenSplit(
          addressData.cryptocurrency,
          rpcUrl,
          sensitiveData.privateKey,
          [
            { address: addressData.merchant_wallet, amount: merchantAmount },
            { address: addressData.commission_wallet, amount: platformFee },
          ]
        );
        merchantTxHash = tokenTxHashes.merchantTxHash;
        platformTxHash = tokenTxHashes.platformTxHash;
        console.log(`[SECURE] Forwarded EVM token payment ${paymentId}: merchant=${merchantTxHash}, platform=${platformTxHash}`);
      } else if (isSolanaToken(addressData.cryptocurrency)) {
        const tokenTxHashes = await forwardSolanaTokenSplit(
          addressData.cryptocurrency,
          rpcUrl,
          sensitiveData.privateKey,
          [
            { address: addressData.merchant_wallet, amount: merchantAmount },
            { address: addressData.commission_wallet, amount: platformFee },
          ]
        );
        merchantTxHash = tokenTxHashes.merchantTxHash;
        platformTxHash = tokenTxHashes.platformTxHash;
        console.log(`[SECURE] Forwarded Solana token payment ${paymentId} in single tx: ${merchantTxHash}`);
      } else if (provider.sendTransaction) {
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
      const { error: updateError } = await supabase
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

      if (updateError) {
        console.error(`[SECURE] Failed to update payment ${paymentId} to forwarded:`, updateError);
        throw new Error(`Database update failed: ${updateError.message}`);
      }

      console.log(`[SECURE] Payment ${paymentId} status updated to 'forwarded'`);

      // Mark address as used
      const { error: addressError } = await supabase
        .from('payment_addresses')
        .update({
          is_used: true,
          forwarded_at: new Date().toISOString(),
          commission_tx_hash: platformTxHash,
          merchant_tx_hash: merchantTxHash,
        })
        .eq('payment_id', paymentId);

      if (addressError) {
        console.error(`[SECURE] Failed to update payment address for ${paymentId}:`, addressError);
        // Don't throw here - payment is already forwarded, this is just metadata
      }

      // Send webhook notification
      await sendPaymentWebhook(supabase, payment.business_id, paymentId, 'payment.forwarded', {
        amount_crypto: payment.crypto_amount.toString(),
        amount_usd: payment.amount?.toString() || '0',
        currency: addressData.cryptocurrency,
        status: 'forwarded',
        merchant_amount: merchantAmount,
        platform_fee: platformFee,
        tx_hash: merchantTxHash,
        merchant_tx_hash: merchantTxHash,
        platform_tx_hash: platformTxHash,
        metadata: payment.metadata || undefined,
      });

      return {
        success: true,
        merchantTxHash,
        platformTxHash,
        merchantAmount,
        platformFee,
      };
    } catch (txError) {
      // Persist forwarding failure details for debugging/retry queue processors
      const forwardingError = txError instanceof Error ? txError.message : String(txError);
      const existingMetadata = (payment.metadata && typeof payment.metadata === 'object') ? payment.metadata : {};

      await supabase
        .from('payments')
        .update({
          status: 'forwarding_failed',
          metadata: {
            ...existingMetadata,
            forwarding_error: forwardingError,
            forwarding_failed_at: new Date().toISOString(),
          },
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
