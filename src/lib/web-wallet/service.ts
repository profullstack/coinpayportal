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
import { generateChallenge, verifyChallengeSignature, verifyEd25519ChallengeSignature, generateWalletToken } from './auth';

/** Truncate an address for safe logging: first 8 + last 4 chars */
function truncAddr(addr: string): string {
  if (!addr || addr.length <= 12) return addr || '';
  return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
}

// ──────────────────────────────────────────────
// Validation schemas
// ──────────────────────────────────────────────

const addressInputSchema = z.object({
  chain: z.string().refine((v) => isValidChain(v), { message: 'Invalid chain' }),
  address: z.string().min(1, 'Address is required'),
  derivation_path: z.string().min(1, 'Derivation path is required'),
});

/**
 * Ceiling on addresses accepted in one registration call.
 *
 * V-04: `initial_addresses` was unbounded. `wallet_addresses` is globally
 * unique on `(address, chain)`, so every accepted row permanently denies that
 * address to the wallet that actually owns it — one request could claim
 * thousands. A real wallet registers one address per supported chain.
 */
const MAX_INITIAL_ADDRESSES = VALID_CHAINS.length * 4;

const createWalletSchema = z.object({
  public_key_secp256k1: z.string().optional(),
  public_key_ed25519: z.string().optional(),
  initial_addresses: z
    .array(addressInputSchema)
    .max(MAX_INITIAL_ADDRESSES, `At most ${MAX_INITIAL_ADDRESSES} addresses may be registered at once`)
    .optional()
    .default([]),
  // V-04: creation took a self-declared public key and a list of on-chain
  // addresses from an unauthenticated caller and wrote both, asking for no
  // proof that any of it was theirs. Its sibling /import has always required a
  // signature. Required here now too.
  proof_of_ownership: z.object({
    message: z.string().min(1),
    signature: z.string().min(1).optional(),
    signature_ed25519: z.string().min(1).optional(),
  }),
}).refine(
  (data) => data.public_key_secp256k1 || data.public_key_ed25519,
  { message: 'At least one public key must be provided' }
);

