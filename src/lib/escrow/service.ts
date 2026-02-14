/**
 * Escrow Service
 *
 * Anonymous, non-custodial escrow using platform HD wallet addresses.
 * Both humans and AI agents can create/fund/release/dispute escrows.
 *
 * Flow:
 * 1. Create escrow → generates HD wallet address for deposit
 * 2. Depositor sends crypto to escrow address
 * 3. Monitor detects deposit → status: funded
 * 4. Depositor releases → funds forwarded to beneficiary (minus fee) → settled
 *    OR dispute → arbiter resolves → settled or refunded
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { generatePaymentAddress, type SystemBlockchain } from '../wallets/system-wallet';
import { getFeePercentage } from '../payments/fees';
import { getExchangeRate } from '../rates/tatum';
import { sendEscrowWebhook } from '../webhooks/service';
import type {
  CreateEscrowInput,
  Escrow,
  EscrowPublic,
  EscrowEvent,
  EscrowEventType,
  EscrowStatus,
  EscrowChain,
  CreateEscrowResult,
  EscrowActionResult,
} from './types';

// ── Validation ──────────────────────────────────────────────

const chainSchema = z.enum([
  'BTC', 'BCH', 'ETH', 'POL', 'SOL',
  'DOGE', 'XRP', 'ADA', 'BNB',
  'USDT', 'USDC',
  'USDC_ETH', 'USDC_POL', 'USDC_SOL',
]);

const createEscrowSchema = z.object({
  chain: chainSchema,
  amount: z.number().positive('Amount must be greater than zero'),
  depositor_address: z.string().min(10, 'Invalid depositor address'),
  beneficiary_address: z.string().min(10, 'Invalid beneficiary address'),
  arbiter_address: z.string().min(10).optional(),
  metadata: z.record(z.unknown()).optional(),
  business_id: z.string().uuid().optional(),
  expires_in_hours: z.number().positive().max(720).optional(), // max 30 days
});

// ── Helpers ─────────────────────────────────────────────────

function generateToken(): string {
  return `esc_${randomBytes(32).toString('hex')}`;
}

function stripTokens(escrow: Escrow): EscrowPublic {
  const {
    release_token: _r,
    beneficiary_token: _b,
    escrow_address_id: _e,
    ...pub
  } = escrow;
  return pub;
}

function mapChainToSystemBlockchain(chain: EscrowChain): SystemBlockchain {
  // The system wallet uses the same chain identifiers
  return chain as SystemBlockchain;
}

// ── Event Logging ───────────────────────────────────────────

async function logEvent(
  supabase: SupabaseClient,
  escrowId: string,
  eventType: EscrowEventType,
  actor: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  await supabase.from('escrow_events').insert({
    escrow_id: escrowId,
    event_type: eventType,
    actor,
    details,
  });
}

// ── Core Service ────────────────────────────────────────────

/**
 * Create a new escrow
 */
