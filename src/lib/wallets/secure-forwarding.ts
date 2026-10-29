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

import { settleForwardingMetadata } from '@/lib/payments/reconciliation';
import { settlementThreshold, toFiniteNumber } from '@/lib/payments/tolerance';
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
import { getProvider, getRpcUrl, type BlockchainType, SolanaProvider, BitcoinProvider, EthereumProvider } from '../blockchain/providers';
// One copy of the SPL program ids. This file used to carry its own, with the
// associated-token program mistyped (1Q2hv for 1b2hv): every destination it
// derived was an address no wallet uses, so Solana token forwards failed.
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '../blockchain/solana-token-balance';
import { splitTieredPayment } from '../payments/fees';
import { sendPaymentWebhook } from '../webhooks/service';
import { isBusinessPaidTier } from '../entitlements/service';
import {
  computeGasReserve,
  ensureGasForTransfers,
  forwardTokenViaRelayer,
  RelayerUnderfundedError,
} from './evm-gas';
import { alertRelayerUnderfunded } from './relayer-health';
import { getCommissionWallet, deriveSolanaFeePayer, deriveTronRelayerWallet, type SystemBlockchain } from './system-wallet';
import { OperatorKeysLockedError, openPaymentAddressKey } from './operator-keys';
import { forwardTronUsdtSplit } from '../tron/forward';
import { checkBalance as checkAddressBalance } from '@/app/api/cron/monitor-payments/balance-checkers';

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
  /** 'operator_locked' when the operator keys are locked: retry after unlock, not a failure. */
  code?: string;
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

interface ForwardingPaymentBinding {
  id: string;
  blockchain: string | null;
  payment_address: string | null;
  merchant_wallet_address: string | null;
}

