/**
 * Affiliate/Referral Payout Service
 *
 * Handles creating and processing crypto payouts from business wallets
 * to affiliate/referral recipients.
 *
 * Uses existing blockchain providers for transaction sending and
 * existing rate service for USD→crypto conversion.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;
import { decrypt } from '@/lib/crypto/encryption';
import {
  getProvider,
  getRpcUrl,
  type BlockchainType,
} from '@/lib/blockchain/providers';
import { getCryptoPrice } from '@/lib/rates/tatum';
import { requireEncryptionKey } from '../crypto/require-key';

// ─── Types ───────────────────────────────────────────────────────

export interface CreatePayoutInput {
  recipient_email: string;
  recipient_wallet: string;
  cryptocurrency?: string;
  amount_usd: number;
  metadata?: Record<string, unknown>;
}

export interface PayoutRecord {
  id: string;
  business_id: string;
  recipient_email: string;
  recipient_wallet: string;
  cryptocurrency: string;
  amount_usd: number;
  amount_crypto: number | null;
  tx_hash: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
}

export interface PayoutResult {
  success: boolean;
  payout?: PayoutRecord;
  error?: string;
}

export interface PayoutListResult {
  success: boolean;
  payouts?: PayoutRecord[];
  total?: number;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Resolve the base crypto symbol for price lookups.
 * e.g. USDT_ETH → USDT, USDC_SOL → USDC
 */
function baseCryptoSymbol(crypto: string): string {
  if (crypto.startsWith('USDT')) return 'USDT';
  if (crypto.startsWith('USDC')) return 'USDC';
  return crypto;
}

/**
 * Basic wallet address format validation.
 * Does not guarantee on-chain validity but catches obvious mistakes.
 */
function isPlausibleWalletAddress(address: string, crypto: string): boolean {
  if (!address || address.length < 20) return false;

  const upper = crypto.toUpperCase();

  // EVM-compatible chains
  if (['ETH', 'POL', 'BNB', 'USDT', 'USDT_ETH', 'USDT_POL', 'USDC', 'USDC_ETH', 'USDC_POL'].includes(upper)) {
    return /^0x[0-9a-fA-F]{40}$/.test(address);
  }
  // Solana
  if (['SOL', 'USDT_SOL', 'USDC_SOL'].includes(upper)) {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }
  // Bitcoin / BCH / Doge
  if (['BTC', 'BCH', 'DOGE'].includes(upper)) {
    return address.length >= 25 && address.length <= 62;
  }
  // XRP
  if (upper === 'XRP') {
    return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address);
  }
  // ADA
  if (upper === 'ADA') {
    return address.length >= 50;
  }

  // Unknown chain — accept if at least 20 chars
  return true;
}

// ─── Core Functions ──────────────────────────────────────────────

/**
 * Fetch the business's wallet for a given cryptocurrency,
 * including the encrypted private key needed for sending.
 */
async function getBusinessSendWallet(
  supabase: SupabaseClient,
  businessId: string,
  cryptocurrency: string
): Promise<{
  wallet_address: string;
  encrypted_private_key: string;
} | null> {
  const { data, error } = await supabase
    .from('business_wallets')
    .select('wallet_address, encrypted_private_key')
    .eq('business_id', businessId)
    .eq('cryptocurrency', cryptocurrency)
    .eq('is_active', true)
    .single();

  if (error || !data || !data.encrypted_private_key) {
    return null;
  }

  return data;
}

/**
 * Create and process an affiliate payout.
 *
 * Flow:
 * 1. Validate input
 * 2. Look up business wallet with private key
 * 3. Convert USD → crypto using live rates
 * 4. Check on-chain balance
 * 5. Create payout record (status=pending)
 * 6. Send transaction
 * 7. Update record to completed/failed
 */