export async function createEscrow(
  supabase: SupabaseClient,
  input: CreateEscrowInput,
  isPaidTier: boolean = false
): Promise<CreateEscrowResult> {
  // Validate input
  const parsed = createEscrowSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0].message };
  }
  const data = parsed.data;

  // Depositor and beneficiary can't be the same
  if (data.depositor_address === data.beneficiary_address) {
    return { success: false, error: 'Depositor and beneficiary must be different addresses' };
  }

  try {
    // Generate tokens
    const releaseToken = generateToken();
    const beneficiaryToken = generateToken();

    // Create a temporary payment ID for address generation
    // We'll create the escrow row first, then generate the address
    const tempPaymentId = crypto.randomUUID();

    // We need a business_id for generatePaymentAddress — use a system placeholder if none
    const businessId = data.business_id || null;

    // Get USD price for reference
    let amountUsd: number | null = null;
    try {
      const rate = await getExchangeRate(data.chain, 'USD');
      if (rate) {
        amountUsd = data.amount * rate;
      }
    } catch {
      // Price lookup is non-critical
    }

    // Calculate fee
    const feeRate = getFeePercentage(isPaidTier);
    const feeAmount = data.amount * feeRate;

    // Calculate expiry
    const expiresInHours = data.expires_in_hours || 24;
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

    // Generate escrow address using system wallet
    const blockchain = mapChainToSystemBlockchain(data.chain);

    // We need to generate the address. The generatePaymentAddress function
    // requires a payment_id and business_id for the payment_addresses table.
    // For escrow, we'll create a dummy payment reference or generate the address directly.
    const addrResult = await generateEscrowAddress(
      supabase,
      blockchain,
      data.amount,
      data.beneficiary_address,
      isPaidTier
    );

    if (!addrResult.success || !addrResult.address) {
      return { success: false, error: addrResult.error || 'Failed to generate escrow address' };
    }

    // Insert escrow row
    const { data: escrow, error: insertError } = await supabase
      .from('escrows')
      .insert({
        depositor_address: data.depositor_address,
        beneficiary_address: data.beneficiary_address,
        arbiter_address: data.arbiter_address || null,
        escrow_address_id: addrResult.addressId || null,
        escrow_address: addrResult.address,
        chain: data.chain,
        amount: data.amount,
        amount_usd: amountUsd,
        fee_amount: feeAmount,
        status: 'created',
        metadata: data.metadata || {},
        release_token: releaseToken,
        beneficiary_token: beneficiaryToken,
        business_id: businessId,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (insertError || !escrow) {
      return { success: false, error: `Failed to create escrow: ${insertError?.message}` };
    }

    // Log creation event
    await logEvent(supabase, escrow.id, 'created', data.depositor_address, {
      chain: data.chain,
      amount: data.amount,
      amount_usd: amountUsd,
      beneficiary: data.beneficiary_address,
    });

    // Fire webhook if tied to a business
    await sendEscrowWebhook(supabase, businessId || null, escrow.id, 'escrow.created', escrow);

    return {
      success: true,
      escrow: {
        ...stripTokens(escrow as Escrow),
        release_token: releaseToken,
        beneficiary_token: beneficiaryToken,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create escrow',
    };
  }
}

/**
 * Generate an escrow address using the system HD wallet.
 * Similar to generatePaymentAddress but without requiring a payment_id.
 */
async function generateEscrowAddress(
  supabase: SupabaseClient,
  cryptocurrency: SystemBlockchain,
  amount: number,
  beneficiaryWallet: string,
  isPaidTier: boolean
): Promise<{
  success: boolean;
  address?: string;
  addressId?: string;
  error?: string;
}> {
  // Import the address derivation function
  const { deriveSystemPaymentAddress, getCommissionWallet, getCommissionRate } = await import(
    '../wallets/system-wallet'
  );
  const { encrypt } = await import('../crypto/encryption');

  try {
    // Get next index
    const { data: indexData, error: indexError } = await supabase
      .from('system_wallet_indexes')
      .select('next_index')
      .eq('cryptocurrency', cryptocurrency)
      .single();

    let nextIndex = 0;
    if (indexError || !indexData) {
      await supabase.from('system_wallet_indexes').insert({
        cryptocurrency,
        next_index: 1,
      });
    } else {
      nextIndex = indexData.next_index;
      await supabase
        .from('system_wallet_indexes')
        .update({ next_index: nextIndex + 1 })
        .eq('cryptocurrency', cryptocurrency);
    }

    // Derive address
    const derived = await deriveSystemPaymentAddress(cryptocurrency, nextIndex);

    // Encrypt private key
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      return { success: false, error: 'Encryption key not configured' };
    }
    const encryptedPrivateKey = await encrypt(derived.privateKey, encryptionKey);

    // Calculate fee split
    const commissionWallet = getCommissionWallet(cryptocurrency);
    const commissionRate = getCommissionRate(isPaidTier);
    const commissionAmount = amount * commissionRate;
    const beneficiaryAmount = amount - commissionAmount;

    // Store in payment_addresses (reuse existing table for escrow addresses too)
    // We use a special escrow reference pattern for payment_id
    const { data: addrData, error: addrError } = await supabase
      .from('payment_addresses')
      .insert({
        payment_id: null,
        business_id: null,
        cryptocurrency,
        address: derived.address,
        derivation_index: nextIndex,
        derivation_path: derived.derivationPath,
        encrypted_private_key: encryptedPrivateKey,
        merchant_wallet: beneficiaryWallet,
        commission_wallet: commissionWallet,
        amount_expected: amount,
        commission_amount: commissionAmount,
        merchant_amount: beneficiaryAmount,
        is_used: false,
        is_escrow: true,
      })
      .select('id')
      .single();

    if (addrError) {
      return { success: false, error: `Failed to store escrow address: ${addrError.message}` };
    }

    return {
      success: true,
      address: derived.address,
      addressId: addrData?.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate escrow address',
    };
  }
}

/**
 * Get escrow by ID (public view)
 */
export async function getEscrow(
  supabase: SupabaseClient,
  escrowId: string
): Promise<{ success: boolean; escrow?: EscrowPublic; error?: string }> {
  const { data, error } = await supabase
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .single();

  if (error || !data) {
    return { success: false, error: 'Escrow not found' };
  }

  return { success: true, escrow: stripTokens(data as Escrow) };
}

/**
 * Get escrow events (audit log)
 */
export async function getEscrowEvents(
  supabase: SupabaseClient,
  escrowId: string
): Promise<{ success: boolean; events?: EscrowEvent[]; error?: string }> {
  const { data, error } = await supabase
    .from('escrow_events')
    .select('*')
    .eq('escrow_id', escrowId)
    .order('created_at', { ascending: true });

  if (error) {
    return { success: false, error: 'Failed to fetch escrow events' };
  }

  return { success: true, events: (data || []) as EscrowEvent[] };
}

/**
 * List escrows with optional filters
 */
export async function listEscrows(
  supabase: SupabaseClient,
  filters: {
    business_id?: string;
    business_ids?: string[];
    status?: EscrowStatus;
    depositor_address?: string;
    beneficiary_address?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ success: boolean; escrows?: EscrowPublic[]; total?: number; error?: string }> {
  let query = supabase.from('escrows').select('*', { count: 'exact' });

  if (filters.business_id) query = query.eq('business_id', filters.business_id);
  if (filters.business_ids) query = query.in('business_id', filters.business_ids);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.depositor_address) query = query.eq('depositor_address', filters.depositor_address);
  if (filters.beneficiary_address) query = query.eq('beneficiary_address', filters.beneficiary_address);

  query = query
    .order('created_at', { ascending: false })
    .range(filters.offset || 0, (filters.offset || 0) + (filters.limit || 20) - 1);

  const { data, error, count } = await query;

  if (error) {
    return { success: false, error: 'Failed to list escrows' };
  }

  return {
    success: true,
    escrows: (data || []).map((e) => stripTokens(e as Escrow)),
    total: count || 0,
  };
}

// ── Actions ─────────────────────────────────────────────────

/**
 * Authenticate an escrow action.
 * Returns the role of the caller: 'depositor', 'beneficiary', 'arbiter', or null.
 */
function authenticateEscrowAction(
  escrow: Escrow,
  token: string
): 'depositor' | 'beneficiary' | 'arbiter' | null {
  if (token === escrow.release_token) return 'depositor';
  if (token === escrow.beneficiary_token) return 'beneficiary';
  // Arbiter auth would be signature-based in v2
  return null;
}

/**
 * Release funds to beneficiary.
 * Only the depositor (via release_token) can do this.
 */
export async function releaseEscrow(
  supabase: SupabaseClient,
  escrowId: string,
  releaseToken: string
): Promise<EscrowActionResult> {
  // Fetch escrow with tokens
  const { data, error } = await supabase
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .single();

  if (error || !data) {
    return { success: false, error: 'Escrow not found' };
  }

  const escrow = data as Escrow;

  // Authenticate
  const role = authenticateEscrowAction(escrow, releaseToken);
  if (role !== 'depositor') {
    return { success: false, error: 'Unauthorized: invalid release token' };
  }

  // Only funded or disputed escrows can be released
  if (escrow.status !== 'funded' && escrow.status !== 'disputed') {
    return { success: false, error: `Cannot release escrow in status: ${escrow.status}` };
  }

  // Update status to released
  const { data: updated, error: updateError } = await supabase
    .from('escrows')
    .update({
      status: 'released',
      released_at: new Date().toISOString(),
    })
    .eq('id', escrowId)
    .eq('status', escrow.status) // optimistic lock
    .select()
    .single();

  if (updateError || !updated) {
    return { success: false, error: 'Failed to release escrow (concurrent modification?)' };
  }

  await logEvent(supabase, escrowId, 'released', escrow.depositor_address, {
    beneficiary: escrow.beneficiary_address,
    amount: escrow.deposited_amount || escrow.amount,
  });

  await sendEscrowWebhook(supabase, escrow.business_id, escrowId, 'escrow.released', updated);

  return { success: true, escrow: stripTokens(updated as Escrow) };
}

/**
 * Request refund (depositor only, before release).
 * Only allowed in 'funded' status.
 */
export async function refundEscrow(
  supabase: SupabaseClient,
  escrowId: string,
  releaseToken: string
): Promise<EscrowActionResult> {
  const { data, error } = await supabase
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .single();

  if (error || !data) {
    return { success: false, error: 'Escrow not found' };
  }

  const escrow = data as Escrow;

  const role = authenticateEscrowAction(escrow, releaseToken);
  if (role !== 'depositor') {
    return { success: false, error: 'Unauthorized: invalid release token' };
  }

  // Only funded escrows can be refunded (not yet released)
  if (escrow.status !== 'funded') {
    return { success: false, error: `Cannot refund escrow in status: ${escrow.status}` };
  }

  const { data: updated, error: updateError } = await supabase
    .from('escrows')
    .update({
      status: 'refunded',
      refunded_at: new Date().toISOString(),
    })
    .eq('id', escrowId)
    .eq('status', 'funded')
    .select()
    .single();

  if (updateError || !updated) {
    return { success: false, error: 'Failed to refund escrow' };
  }

  await logEvent(supabase, escrowId, 'refunded', escrow.depositor_address, {
    refund_to: escrow.depositor_address,
    amount: escrow.deposited_amount || escrow.amount,
  });

  await sendEscrowWebhook(supabase, escrow.business_id, escrowId, 'escrow.refunded', updated);

  return { success: true, escrow: stripTokens(updated as Escrow) };
}

/**
 * Open a dispute. Either party can do this.
 */
export async function disputeEscrow(
  supabase: SupabaseClient,
  escrowId: string,
  token: string,
  reason: string
): Promise<EscrowActionResult> {
  const { data, error } = await supabase
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .single();

  if (error || !data) {
    return { success: false, error: 'Escrow not found' };
  }

  const escrow = data as Escrow;

  const role = authenticateEscrowAction(escrow, token);
  if (!role || role === 'arbiter') {
    return { success: false, error: 'Unauthorized' };
  }

  if (escrow.status !== 'funded') {
    return { success: false, error: `Cannot dispute escrow in status: ${escrow.status}` };
  }

  if (!reason || reason.trim().length < 10) {
    return { success: false, error: 'Dispute reason must be at least 10 characters' };
  }

  const { data: updated, error: updateError } = await supabase
    .from('escrows')
    .update({
      status: 'disputed',
      disputed_at: new Date().toISOString(),
      dispute_reason: reason,
    })
    .eq('id', escrowId)
    .eq('status', 'funded')
    .select()
    .single();

  if (updateError || !updated) {
    return { success: false, error: 'Failed to dispute escrow' };
  }

  await logEvent(supabase, escrowId, 'disputed', escrow[`${role}_address`] as string, {
    role,
    reason,
  });

  await sendEscrowWebhook(supabase, escrow.business_id, escrowId, 'escrow.disputed', updated);

  return { success: true, escrow: stripTokens(updated as Escrow) };
}

/**
 * Mark escrow as funded (called by balance monitor when deposit is detected).
 */
export async function markEscrowFunded(
  supabase: SupabaseClient,
  escrowId: string,
  depositedAmount: number,
  txHash: string
): Promise<EscrowActionResult> {
  const { data: updated, error } = await supabase
    .from('escrows')
    .update({
      status: 'funded',
      funded_at: new Date().toISOString(),
      deposited_amount: depositedAmount,
      deposit_tx_hash: txHash,
    })
    .eq('id', escrowId)
    .eq('status', 'created')
    .select()
    .single();

  if (error || !updated) {
    return { success: false, error: 'Failed to mark escrow as funded' };
  }

  await logEvent(supabase, escrowId, 'funded', 'system', {
    deposited_amount: depositedAmount,
    tx_hash: txHash,
  });

  // Fire webhook
  const escrowFull = updated as Escrow;
  await sendEscrowWebhook(supabase, escrowFull.business_id, escrowId, 'escrow.funded', updated);

  return { success: true, escrow: stripTokens(updated as Escrow) };
}

/**
 * Mark escrow as settled (called after funds are forwarded on-chain).
 */
export async function markEscrowSettled(
  supabase: SupabaseClient,
  escrowId: string,
  settlementTxHash: string,
  feeTxHash?: string
): Promise<EscrowActionResult> {
  const { data: updated, error } = await supabase
    .from('escrows')
    .update({
      status: 'settled',
      settled_at: new Date().toISOString(),
      settlement_tx_hash: settlementTxHash,
      fee_tx_hash: feeTxHash || null,
    })
    .eq('id', escrowId)
    .eq('status', 'released')
    .select()
    .single();

  if (error || !updated) {
    return { success: false, error: 'Failed to mark escrow as settled' };
  }

  await logEvent(supabase, escrowId, 'settled', 'system', {
    settlement_tx_hash: settlementTxHash,
    fee_tx_hash: feeTxHash,
  });

  const escrowFull = updated as Escrow;
  await sendEscrowWebhook(supabase, escrowFull.business_id, escrowId, 'escrow.settled', updated);

  return { success: true, escrow: stripTokens(updated as Escrow) };
}

/**
 * Expire escrows that were never funded.
 * Called by cron job.
 */
export async function expireStaleEscrows(
  supabase: SupabaseClient
): Promise<{ expired: number }> {
  const { data, error } = await supabase
    .from('escrows')
    .update({
      status: 'expired',
    })
    .eq('status', 'created')
    .lt('expires_at', new Date().toISOString())
    .select('id');

  if (error || !data) {
    return { expired: 0 };
  }

  // Log events for each expired escrow
  for (const escrow of data) {
    await logEvent(supabase, escrow.id, 'expired', 'system', {});
  }

  return { expired: data.length };
}