function addressesMatch(left: string, right: string): boolean {
  const a = left.trim();
  const b = right.trim();
  return a.startsWith('0x') && b.startsWith('0x')
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

/**
 * Fail closed when the payment and its signing record no longer describe the
 * same source, chain, and payout destination.
 */
export function validateForwardingBinding(
  payment: ForwardingPaymentBinding,
  addressData: Pick<
    PaymentAddressData,
    'payment_id' | 'cryptocurrency' | 'address' | 'merchant_wallet' | 'commission_wallet'
  >,
  expectedCommissionWallet: string
): string | null {
  if (addressData.payment_id !== payment.id) {
    return 'Payment address record belongs to a different payment';
  }

  if (!payment.payment_address) {
    return 'Payment has no recorded source address';
  }

  if (!addressesMatch(payment.payment_address, addressData.address)) {
    return 'Payment source address does not match its signing record';
  }

  if (!payment.blockchain) {
    return 'Payment has no recorded blockchain';
  }

  if (payment.blockchain !== addressData.cryptocurrency) {
    return 'Payment blockchain does not match its signing record';
  }

  if (!payment.merchant_wallet_address) {
    return 'Payment has no recorded merchant payout address';
  }

  if (!addressesMatch(payment.merchant_wallet_address, addressData.merchant_wallet)) {
    return 'Merchant payout address does not match its signing record';
  }

  if (!addressData.commission_wallet.trim()) {
    return 'Payment signing record has no platform fee wallet';
  }

  if (!addressesMatch(expectedCommissionWallet, addressData.commission_wallet)) {
    return 'Platform fee wallet does not match server configuration';
  }

  return null;
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
): Promise<{ success: boolean; privateKey?: string; addressData?: PaymentAddressData; error?: string; code?: string }> {
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

    // Sealed to the operator vault (needs an operator unlock), or a legacy
    // ENCRYPTION_KEY row (re-sealed on this use once the vault exists).
    const privateKey = await openPaymentAddressKey(addressData, (sealed) =>
      Promise.resolve(supabase.from('payment_addresses').update({ encrypted_private_key: sealed }).eq('id', addressData.id)),
    );

    // Log the operation (without exposing key material)
    console.log(`[SECURE] Decrypted private key for payment ${paymentId} (address: ${addressData.address.substring(0, 10)}...)`);

    return {
      success: true,
      privateKey,
      addressData,
    };
  } catch (error) {
    if (error instanceof OperatorKeysLockedError || (error as { code?: string })?.code === 'vault_locked') {
      return { success: false, error: (error as Error).message, code: 'operator_locked' };
    }
    console.error(`[SECURE] Failed to decrypt private key for payment ${paymentId}:`, error instanceof Error ? error.message : error);
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

/** USDT on TRON: swept by lib/tron/forward, with energy paid by the TRON gas relayer. */
function isTronToken(chain: BlockchainType): boolean {
  return chain === 'USDT_TRON';
}

async function forwardTronTokenSplit(
  privateKey: string,
  payouts: Array<{ address: string; amount: number }>
): Promise<{ merchantTxHash: string; platformTxHash: string }> {
  const relayer = deriveTronRelayerWallet();
  try {
    return await forwardTronUsdtSplit(privateKey, payouts, relayer.privateKey);
  } catch (error) {
    // forwardTronUsdtSplit checks the relayer before it broadcasts anything,
    // so an underfunded relayer means provably nothing was sent.
    if (error instanceof RelayerUnderfundedError) throw new ForwardNotStartedError(error);
    throw error;
  }
}

function toTokenUnits(amount: number, decimals: number): bigint {
  return BigInt(Math.round(amount * 10 ** decimals));
}

/**
 * Forwarding stopped before anything was broadcast, so the payment is
 * untouched and can safely go back to `confirmed` for a later retry.
 *
 * Only raised where that is certain. A relayer shortfall after the relayer path
 * already failed for some other reason does not qualify: that path can fail
 * after its permit or a transferFrom has landed.
 */
export class ForwardNotStartedError extends Error {
  readonly shortfall: RelayerUnderfundedError;

  constructor(shortfall: RelayerUnderfundedError) {
    super(shortfall.message);
    this.name = 'ForwardNotStartedError';
    this.shortfall = shortfall;
  }
}

/**
 * Lines per-payout hashes back up with the recipients they were built from,
 * leaving undefined where a recipient rounded to zero token units and was
 * never sent.
 */
function alignTxHashes(sentIndexes: number[], txHashes: string[], recipientCount: number): Array<string | undefined> {
  const aligned: Array<string | undefined> = new Array(recipientCount).fill(undefined);
  sentIndexes.forEach((recipientIndex, i) => { aligned[recipientIndex] = txHashes[i]; });
  return aligned;
}

/** Splits a token forward's per-recipient hashes into the merchant/platform pair. */
function toMerchantPlatform(txHashes: Array<string | undefined>): { merchantTxHash?: string; platformTxHash?: string } {
  return { merchantTxHash: txHashes[0], platformTxHash: txHashes[1] || txHashes[0] };
}

async function forwardEVMTokenSplit(
  chain: BlockchainType,
  rpcUrl: string,
  privateKey: string,
  recipients: Array<{ address: string; amount: number }>
): Promise<Array<string | undefined>> {
  const config = EVM_TOKEN_CONFIG[chain as keyof typeof EVM_TOKEN_CONFIG];
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const payouts = recipients
    .map((r, index) => ({ index, address: r.address, amount: toTokenUnits(r.amount, config.decimals) }))
    .filter((r) => r.amount > 0n);
  const sentIndexes = payouts.map((p) => p.index);

  if (payouts.length === 0) {
    return recipients.map(() => undefined);
  }

  // Preferred: the relayer pulls the funds with permit + transferFrom, so the
  // derived address never needs native currency and no dust is left behind.
  let relayMayHaveBroadcast = false;
  try {
    const relayed = await forwardTokenViaRelayer({
      cryptocurrency: chain as SystemBlockchain,
      provider,
      ownerPrivateKey: privateKey,
      tokenAddress: config.contractAddress,
      recipients: payouts,
    });

    if (relayed) {
      console.log(
        `[SECURE] Forwarded ${chain} via relayer ${relayed.relayerAddress} ` +
          `(gas ${ethers.formatEther(relayed.gasSpentWei)})`,
      );
      return alignTxHashes(sentIndexes, relayed.txHashes, recipients.length);
    }
  } catch (relayError) {
    // A broke relayer is an operational problem and the fallback needs the same
    // float, so there is nothing to gain by retrying the other path — surface it.
    // The shortfall check runs before the relayer signs anything, so nothing
    // has been broadcast yet.
    if (relayError instanceof RelayerUnderfundedError) throw new ForwardNotStartedError(relayError);
    const msg = relayError instanceof Error ? relayError.message : String(relayError);
    relayMayHaveBroadcast = true;
    console.error(`[SECURE] Relayer path failed for ${chain}, falling back to gas top-up: ${msg}`);
  }

  // Fallback for tokens without permit (USDT on Ethereum predates EIP-2612):
  // fund the address, then let it send for itself.
  try {
    await ensureGasForTransfers({
      cryptocurrency: chain as SystemBlockchain,
      provider,
      address: new ethers.Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`).address,
      transferCount: payouts.length,
    });
  } catch (gasError) {
    if (gasError instanceof RelayerUnderfundedError && !relayMayHaveBroadcast) {
      throw new ForwardNotStartedError(gasError);
    }
    throw gasError;
  }

  const wallet = new ethers.Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`, provider);
  const token = new ethers.Contract(config.contractAddress, ERC20_TRANSFER_ABI, wallet);

  const txHashes: string[] = [];
  for (const recipient of payouts) {
    const tx = await token.transfer(recipient.address, recipient.amount);
    await tx.wait();
    txHashes.push(tx.hash);
  }

  return alignTxHashes(sentIndexes, txHashes, recipients.length);
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

function createAssociatedTokenAccountInstruction(
  payer: PublicKey,
  associatedTokenAddress: PublicKey,
  owner: PublicKey,
  mint: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
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
  });
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

/** Size of an SPL token account; its rent-exempt minimum is what creating one costs. */
const SPL_TOKEN_ACCOUNT_SIZE = 165;
/** Fee per signature on Solana. */
const LAMPORTS_PER_SIGNATURE = 5_000;

/**
 * Neither the CoinPay fee payer nor the deposit address holds enough SOL to pay
 * the network fee and the rent for the recipients' token accounts. Raised
 * before anything is signed, so nothing was broadcast and a retry is safe once
 * the fee payer is topped up.
 */
export class SolanaFeeShortfallError extends Error {
  readonly feePayerAddress: string | null;
  readonly neededLamports: number;

  constructor(params: { feePayerAddress: string | null; neededLamports: number; feePayerLamports: number; ownerLamports: number }) {
    super(
      `Solana token transfer needs ${params.neededLamports} lamports for fees and token-account rent; ` +
        (params.feePayerAddress
          ? `fee payer ${params.feePayerAddress} has ${params.feePayerLamports}`
          : 'no fee payer is configured') +
        ` and the sending address has ${params.ownerLamports}. Top up the fee payer.`,
    );
    this.name = 'SolanaFeeShortfallError';
    this.feePayerAddress = params.feePayerAddress;
    this.neededLamports = params.neededLamports;
  }
}

async function loadSolanaFeePayer(): Promise<Keypair | null> {
  try {
    const { privateKey } = await deriveSolanaFeePayer();
    return await parseSolanaKeypair(privateKey);
  } catch {
    return null;
  }
}

async function forwardSolanaTokenSplit(
  chain: BlockchainType,
  rpcUrl: string,
  privateKey: string,
  recipients: Array<{ address: string; amount: number }>
): Promise<Array<string | undefined>> {
  const config = SOLANA_TOKEN_CONFIG[chain as keyof typeof SOLANA_TOKEN_CONFIG];
  const connection = new Connection(rpcUrl, 'confirmed');
  const keypair = await parseSolanaKeypair(privateKey);
  const mint = new PublicKey(config.mintAddress);
  // Wallets pay into the owner's associated token account, so that is the
  // source. Derived rather than looked up: the public RPC rate-limits
  // getTokenAccountsByOwner (see solana-token-balance).
  const sourceTokenAccount = getAssociatedTokenAddress(keypair.publicKey, mint);

  const payouts = recipients
    .map((r, index) => ({ index, owner: new PublicKey(r.address), amountUnits: toTokenUnits(r.amount, config.decimals) }))
    .filter((p) => p.amountUnits > 0n);
  if (payouts.length === 0) return recipients.map(() => undefined);

  // The deposit address only ever received the token, so it usually has no SOL
  // for the fee or for a recipient's token account. The CoinPay fee payer covers
  // both; the deposit address pays only when the fee payer cannot and it can.
  const destinations = payouts.map((p) => getAssociatedTokenAddress(p.owner, mint));
  const [sourceInfo, ...destinationInfos] = await connection.getMultipleAccountsInfo([sourceTokenAccount, ...destinations]);
  if (!sourceInfo) {
    throw new Error(`No source ${chain} token account found for ${keypair.publicKey.toString()}`);
  }
  const missingAccounts = new Set(
    destinations.map((d, i) => (destinationInfos[i] ? null : d.toBase58())).filter((d): d is string => d !== null),
  ).size;
  const rentPerAccount = missingAccounts > 0
    ? await connection.getMinimumBalanceForRentExemption(SPL_TOKEN_ACCOUNT_SIZE)
    : 0;

  const feePayer = await loadSolanaFeePayer();
  const useFeePayer = feePayer !== null && !feePayer.publicKey.equals(keypair.publicKey);
  const neededWithFeePayer = missingAccounts * rentPerAccount + 2 * LAMPORTS_PER_SIGNATURE;
  const neededAlone = missingAccounts * rentPerAccount + LAMPORTS_PER_SIGNATURE;
  const feePayerLamports = useFeePayer ? await connection.getBalance(feePayer.publicKey) : 0;

  let payer: Keypair;
  if (useFeePayer && feePayerLamports >= neededWithFeePayer) {
    payer = feePayer;
  } else {
    const ownerLamports = await connection.getBalance(keypair.publicKey);
    if (ownerLamports < neededAlone) {
      throw new SolanaFeeShortfallError({
        feePayerAddress: useFeePayer ? feePayer.publicKey.toBase58() : null,
        neededLamports: useFeePayer ? neededWithFeePayer : neededAlone,
        feePayerLamports,
        ownerLamports,
      });
    }
    payer = keypair;
  }

  const transaction = new SolanaTransaction();
  transaction.feePayer = payer.publicKey;
  const created = new Set<string>();
  payouts.forEach((payout, i) => {
    const destination = destinations[i];
    if (!destinationInfos[i] && !created.has(destination.toBase58())) {
      transaction.add(createAssociatedTokenAccountInstruction(payer.publicKey, destination, payout.owner, mint));
      created.add(destination.toBase58());
    }
    transaction.add(createSplTransferInstruction(sourceTokenAccount, destination, keypair.publicKey, payout.amountUnits));
  });

  const signers = payer === keypair ? [keypair] : [payer, keypair];
  const signature = await sendAndConfirmTransaction(connection, transaction, signers, { commitment: 'confirmed' });
  // One transaction carries every leg.
  return recipients.map((_, index) => (payouts.some((p) => p.index === index) ? signature : undefined));
}

/** Chains whose escrow and payment funds are a token, not the chain's native coin. */
export function isTokenTransferChain(chain: BlockchainType): boolean {
  return isEVMToken(chain) || isSolanaToken(chain);
}

/**
 * Send a USDC/USDT balance from a CoinPay-held address to each recipient, as
 * the token itself: ERC-20 through the gas relayer on EVM chains, SPL on
 * Solana with the recipient's token account created when missing.
 *
 * Returns one hash per recipient, in order; undefined where an amount rounded
 * to zero token units. Errors that are certain nothing was broadcast are
 * ForwardNotStartedError and SolanaFeeShortfallError.
 */
export async function sendTokenTransfers(
  chain: BlockchainType,
  rpcUrl: string,
  privateKey: string,
  recipients: Array<{ address: string; amount: number }>
): Promise<Array<string | undefined>> {
  if (isEVMToken(chain)) return forwardEVMTokenSplit(chain, rpcUrl, privateKey, recipients);
  if (isSolanaToken(chain)) return forwardSolanaTokenSplit(chain, rpcUrl, privateKey, recipients);
  throw new Error(`${chain} is not a token chain`);
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
  let claimAcquired = false;
  let broadcastStarted = false;

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
        ...(keyResult.code ? { code: keyResult.code } : {}),
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

    // GUARD: refuse to build a transfer with no payee.
    //
    // An empty merchant_wallet reaches the provider as an empty recipient
    // address, which throws mid-transaction and takes the platform-fee leg down
    // with it — leaving the payment in forwarding_failed and the funds at the
    // intermediary address. Failing here instead makes the cause legible
    // ("no payee") rather than surfacing as an opaque chain error, and keeps a
    // doomed transaction from being attempted on every retry.
    if (!addressData.merchant_wallet || addressData.merchant_wallet.trim() === '') {
      return {
        success: false,
        error:
          `Payment ${paymentId} has no merchant payout address on its payment_addresses row. ` +
          `Set merchant_wallet to the merchant's ${addressData.cryptocurrency} address before forwarding.`,
      };
    }

    let expectedCommissionWallet: string;
    try {
      expectedCommissionWallet = getCommissionWallet(
        addressData.cryptocurrency as SystemBlockchain
      );
    } catch (commissionWalletError) {
      console.error(
        `[SECURE] Cannot validate platform fee wallet for payment ${paymentId}:`,
        commissionWalletError
      );
      return {
        success: false,
        error: 'Platform fee wallet configuration is unavailable',
      };
    }

    const bindingError = validateForwardingBinding(
      payment,
      addressData,
      expectedCommissionWallet
    );
    if (bindingError) {
      console.error(`[SECURE] Refusing to forward payment ${paymentId}: ${bindingError}`);
      return {
        success: false,
        error: `Forwarding record mismatch: ${bindingError}`,
      };
    }

    const rpcUrl = getRpcUrl(addressData.cryptocurrency);
    const provider = getProvider(addressData.cryptocurrency, rpcUrl);
    if (
      !isEVMToken(addressData.cryptocurrency) &&
      !isSolanaToken(addressData.cryptocurrency) &&
      !isTronToken(addressData.cryptocurrency) &&
      !provider.sendTransaction
    ) {
      return { success: false, error: `Manual forwarding required for ${addressData.cryptocurrency}` };
    }

    // Claim the payment before any on-chain work.
    //
    // confirmed -> forwarding used to be an unconditional write, so the
    // "is it confirmed?" read above and this write were separate steps. Three
    // schedulers plus the merchant-facing balance check can all read
    // 'confirmed' at the same time and each go on to send the full split — the
    // merchant is paid N times out of a pot that only covers one payment.
    // Conditioning the write on the status we observed means exactly one
    // caller proceeds.
    const { data: claimedForward } = await supabase
      .from('payments')
      .update({ status: 'forwarding', updated_at: new Date().toISOString() })
      .eq('id', paymentId)
      .eq('status', 'confirmed')
      .select('id');

    if (!claimedForward || claimedForward.length === 0) {
      return {
        success: false,
        error: 'Payment is already being forwarded by another worker',
      };
    }
    claimAcquired = true;

    // Check if merchant has a paid subscription tier for commission rate
    // Paid tier (Professional) = 0.5% commission, Free tier (Starter) = 1% commission
    const isPaidTier = await isBusinessPaidTier(supabase, payment.business_id);

    // Withhold the gas reserve before splitting — token payments only.
    //
    // Every quote already adds an estimated network fee on top of the invoice
    // amount. On chains where the fee and the funds are the same asset it is
    // consumed by the sweep itself, so there is nothing to withhold. For tokens
    // it arrives as more *token*, which cannot pay gas, so the platform has to
    // advance native currency and recover it here. Splitting the surcharge 99/1
    // like the rest of the payment — which is what used to happen — handed 99%
    // of the gas money to the merchant and left the float permanently short.
    // TRON tokens are in the same position as EVM ones: the deposit holds
    // USDT, the energy is paid in TRX by the relayer.
    const gasReserve = isEVMToken(addressData.cryptocurrency) || isTronToken(addressData.cryptocurrency)
      ? computeGasReserve(payment.crypto_amount, payment.metadata)
      : 0;

    // Split what is actually at the address, not what the quote expected.
    //
    // Splitting the expected amount meant the two legs were sized against a
    // number the address might not hold. The merchant leg (99%+) went out
    // first and drained the balance, then the platform-fee leg failed for
    // insufficient funds — so the platform collected nothing while the payment
    // still looked settled. Any surplus from an overpayment was likewise
    // stranded, because nothing ever swept the difference.
    //
    // The expected amount stays as a floor sanity check: a balance that has
    // dropped below it means funds already left, and forwarding must not
    // proceed on a stale view.
    let potToSplit: number;
    try {
      const actualBalance = await checkAddressBalance(
        addressData.address,
        addressData.cryptocurrency
      );

      if (actualBalance !== null && Number.isFinite(actualBalance)) {
        if (actualBalance <= 0) {
          await supabase
            .from('payments')
            .update({ status: 'confirmed', updated_at: new Date().toISOString() })
            .eq('id', paymentId)
            .eq('status', 'forwarding');
          return {
            success: false,
            error: 'Address holds no balance to forward',
          };
        }

        // The floor check the comment above promises (BL-04).
        //
        // Only `<= 0` was actually tested, so the "floor sanity check" existed
        // in prose and nowhere else. A balance that had dropped below the
        // expected amount but stayed above zero — funds partially moved, or a
        // stale read mid-sweep — forwarded anyway, splitting a pot that no
        // longer matched what the payment recorded.
        //
        // `settlementThreshold` is the same tolerance confirmation uses, so a
        // float round-trip does not trip this while a real shortfall does. It
        // is given the asset for the same reason confirmation is: a quote
        // written at more decimals than the token has (5.0910182 USDC, from
        // before quotes were quantized) can only ever be paid as 5.091018.
        // Without the asset, confirmation accepted that payment and this guard
        // refused to forward it, every minute, as "funds already moved".
        const expected = toFiniteNumber(payment.crypto_amount);
        if (
          expected !== null &&
          expected > 0 &&
          actualBalance < settlementThreshold(expected, addressData.cryptocurrency)
        ) {
          console.error(
            `[SECURE] Payment ${paymentId}: address holds ${actualBalance} but ${expected} was confirmed — ` +
            'funds appear to have already moved. Refusing to forward on a stale view.'
          );
          await supabase
            .from('payments')
            .update({ status: 'confirmed', updated_at: new Date().toISOString() })
            .eq('id', paymentId)
            .eq('status', 'forwarding');
          return {
            success: false,
            error: 'Address balance is below the confirmed amount — refusing to forward',
          };
        }

        // F-1.1-13: a balance inside (0, gasReserve] leaves nothing to split
        // once gas is held back, and the tiered split then misbehaves rather
        // than reporting the real problem.
        if (gasReserve > 0 && actualBalance <= gasReserve) {
          console.error(
            `[SECURE] Payment ${paymentId}: balance ${actualBalance} does not exceed the ${gasReserve} gas reserve`
          );
          await supabase
            .from('payments')
            .update({ status: 'confirmed', updated_at: new Date().toISOString() })
            .eq('id', paymentId)
            .eq('status', 'forwarding');
          return {
            success: false,
            error: 'Address balance does not cover the gas reserve',
          };
        }

        potToSplit = actualBalance;
      } else {
        throw new Error('Balance lookup returned an invalid value');
      }
    } catch (balanceError) {
      console.warn(`[SECURE] Balance read failed for ${paymentId}:`, balanceError);
      // Nothing has been broadcast. Release only our forwarding claim so a
      // later worker can retry once the balance provider recovers.
      const { error: releaseError } = await supabase
        .from('payments')
        .update({ status: 'confirmed', updated_at: new Date().toISOString() })
        .eq('id', paymentId)
        .eq('status', 'forwarding');
      if (releaseError) {
        console.error(`[SECURE] Could not release forwarding claim for ${paymentId}:`, releaseError);
      }
      return {
        success: false,
        error: 'Unable to verify address balance - forwarding deferred',
      };
    }

    const split = splitTieredPayment(potToSplit - gasReserve, isPaidTier);
    const { merchantAmount, feePercentage } = split;
    const platformFee = split.platformFee + gasReserve;

    console.log(`[SECURE] Commission rate for business ${payment.business_id}: ${feePercentage * 100}% (${isPaidTier ? 'paid' : 'free'} tier)`);
    if (gasReserve > 0) {
      console.log(`[SECURE] Withholding ${gasReserve} ${addressData.cryptocurrency} as gas reserve`);
    }

    let merchantTxHash: string | undefined;
    let platformTxHash: string | undefined;
    const broadcastStartedAt = new Date().toISOString();

    try {
      // A thrown provider call may already have broadcast a transaction. From
      // this point on, only reconciliation can establish that retry is safe.
      broadcastStarted = true;
      if (isEVMToken(addressData.cryptocurrency)) {
        const tokenTxHashes = toMerchantPlatform(await forwardEVMTokenSplit(
          addressData.cryptocurrency,
          rpcUrl,
          sensitiveData.privateKey,
          [
            { address: addressData.merchant_wallet, amount: merchantAmount },
            { address: addressData.commission_wallet, amount: platformFee },
          ]
        ));
        merchantTxHash = tokenTxHashes.merchantTxHash;
        platformTxHash = tokenTxHashes.platformTxHash;
        console.log(`[SECURE] Forwarded EVM token payment ${paymentId}: merchant=${merchantTxHash}, platform=${platformTxHash}`);
      } else if (isTronToken(addressData.cryptocurrency)) {
        const tokenTxHashes = await forwardTronTokenSplit(sensitiveData.privateKey, [
          { address: addressData.merchant_wallet, amount: merchantAmount },
          { address: addressData.commission_wallet, amount: platformFee },
        ]);
        merchantTxHash = tokenTxHashes.merchantTxHash;
        platformTxHash = tokenTxHashes.platformTxHash;
        console.log(`[SECURE] Forwarded USDT_TRON payment ${paymentId}: merchant=${merchantTxHash}, platform=${platformTxHash}`);
      } else if (isSolanaToken(addressData.cryptocurrency)) {
        const tokenTxHashes = toMerchantPlatform(await forwardSolanaTokenSplit(
          addressData.cryptocurrency,
          rpcUrl,
          sensitiveData.privateKey,
          [
            { address: addressData.merchant_wallet, amount: merchantAmount },
            { address: addressData.commission_wallet, amount: platformFee },
          ]
        ));
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
      }

      if (![merchantTxHash, platformTxHash].every(hash => typeof hash === 'string' && hash.trim())) {
        throw new Error('Provider did not return transaction hashes');
      }

      // A forward that succeeds after an earlier failure has to retract that
      // failure's marks, or the payment ends up settled and flagged for manual
      // reconciliation at the same time — permanently. See
      // lib/payments/reconciliation.ts for the incident that found it.
      const settled = settleForwardingMetadata(payment.metadata);

      // Update payment with forwarding details
      const { data: completed, error: updateError } = await supabase
        .from('payments')
        .update({
          status: 'forwarded',
          forward_tx_hash: merchantTxHash,
          merchant_amount: merchantAmount,
          fee_amount: platformFee,
          forwarded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          // Only when there is something to clear, so an ordinary first-try
          // forward does not rewrite metadata it has no reason to touch.
          ...(settled.changed ? { metadata: settled.metadata } : {}),
        })
        .eq('id', paymentId)
        .eq('status', 'forwarding')
        .select('id');

      if (updateError || !completed?.length) {
        console.error(`[SECURE] Failed to update payment ${paymentId} to forwarded:`, updateError);
        throw new Error(updateError ? `Database update failed: ${updateError.message}` : 'Payment state changed before forwarding completion was recorded');
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
      try {
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
      } catch (notificationError) {
        // The transfer and its database record already succeeded. Notification
        // delivery must never put this payment back on the retry path.
        console.error(`[SECURE] Forwarded payment ${paymentId} notification failed:`, notificationError);
      }

      return {
        success: true,
        merchantTxHash,
        platformTxHash,
        merchantAmount,
        platformFee,
      };
    } catch (txError) {
      // An empty gas relayer stops the sweep before anything is signed. That
      // is an operational shortfall, not an ambiguous broadcast: put the row
      // back to `confirmed` so the late-deposit rescan retries it once the
      // float is topped up, instead of freezing it for manual reconciliation
      // where nothing will ever look at it again.
      if (txError instanceof ForwardNotStartedError) {
        const existing = (payment.metadata && typeof payment.metadata === 'object') ? payment.metadata : {};
        const { error: releaseError } = await supabase
          .from('payments')
          .update({
            status: 'confirmed',
            metadata: {
              ...existing,
              forwarding_deferred: {
                reason: 'relayer_underfunded',
                relayer: txError.shortfall.relayerAddress,
                chain: txError.shortfall.cryptocurrency,
                balance_wei: txError.shortfall.balanceWei.toString(),
                needed_wei: txError.shortfall.neededWei.toString(),
                at: new Date().toISOString(),
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', paymentId)
          .eq('status', 'forwarding');
        if (releaseError) {
          console.error(`[SECURE] Could not release relayer-starved claim for ${paymentId}:`, releaseError);
        }
        console.error(`[SECURE] Forwarding deferred for ${paymentId}: ${txError.message}`);
        try {
          await alertRelayerUnderfunded(supabase, txError.shortfall, paymentId);
        } catch (alertError) {
          console.error('[SECURE] Relayer alert failed:', alertError);
        }
        return {
          success: false,
          error: `Forwarding deferred until the gas relayer is topped up: ${txError.message}`,
        };
      }

      // Preserve the claim even when the provider or the final database write
      // fails. A stale balance or missing hash is not proof of no broadcast.
      const forwardingError = txError instanceof Error ? txError.message : String(txError);
      const existingMetadata = (payment.metadata && typeof payment.metadata === 'object') ? payment.metadata : {};
      console.error(`[SECURE] Forwarding outcome requires reconciliation for ${paymentId}:`, {
        error: forwardingError, merchantTxHash, platformTxHash,
      });

      const { error: reconciliationError } = await supabase
        .from('payments')
        .update({
          ...(merchantTxHash ? { forward_tx_hash: merchantTxHash } : {}),
          metadata: {
            ...existingMetadata,
            reconciliation_required: true,
            forwarding_started_at: broadcastStartedAt,
            ...(merchantTxHash ? { forwarding_merchant_tx_hash: merchantTxHash } : {}),
            ...(platformTxHash ? { forwarding_platform_tx_hash: platformTxHash } : {}),
            forwarding_error: forwardingError,
            forwarding_failed_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', paymentId)
        .eq('status', 'forwarding');

      if (reconciliationError) {
        console.error(`[SECURE] Could not record reconciliation details for ${paymentId}:`, reconciliationError);
      }

      return {
        success: false,
        error: `Forwarding outcome requires reconciliation before retry: ${forwardingError}`,
      };
    }
  } catch (error) {
    if (claimAcquired && !broadcastStarted) {
      try {
        const { error: releaseError } = await supabase
          .from('payments')
          .update({ status: 'confirmed', updated_at: new Date().toISOString() })
          .eq('id', paymentId)
          .eq('status', 'forwarding');
        if (releaseError) console.error(`[SECURE] Could not release pre-broadcast claim for ${paymentId}:`, releaseError);
      } catch (releaseError) {
        console.error(`[SECURE] Could not release pre-broadcast claim for ${paymentId}:`, releaseError);
      }
    }
    console.error(`[SECURE] Forwarding failed for payment ${paymentId}:`, error);
    return {
      success: false,
      error: broadcastStarted
        ? `Forwarding outcome requires reconciliation before retry: ${error instanceof Error ? error.message : 'Forwarding failed'}`
        : error instanceof Error ? error.message : 'Forwarding failed',
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

  // Old failures may have happened after a partial or unacknowledged send.
  // Keep the record intact until an operator has reconciled the outcome.
  if (payment.status === 'forwarding_failed') {
    return { success: false, error: 'Legacy forwarding failure requires reconciliation before retry' };
  }

  // Only known pre-broadcast failures release back to confirmed automatically.
  if (payment.status !== 'confirmed') {
    return {
      success: false,
      error: `Cannot retry forwarding for payment with status: ${payment.status}`,
    };
  }

  // Reset status to confirmed for retry, conditioned on the status we just
  // read. Without the guard, a retry racing the normal pipeline could drag a
  // payment that is mid-forward back to 'confirmed' and let a second forward
  // start against the same funds.
  const { data: reset } = await supabase
    .from('payments')
    .update({ status: 'confirmed', updated_at: new Date().toISOString() })
    .eq('id', paymentId)
    .eq('status', payment.status)
    .select('id');

  if (!reset || reset.length === 0) {
    return {
      success: false,
      error: 'Payment state changed; retry aborted',
    };
  }

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
  // Get confirmed payments that need forwarding.
  //
  // This SELECT takes no lock, so two instances of the batch job see the same
  // rows — which used to mean each of them forwarded every payment in the
  // overlap, producing N on-chain sends per payment. The mutual exclusion now
  // lives one level down: forwardPaymentSecurely claims each payment with a
  // conditional confirmed -> forwarding update and returns early if it loses.
  // That is the same guarantee SELECT ... FOR UPDATE SKIP LOCKED would give,
  // and it holds across processes and restarts rather than only for the life
  // of a transaction, which matters because the forward spans a chain call.
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