export async function createPayout(
  supabase: SupabaseClient,
  businessId: string,
  input: CreatePayoutInput
): Promise<PayoutResult> {
  const cryptocurrency = (input.cryptocurrency || 'USDT').toUpperCase();

  // ── Validate input ──
  if (!input.recipient_email || !input.recipient_email.includes('@')) {
    return { success: false, error: 'Valid recipient_email is required' };
  }
  if (!input.recipient_wallet) {
    return { success: false, error: 'recipient_wallet is required' };
  }
  if (!input.amount_usd || input.amount_usd <= 0) {
    return { success: false, error: 'amount_usd must be greater than 0' };
  }
  if (!isPlausibleWalletAddress(input.recipient_wallet, cryptocurrency)) {
    return { success: false, error: `Invalid wallet address format for ${cryptocurrency}` };
  }

  // ── Verify business exists ──
  const { data: business, error: bizErr } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .single();

  if (bizErr || !business) {
    return { success: false, error: 'Business not found' };
  }

  // ── Get business wallet with private key ──
  const wallet = await getBusinessSendWallet(supabase, businessId, cryptocurrency);
  if (!wallet) {
    return {
      success: false,
      error: `No active wallet with a private key found for ${cryptocurrency}. ` +
        'A wallet with an encrypted private key is required to send payouts.',
    };
  }

  // ── Convert USD → crypto ──
  let amountCrypto: number;
  try {
    amountCrypto = await getCryptoPrice(input.amount_usd, 'USD', baseCryptoSymbol(cryptocurrency));
  } catch (err) {
    return {
      success: false,
      error: `Failed to fetch exchange rate: ${err instanceof Error ? err.message : err}`,
    };
  }

  // ── Check on-chain balance ──
  const chain = cryptocurrency as BlockchainType;
  const rpcUrl = getRpcUrl(chain);
  const provider = getProvider(chain, rpcUrl);

  let balance: string;
  try {
    balance = await provider.getBalance(wallet.wallet_address);
  } catch (err) {
    return {
      success: false,
      error: `Failed to check wallet balance: ${err instanceof Error ? err.message : err}`,
    };
  }

  const balanceNum = parseFloat(balance);
  if (isNaN(balanceNum) || balanceNum < amountCrypto) {
    return {
      success: false,
      error: `Insufficient balance. Wallet has ${balance} ${cryptocurrency}, need ${amountCrypto.toFixed(8)} ${cryptocurrency} ($${input.amount_usd} USD)`,
    };
  }

  // ── Create payout record ──
  const { data: payout, error: insertErr } = await supabase
    .from('affiliate_payouts')
    .insert({
      business_id: businessId,
      recipient_email: input.recipient_email,
      recipient_wallet: input.recipient_wallet,
      cryptocurrency,
      amount_usd: input.amount_usd,
      amount_crypto: amountCrypto,
      status: 'processing',
      metadata: input.metadata || {},
    })
    .select()
    .single();

  if (insertErr || !payout) {
    return {
      success: false,
      error: `Failed to create payout record: ${insertErr?.message || 'Unknown error'}`,
    };
  }

  // ── Decrypt private key & send transaction ──
  try {
    const privateKey = decrypt(wallet.encrypted_private_key, requireEncryptionKey('payout'));

    if (!provider.sendTransaction) {
      throw new Error(`${cryptocurrency} provider does not support sending transactions`);
    }

    const txHash = await provider.sendTransaction(
      wallet.wallet_address,
      input.recipient_wallet,
      amountCrypto.toString(),
      privateKey
    );

    // ── Mark completed ──
    const { data: updated, error: updateErr } = await supabase
      .from('affiliate_payouts')
      .update({
        status: 'completed',
        tx_hash: txHash,
        completed_at: new Date().toISOString(),
      })
      .eq('id', payout.id)
      .select()
      .single();

    if (updateErr) {
      console.error(`[PAYOUT] Failed to update payout ${payout.id} to completed:`, updateErr);
    }

    return { success: true, payout: updated || { ...payout, status: 'completed', tx_hash: txHash } };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Distinguish "the transaction was never broadcast" from "we do not know".
    //
    // Every failure used to be recorded as 'failed', and retryPayout re-sends
    // anything marked failed. But a timeout or dropped connection can happen
    // AFTER the node accepted the transaction — the payout is on-chain and we
    // simply never heard back. Retrying that pays the affiliate twice, with no
    // way to claw it back. An ambiguous error is therefore recorded as
    // 'indeterminate', which the retry path refuses to touch until someone has
    // checked the chain.
    const ambiguous = isAmbiguousBroadcastError(err);
    const status = ambiguous ? 'indeterminate' : 'failed';

    const { data: updated } = await supabase
      .from('affiliate_payouts')
      .update({
        status,
        error_message: ambiguous
          ? `${errorMessage} (broadcast outcome unknown — verify on-chain before retrying)`
          : errorMessage,
      })
      .eq('id', payout.id)
      .select()
      .single();

    return {
      success: false,
      payout: updated || { ...payout, status, error_message: errorMessage },
      error: ambiguous
        ? `Payout outcome unknown: ${errorMessage}. The transaction may have been broadcast; ` +
          `verify on-chain before retrying.`
        : `Payout transaction failed: ${errorMessage}`,
    };
  }
}