const importWalletSchema = z.object({
  public_key_secp256k1: z.string().optional(),
  public_key_ed25519: z.string().optional(),
  addresses: z
    .array(addressInputSchema)
    .max(MAX_INITIAL_ADDRESSES, `At most ${MAX_INITIAL_ADDRESSES} addresses may be registered at once`)
    .optional()
    .default([]),
  proof_of_ownership: z.object({
    message: z.string().min(1),
    // The secp256k1 signature. Optional at the schema level because an
    // ed25519-only wallet has none to give; `verifyKeyOwnership` requires
    // whichever signature matches the key actually presented (NEW-09).
    signature: z.string().min(1).optional(),
    signature_ed25519: z.string().min(1).optional(),
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

/**
 * Verify that the caller holds the private key behind every public key they
 * present, and return an error result if not.
 *
 * Shared by create (V-04) and import (NEW-09) so the two cannot drift apart
 * again — the whole class of bug here was one sibling checking what the other
 * did not. Every key presented must be proved:
 *
 *   - secp256k1 key present → `signature` must verify against it.
 *   - no secp256k1 key → the ed25519 key is the only identity claimed, and
 *     `signature_ed25519` must verify against it.
 *
 * Real clients send both keys and a secp256k1 signature, which is why the
 * ed25519 branch is a fallback rather than an additional requirement:
 * demanding both signatures would break every client in the field to close a
 * gap that only exists when secp256k1 is absent.
 */
function verifyKeyOwnership(input: {
  public_key_secp256k1?: string;
  public_key_ed25519?: string;
  proof_of_ownership: {
    message: string;
    signature?: string;
    signature_ed25519?: string;
  };
}): ServiceResult | null {
  const { public_key_secp256k1, public_key_ed25519, proof_of_ownership } = input;

  if (public_key_secp256k1) {
    // `signature` is schema-optional only so an ed25519-only wallet can omit
    // it. Absent here it is a missing proof, which is a rejection, not a skip.
    const valid =
      !!proof_of_ownership.signature &&
      verifyChallengeSignature(
        proof_of_ownership.message,
        proof_of_ownership.signature,
        public_key_secp256k1
      );
    if (!valid) {
      console.error('[WebWallet] Rejected: invalid secp256k1 proof of ownership');
      return {
        success: false,
        error: 'Invalid proof of ownership signature',
        code: 'INVALID_SIGNATURE',
      };
    }
    return null;
  }

  const valid =
    !!public_key_ed25519 &&
    verifyEd25519ChallengeSignature(
      proof_of_ownership.message,
      proof_of_ownership.signature_ed25519 ?? '',
      public_key_ed25519
    );
  if (!valid) {
    console.error('[WebWallet] Rejected: invalid ed25519 proof of ownership');
    return {
      success: false,
      error: 'Invalid proof of ownership signature',
      code: 'INVALID_SIGNATURE',
    };
  }
  return null;
}

// ──────────────────────────────────────────────
// Wallet CRUD
// ──────────────────────────────────────────────

export async function createWallet(
  supabase: SupabaseClient,
  body: unknown
): Promise<ServiceResult> {
  // Prevent wallet creation in test environments
  if ((process.env.NODE_ENV === 'test' || process.env.VITEST) && process.env.BLOCK_WALLET_CREATION_IN_TESTS === '1') {
    return { success: false, error: 'Wallet creation blocked in test environment', code: 'TEST_ENV' };
  }

  const parsed = createWalletSchema.safeParse(body);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message, code: 'VALIDATION_ERROR' };
  }

  const { public_key_secp256k1, public_key_ed25519, initial_addresses, proof_of_ownership } =
    parsed.data;

  console.log(`[WebWallet] Creating wallet with ${initial_addresses.length} initial addresses`);

  // Validate public keys
  if (public_key_secp256k1 && !validateSecp256k1PublicKey(public_key_secp256k1)) {
    console.error('[WebWallet] Create failed: invalid secp256k1 public key');
    return { success: false, error: 'Invalid secp256k1 public key', code: 'INVALID_KEY' };
  }
  if (public_key_ed25519 && !validateEd25519PublicKey(public_key_ed25519)) {
    console.error('[WebWallet] Create failed: invalid ed25519 public key');
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

  // V-04: creation asked for no proof of anything. An unauthenticated caller
  // could declare a public key that was not theirs and, more damagingly, a list
  // of on-chain addresses that were not theirs — and `wallet_addresses` is
  // globally unique on `(address, chain)`, so whoever registers an address
  // first holds it and the rightful owner can never register it at all.
  //
  // The identical check has guarded /import since it was written; only this
  // sibling was missing it (§2.3). Placed after the format checks so a
  // malformed key still gets a useful error, and before the first write so
  // nothing is persisted on an unproved claim.
  const proofError = verifyKeyOwnership({
    public_key_secp256k1,
    public_key_ed25519,
    proof_of_ownership,
  });
  if (proofError) return proofError;

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
    console.error('[WebWallet] Create failed: DB insert error', walletError?.message);
    return { success: false, error: walletError?.message || 'Failed to create wallet', code: 'INTERNAL_ERROR' };
  }

  console.log(`[WebWallet] Wallet created: ${wallet.id}`);

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

  console.log(`[WebWallet] Wallet ${wallet.id} created with ${addressResults.length} addresses`);

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

  console.log(`[WebWallet] Importing wallet with ${addresses.length} addresses`);

  // Validate public keys
  if (public_key_secp256k1 && !validateSecp256k1PublicKey(public_key_secp256k1)) {
    console.error('[WebWallet] Import failed: invalid secp256k1 public key');
    return { success: false, error: 'Invalid secp256k1 public key', code: 'INVALID_KEY' };
  }
  if (public_key_ed25519 && !validateEd25519PublicKey(public_key_ed25519)) {
    console.error('[WebWallet] Import failed: invalid ed25519 public key');
    return { success: false, error: 'Invalid ed25519 public key', code: 'INVALID_KEY' };
  }

  // Verify proof of ownership.
  //
  // NEW-09: this was `if (public_key_secp256k1) { ...verify... }` and nothing
  // else. The schema requires *at least one* of the two keys, so an import
  // carrying only `public_key_ed25519` never reached a verification call — the
  // `proof_of_ownership` object was still required, but no part of it was ever
  // read, and any string at all was accepted. Registering a wallet under a key
  // you do not hold was a matter of omitting one field.
  const proofError = verifyKeyOwnership({
    public_key_secp256k1,
    public_key_ed25519,
    proof_of_ownership,
  });
  if (proofError) return proofError;

  // Check if wallet already exists with this key
  if (public_key_secp256k1) {
    const { data: existing } = await supabase
      .from('wallets')
      .select('id')
      .eq('public_key_secp256k1', public_key_secp256k1)
      .single();
    if (existing) {
      console.log(`[WebWallet] Import: wallet ${existing.id} already exists, registering new addresses`);
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

  console.log(`[WebWallet] Wallet imported: ${wallet.id} with ${addressCount} addresses`);

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

  console.log(`[Derive] Registering ${chain} address index=${derivation_index} for wallet ${walletId}`);

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
    console.error(`[Derive] Failed to insert ${chain} address for wallet ${walletId}:`, addrError?.message);
    return { success: false, error: addrError?.message || 'Failed to derive address', code: 'INTERNAL_ERROR' };
  }

  console.log(`[Derive] Registered ${chain} address ${truncAddr(addrData.address)} (index=${addrData.derivation_index}) for wallet ${walletId}`);

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
  console.log(`[Derive] Listing addresses for wallet ${walletId}${options.chain ? ` chain=${options.chain}` : ''}`);

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
  console.log(`[Derive] Deactivating address ${addressId} for wallet ${walletId}`);

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
    console.error(`[Auth] Challenge failed: wallet ${walletId} not found`);
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
    console.error(`[Auth] Failed to create challenge for wallet ${walletId}:`, error?.message);
    return { success: false, error: error?.message || 'Failed to create challenge', code: 'INTERNAL_ERROR' };
  }

  console.log(`[Auth] Challenge created for wallet ${walletId}, expires ${data.expires_at}`);

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

  console.log(`[Auth] Verifying challenge ${challenge_id} for wallet ${wallet_id} (key_type=${public_key_type})`);

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
    console.error(`[Auth] Verify failed: invalid signature for wallet ${wallet_id}`);
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

  console.log(`[Auth] Challenge verified, JWT issued for wallet ${wallet_id}`);

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
