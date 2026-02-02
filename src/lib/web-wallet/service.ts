/**
 * Web Wallet Service
 *
 * CRUD operations for anonymous wallets, addresses, and auth challenges.
 * All operations use Supabase via service role (server-side only).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  validateSecp256k1PublicKey,
  validateEd25519PublicKey,
  validateAddress,
  validateDerivationPath,
  isValidChain,
  VALID_CHAINS,
  type WalletChain,
} from './identity';
import { generateChallenge, verifyChallengeSignature, generateWalletToken } from './auth';

// ──────────────────────────────────────────────
// Validation schemas
// ──────────────────────────────────────────────

const addressInputSchema = z.object({
  chain: z.string().refine((v) => isValidChain(v), { message: 'Invalid chain' }),
  address: z.string().min(1, 'Address is required'),
  derivation_path: z.string().min(1, 'Derivation path is required'),
});

const createWalletSchema = z.object({
  public_key_secp256k1: z.string().optional(),
  public_key_ed25519: z.string().optional(),
  initial_addresses: z.array(addressInputSchema).optional().default([]),
}).refine(
  (data) => data.public_key_secp256k1 || data.public_key_ed25519,
  { message: 'At least one public key must be provided' }
);

const importWalletSchema = z.object({
  public_key_secp256k1: z.string().optional(),
  public_key_ed25519: z.string().optional(),
  addresses: z.array(addressInputSchema).optional().default([]),
  proof_of_ownership: z.object({
    message: z.string().min(1),
    signature: z.string().min(1),
  }),
}).refine(
  (data) => data.public_key_secp256k1 || data.public_key_ed25519,
  { message: 'At least one public key must be provided' }
);

const deriveAddressSchema = z.object({
  chain: z.string().refine((v) => isValidChain(v), { message: 'Invalid chain' }),
  address: z.string().min(1, 'Address is required'),
  derivation_index: z.number().int().min(0),
  derivation_path: z.string().min(1, 'Derivation path is required'),
});

// ──────────────────────────────────────────────
// Result types
// ──────────────────────────────────────────────

interface ServiceResult<T = Record<string, unknown>> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

// ──────────────────────────────────────────────
// Wallet CRUD
// ──────────────────────────────────────────────

export async function createWallet(
  supabase: SupabaseClient,
  body: unknown
): Promise<ServiceResult> {
  const parsed = createWalletSchema.safeParse(body);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message, code: 'VALIDATION_ERROR' };
  }

  const { public_key_secp256k1, public_key_ed25519, initial_addresses } = parsed.data;

  // Validate public keys
  if (public_key_secp256k1 && !validateSecp256k1PublicKey(public_key_secp256k1)) {
    return { success: false, error: 'Invalid secp256k1 public key', code: 'INVALID_KEY' };
  }
  if (public_key_ed25519 && !validateEd25519PublicKey(public_key_ed25519)) {
    return { success: false, error: 'Invalid ed25519 public key', code: 'INVALID_KEY' };
  }

  // Validate addresses
  for (const addr of initial_addresses) {
    if (!validateAddress(addr.address, addr.chain as WalletChain)) {
      return {
        success: false,
        error: `Invalid ${addr.chain} address: ${addr.address}`,
        code: 'INVALID_ADDRESS',
      };
    }
    if (!validateDerivationPath(addr.derivation_path, addr.chain as WalletChain)) {
      return {
        success: false,
        error: `Invalid derivation path: ${addr.derivation_path}`,
        code: 'INVALID_DERIVATION_PATH',
      };
    }
  }

  // Check for existing wallet with same public key
  if (public_key_secp256k1) {
    const { data: existing } = await supabase
      .from('wallets')
      .select('id')
      .eq('public_key_secp256k1', public_key_secp256k1)
      .single();
    if (existing) {
      return {
        success: false,
        error: 'Wallet with this secp256k1 public key already exists',
        code: 'DUPLICATE_KEY',
      };
    }
  }

  // Insert wallet
  const { data: wallet, error: walletError } = await supabase
    .from('wallets')
    .insert({
      public_key_secp256k1: public_key_secp256k1 || null,
      public_key_ed25519: public_key_ed25519 || null,
      status: 'active',
    })
    .select('id, created_at')
    .single();

  if (walletError || !wallet) {
    return { success: false, error: walletError?.message || 'Failed to create wallet', code: 'INTERNAL_ERROR' };
  }

  // Insert initial addresses
  const addressResults = [];
  for (const addr of initial_addresses) {
    const { data: addrData, error: addrError } = await supabase
      .from('wallet_addresses')
      .insert({
        wallet_id: wallet.id,
        chain: addr.chain,
        address: addr.address,
        derivation_path: addr.derivation_path,
        derivation_index: extractDerivationIndex(addr.derivation_path),
        is_active: true,
      })
      .select('chain, address, derivation_index')
      .single();

    if (addrData) {
      addressResults.push(addrData);
    } else if (addrError) {
      console.warn(`Failed to insert ${addr.chain} address: ${addrError.message}`);
    }
  }

  // Create default settings
  await supabase.from('wallet_settings').insert({ wallet_id: wallet.id });

  return {
    success: true,
    data: {
      wallet_id: wallet.id,
      created_at: wallet.created_at,
      addresses: addressResults,
    },
  };
}

export async function importWallet(
  supabase: SupabaseClient,
  body: unknown
): Promise<ServiceResult> {
  const parsed = importWalletSchema.safeParse(body);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message, code: 'VALIDATION_ERROR' };
  }

  const { public_key_secp256k1, public_key_ed25519, addresses, proof_of_ownership } = parsed.data;

  // Validate public keys
  if (public_key_secp256k1 && !validateSecp256k1PublicKey(public_key_secp256k1)) {
    return { success: false, error: 'Invalid secp256k1 public key', code: 'INVALID_KEY' };
  }
  if (public_key_ed25519 && !validateEd25519PublicKey(public_key_ed25519)) {
    return { success: false, error: 'Invalid ed25519 public key', code: 'INVALID_KEY' };
  }

  // Verify proof of ownership (secp256k1 signature on the message)
  if (public_key_secp256k1) {
    const valid = verifyChallengeSignature(
      proof_of_ownership.message,
      proof_of_ownership.signature,
      public_key_secp256k1
    );
    if (!valid) {
      return { success: false, error: 'Invalid proof of ownership signature', code: 'INVALID_SIGNATURE' };
    }
  }

  // Check if wallet already exists with this key
  if (public_key_secp256k1) {
    const { data: existing } = await supabase
      .from('wallets')
      .select('id')
      .eq('public_key_secp256k1', public_key_secp256k1)
      .single();
    if (existing) {
      // Wallet exists — register any missing addresses (e.g. USDC variants added later)
      let newAddresses = 0;
      for (const addr of addresses) {
        if (!validateAddress(addr.address, addr.chain as WalletChain)) continue;
        const { error: addrError } = await supabase
          .from('wallet_addresses')
          .upsert({
            wallet_id: existing.id,
            chain: addr.chain,
            address: addr.address,
            derivation_path: addr.derivation_path,
            derivation_index: extractDerivationIndex(addr.derivation_path),
            is_active: true,
          }, { onConflict: 'address,chain', ignoreDuplicates: true });
        if (!addrError) newAddresses++;
      }
      return {
        success: true,
        data: {
          wallet_id: existing.id,
          imported: false,
          already_exists: true,
          addresses_registered: newAddresses,
        },
      };
    }
  }

  // Validate addresses
  for (const addr of addresses) {
    if (!validateAddress(addr.address, addr.chain as WalletChain)) {
      return {
        success: false,
        error: `Invalid ${addr.chain} address: ${addr.address}`,
        code: 'INVALID_ADDRESS',
      };
    }
  }

  // Insert wallet
  const { data: wallet, error: walletError } = await supabase
    .from('wallets')
    .insert({
      public_key_secp256k1: public_key_secp256k1 || null,
      public_key_ed25519: public_key_ed25519 || null,
      status: 'active',
    })
    .select('id, created_at')
    .single();

  if (walletError || !wallet) {
    return { success: false, error: walletError?.message || 'Failed to create wallet', code: 'INTERNAL_ERROR' };
  }

  // Insert addresses (upsert to handle duplicate address+chain gracefully)
  let addressCount = 0;
  for (const addr of addresses) {
    const { error: addrError } = await supabase
      .from('wallet_addresses')
      .upsert({
        wallet_id: wallet.id,
        chain: addr.chain,
        address: addr.address,
        derivation_path: addr.derivation_path,
        derivation_index: extractDerivationIndex(addr.derivation_path),
        is_active: true,
      }, { onConflict: 'address,chain', ignoreDuplicates: true });
    if (!addrError) addressCount++;
  }

  // Create default settings
  await supabase.from('wallet_settings').insert({ wallet_id: wallet.id });

  return {
    success: true,
    data: {
      wallet_id: wallet.id,
      imported: true,
      addresses_registered: addressCount,
      created_at: wallet.created_at,
    },
  };
}

export async function getWallet(
  supabase: SupabaseClient,
  walletId: string
): Promise<ServiceResult> {
  const { data: wallet, error } = await supabase
    .from('wallets')
    .select('id, status, created_at, last_active_at')
    .eq('id', walletId)
    .single();

  if (error || !wallet) {
    return { success: false, error: 'Wallet not found', code: 'WALLET_NOT_FOUND' };
  }

  // Get address count
  const { count } = await supabase
    .from('wallet_addresses')
    .select('*', { count: 'exact', head: true })
    .eq('wallet_id', walletId)
    .eq('is_active', true);

  // Get settings
  const { data: settings } = await supabase
    .from('wallet_settings')
    .select('daily_spend_limit, whitelist_enabled, require_confirmation')
    .eq('wallet_id', walletId)
    .single();

  return {
    success: true,
    data: {
      wallet_id: wallet.id,
      status: wallet.status,
      created_at: wallet.created_at,
      last_active_at: wallet.last_active_at,
      address_count: count || 0,
      settings: settings || {
        daily_spend_limit: null,
        whitelist_enabled: false,
        require_confirmation: false,
      },
    },
  };
}

// ──────────────────────────────────────────────
// Address operations
// ──────────────────────────────────────────────

export async function deriveAddress(
  supabase: SupabaseClient,
  walletId: string,
  body: unknown
): Promise<ServiceResult> {
  const parsed = deriveAddressSchema.safeParse(body);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message, code: 'VALIDATION_ERROR' };
  }

  const { chain, address, derivation_index, derivation_path } = parsed.data;

  // Validate address format
  if (!validateAddress(address, chain as WalletChain)) {
    return { success: false, error: `Invalid ${chain} address`, code: 'INVALID_ADDRESS' };
  }

  if (!validateDerivationPath(derivation_path, chain as WalletChain)) {
    return { success: false, error: 'Invalid derivation path', code: 'INVALID_DERIVATION_PATH' };
  }

  // Check wallet exists
  const { data: wallet } = await supabase
    .from('wallets')
    .select('id')
    .eq('id', walletId)
    .single();

  if (!wallet) {
    return { success: false, error: 'Wallet not found', code: 'WALLET_NOT_FOUND' };
  }

  // Check for duplicate address
  const { data: existing } = await supabase
    .from('wallet_addresses')
    .select('id')
    .eq('wallet_id', walletId)
    .eq('address', address)
    .single();

  if (existing) {
    return { success: false, error: 'Address already registered', code: 'DUPLICATE_ADDRESS' };
  }

  // Insert address
  const { data: addrData, error: addrError } = await supabase
    .from('wallet_addresses')
    .insert({
      wallet_id: walletId,
      chain,
      address,
      derivation_path,
      derivation_index,
      is_active: true,
    })
    .select('id, chain, address, derivation_index, derivation_path, created_at')
    .single();

  if (addrError || !addrData) {
    return { success: false, error: addrError?.message || 'Failed to derive address', code: 'INTERNAL_ERROR' };
  }

  return {
    success: true,
    data: {
      address_id: addrData.id,
      chain: addrData.chain,
      address: addrData.address,
      derivation_index: addrData.derivation_index,
      derivation_path: addrData.derivation_path,
      created_at: addrData.created_at,
    },
  };
}

export async function listAddresses(
  supabase: SupabaseClient,
  walletId: string,
  options: { chain?: string; active_only?: boolean }
): Promise<ServiceResult> {
  let query = supabase
    .from('wallet_addresses')
    .select('id, chain, address, derivation_index, is_active, cached_balance, cached_balance_updated_at')
    .eq('wallet_id', walletId)
    .order('created_at', { ascending: true });

  if (options.chain) {
    query = query.eq('chain', options.chain);
  }
  if (options.active_only) {
    query = query.eq('is_active', true);
  }

  const { data: addresses, error } = await query;

  if (error) {
    return { success: false, error: error.message, code: 'INTERNAL_ERROR' };
  }

  return {
    success: true,
    data: {
      addresses: (addresses || []).map((a) => ({
        address_id: a.id,
        chain: a.chain,
        address: a.address,
        derivation_index: a.derivation_index,
        is_active: a.is_active,
        cached_balance: a.cached_balance,
        balance_updated_at: a.cached_balance_updated_at,
      })),
      total: addresses?.length || 0,
    },
  };
}

export async function deactivateAddress(
  supabase: SupabaseClient,
  walletId: string,
  addressId: string
): Promise<ServiceResult> {
  const { data, error } = await supabase
    .from('wallet_addresses')
    .update({ is_active: false })
    .eq('id', addressId)
    .eq('wallet_id', walletId)
    .select('id, is_active')
    .single();

  if (error || !data) {
    return { success: false, error: 'Address not found', code: 'ADDRESS_NOT_FOUND' };
  }

  return {
    success: true,
    data: {
      address_id: data.id,
      is_active: false,
      deactivated_at: new Date().toISOString(),
    },
  };
}

// ──────────────────────────────────────────────
// Auth challenge operations
// ──────────────────────────────────────────────

export async function createAuthChallenge(
  supabase: SupabaseClient,
  walletId: string
): Promise<ServiceResult> {
  // Verify wallet exists
  const { data: wallet } = await supabase
    .from('wallets')
    .select('id')
    .eq('id', walletId)
    .single();

  if (!wallet) {
    return { success: false, error: 'Wallet not found', code: 'WALLET_NOT_FOUND' };
  }

  const challenge = generateChallenge();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  const { data, error } = await supabase
    .from('wallet_auth_challenges')
    .insert({
      wallet_id: walletId,
      challenge,
      expires_at: expiresAt.toISOString(),
    })
    .select('id, challenge, expires_at')
    .single();

  if (error || !data) {
    return { success: false, error: error?.message || 'Failed to create challenge', code: 'INTERNAL_ERROR' };
  }

  return {
    success: true,
    data: {
      challenge: data.challenge,
      expires_at: data.expires_at,
      challenge_id: data.id,
    },
  };
}

export async function verifyAuthChallenge(
  supabase: SupabaseClient,
  body: {
    wallet_id: string;
    challenge_id: string;
    signature: string;
    public_key_type?: string;
  }
): Promise<ServiceResult> {
  const { wallet_id, challenge_id, signature, public_key_type = 'secp256k1' } = body;

  // Get challenge
  const { data: challengeRecord, error: challengeError } = await supabase
    .from('wallet_auth_challenges')
    .select('id, wallet_id, challenge, expires_at, used')
    .eq('id', challenge_id)
    .single();

  if (challengeError || !challengeRecord) {
    return { success: false, error: 'Challenge not found', code: 'CHALLENGE_NOT_FOUND' };
  }

  if (challengeRecord.wallet_id !== wallet_id) {
    return { success: false, error: 'Challenge does not belong to this wallet', code: 'INVALID_CHALLENGE' };
  }

  if (challengeRecord.used) {
    return { success: false, error: 'Challenge already used', code: 'CHALLENGE_USED' };
  }

  if (new Date(challengeRecord.expires_at) < new Date()) {
    return { success: false, error: 'Challenge expired', code: 'AUTH_EXPIRED' };
  }

  // Get wallet public key
  const { data: wallet } = await supabase
    .from('wallets')
    .select('id, public_key_secp256k1, public_key_ed25519, status')
    .eq('id', wallet_id)
    .single();

  if (!wallet) {
    return { success: false, error: 'Wallet not found', code: 'WALLET_NOT_FOUND' };
  }

  if (wallet.status !== 'active') {
    return { success: false, error: 'Wallet is not active', code: 'WALLET_INACTIVE' };
  }

  // Verify signature based on key type
  let isValid = false;
  if (public_key_type === 'secp256k1' && wallet.public_key_secp256k1) {
    isValid = verifyChallengeSignature(
      challengeRecord.challenge,
      signature,
      wallet.public_key_secp256k1
    );
  }
  // TODO: Add ed25519 verification when needed

  if (!isValid) {
    return { success: false, error: 'Invalid signature', code: 'INVALID_SIGNATURE' };
  }

  // Mark challenge as used
  await supabase
    .from('wallet_auth_challenges')
    .update({ used: true })
    .eq('id', challenge_id);

  // Generate JWT token
  const token = generateWalletToken(wallet_id);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  return {
    success: true,
    data: {
      auth_token: token,
      expires_at: expiresAt.toISOString(),
      wallet_id,
    },
  };
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Extract the last index from a derivation path like m/44'/60'/0'/0/3 → 3 */
function extractDerivationIndex(path: string): number {
  const parts = path.split('/');
  const last = parts[parts.length - 1].replace("'", '');
  const idx = parseInt(last, 10);
  return isNaN(idx) ? 0 : idx;
}