/**
 * Whether a send error leaves the broadcast outcome unknown.
 *
 * A rejection from the node (insufficient funds, bad nonce, malformed tx) means
 * nothing was broadcast and a retry is safe. A timeout, abort, or transport
 * error means the request may well have been accepted — retrying could send
 * the funds a second time.
 */
function isAmbiguousBroadcastError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();

  const definitelyNotBroadcast = [
    'insufficient funds',
    'insufficient balance',
    'invalid address',
    'nonce too low',
    'does not support sending',
    'encryption_key not configured',
    'exceeds balance',
    'malformed',
  ];
  if (definitelyNotBroadcast.some((needle) => message.includes(needle))) {
    return false;
  }

  const ambiguous = [
    'timeout',
    'timed out',
    'etimedout',
    'econnreset',
    'econnaborted',
    'socket hang up',
    'network',
    'fetch failed',
    'aborted',
    'esockettimedout',
    'gateway',
    '502',
    '503',
    '504',
  ];
  if (ambiguous.some((needle) => message.includes(needle))) {
    return true;
  }

  // Unrecognized failures are treated as ambiguous. Paying twice is worse than
  // asking a human to look, so the uncertain case fails safe.
  return true;
}

/**
 * Resolve a payout whose broadcast outcome was never determined.
 *
 * N-03: `indeterminate` had no exit. A payout entered it when the broadcast
 * result was ambiguous — a timeout after the node may already have accepted the
 * transaction — and `retryPayout` refuses to touch one, correctly, because
 * re-sending could pay the recipient twice. Its error message told the operator
 * to "mark the payout completed with its tx_hash" or "mark it failed and
 * retry", and **no route or function existed to do either**. The state was a
 * dead end that described a procedure nobody could carry out.
 *
 * This is the missing transition, and it is deliberately manual: only a human
 * who has looked at the chain can say which way it went. Nothing here inspects
 * the chain itself, because a wrong automatic answer either pays twice or
 * strands a real payment.
 *
 * @param resolution - `completed` (the transfer landed; `txHash` is required so
 *   the record points at it) or `failed` (it did not; the payout becomes
 *   retryable again).
 */
