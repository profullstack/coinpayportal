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
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY not configured');
    }

    const privateKey = decrypt(wallet.encrypted_private_key, encryptionKey);

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

    // ── Mark failed ──
    const { data: updated } = await supabase
      .from('affiliate_payouts')
      .update({
        status: 'failed',
        error_message: errorMessage,
      })
      .eq('id', payout.id)
      .select()
      .single();

    return {
      success: false,
      payout: updated || { ...payout, status: 'failed', error_message: errorMessage },
      error: `Payout transaction failed: ${errorMessage}`,
    };
  }
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

  if (payout.status !== 'failed') {
    return { success: false, error: `Cannot retry payout with status '${payout.status}'. Only failed payouts can be retried.` };
  }

  // Reset to pending
  await supabase
    .from('affiliate_payouts')
    .update({ status: 'pending', error_message: null })
    .eq('id', payoutId);

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