export async function resolveIndeterminatePayout(
  supabase: SupabaseClient,
  businessId: string,
  payoutId: string,
  resolution: 'completed' | 'failed',
  txHash?: string
): Promise<PayoutResult> {
  if (resolution === 'completed' && !txHash?.trim()) {
    return {
      success: false,
      error: 'A transaction hash is required to mark a payout completed — it is the evidence the transfer landed.',
    };
  }

  const { data: payout, error } = await supabase
    .from('affiliate_payouts')
    .select('*')
    .eq('id', payoutId)
    .eq('business_id', businessId)
    .single();

  if (error || !payout) {
    return { success: false, error: 'Payout not found' };
  }

  if (payout.status !== 'indeterminate') {
    return {
      success: false,
      error: `Only an indeterminate payout can be resolved this way; this one is '${payout.status}'.`,
    };
  }

  // Conditioned on the status still being indeterminate, so two operators
  // resolving the same payout cannot both apply an outcome.
  const { data: updated } = await supabase
    .from('affiliate_payouts')
    .update({
      status: resolution,
      ...(resolution === 'completed' ? { tx_hash: txHash!.trim(), paid_at: new Date().toISOString() } : {}),
      error_message:
        resolution === 'completed'
          ? null
          : 'Broadcast confirmed not to have landed; resolved manually and available for retry.',
      updated_at: new Date().toISOString(),
    })
    .eq('id', payoutId)
    .eq('status', 'indeterminate')
    .select()
    .maybeSingle();

  if (!updated) {
    return { success: false, error: 'Payout was resolved by someone else while this request was in flight.' };
  }

  return { success: true, payout: updated };
}

/**
 * Retry a failed payout.
 */
export async function retryPayout(
  supabase: SupabaseClient,
  businessId: string,
  payoutId: string
): Promise<PayoutResult> {
  // Fetch the existing payout
  const { data: payout, error } = await supabase
    .from('affiliate_payouts')
    .select('*')
    .eq('id', payoutId)
    .eq('business_id', businessId)
    .single();

  if (error || !payout) {
    return { success: false, error: 'Payout not found' };
  }

  if (payout.status === 'indeterminate') {
    return {
      success: false,
      error:
        `Payout ${payoutId} has an unknown broadcast outcome and cannot be retried automatically. ` +
        `Check ${payout.recipient_wallet} on-chain, then PATCH this payout with ` +
        `{"resolution":"completed","tx_hash":"..."} if the transfer landed, or ` +
        `{"resolution":"failed"} if it did not — which makes it retryable again.`,
    };
  }

  if (payout.status !== 'failed') {
    return { success: false, error: `Cannot retry payout with status '${payout.status}'. Only failed payouts can be retried.` };
  }

  // Reset to pending, conditioned on the status we read, so two concurrent
  // retries cannot both proceed to send.
  const { data: resetRows } = await supabase
    .from('affiliate_payouts')
    .update({ status: 'pending', error_message: null })
    .eq('id', payoutId)
    .eq('status', 'failed')
    .select('id');

  if (!resetRows || resetRows.length === 0) {
    return { success: false, error: 'Payout is already being retried' };
  }

  // Re-process
  return createPayout(supabase, businessId, {
    recipient_email: payout.recipient_email,
    recipient_wallet: payout.recipient_wallet,
    cryptocurrency: payout.cryptocurrency,
    amount_usd: parseFloat(payout.amount_usd),
    metadata: { ...(payout.metadata || {}), retried_from: payoutId },
  });
}

/**
 * List payouts for a business with optional filters and pagination.
 */
export async function listPayouts(
  supabase: SupabaseClient,
  businessId: string,
  options: {
    status?: string;
    email?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<PayoutListResult> {
  const { status, email, limit = 50, offset = 0 } = options;

  let query = supabase
    .from('affiliate_payouts')
    .select('*', { count: 'exact' })
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq('status', status);
  }
  if (email) {
    query = query.eq('recipient_email', email);
  }

  const { data, error, count } = await query;

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, payouts: data || [], total: count || 0 };
}

/**
 * Get a single payout by ID.
 */
export async function getPayout(
  supabase: SupabaseClient,
  businessId: string,
  payoutId: string
): Promise<PayoutResult> {
  const { data, error } = await supabase
    .from('affiliate_payouts')
    .select('*')
    .eq('id', payoutId)
    .eq('business_id', businessId)
    .single();

  if (error || !data) {
    return { success: false, error: 'Payout not found' };
  }

  return { success: true, payout: data };
}
