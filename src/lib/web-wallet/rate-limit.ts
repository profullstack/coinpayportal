/**
 * Web Wallet Rate Limiting & Replay Prevention
 *
 * Distributed rate limiter using Supabase for multi-instance deployments.
 * Falls back to in-memory for development or when Supabase is unavailable.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ──────────────────────────────────────────────
// Supabase Client (lazy init)
// ──────────────────────────────────────────────

let supabase: SupabaseClient | null = null;
let useSupabase = true; // Will be set to false if Supabase fails

function getSupabase(): SupabaseClient | null {
  if (!useSupabase) return null;
  
  if (!supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!url || !key) {
      console.warn('[RateLimit] Supabase not configured, using in-memory fallback');
      useSupabase = false;
      return null;
    }
    
    supabase = createClient(url, key);
  }
  
  return supabase;
}

// ──────────────────────────────────────────────
// Rate Limiter
// ──────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface RateLimitConfig {
  /** Max requests per window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

/** Default rate limit configs per endpoint category */
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Merchant auth endpoints (strict limits to prevent brute-force)
  'merchant_login': { limit: 5, windowSeconds: 300 },         // 5/5min per IP
  'merchant_login_email': { limit: 10, windowSeconds: 3600 }, // 10/hour per email
  'merchant_register': { limit: 3, windowSeconds: 3600 },     // 3/hour per IP
  // Web wallet endpoints
  'wallet_creation': { limit: 10, windowSeconds: 3600 },       // 10/hour per IP
  'escrow_creation': { limit: 5, windowSeconds: 3600 },       // 5/hour per IP
  'auth_challenge': { limit: 30, windowSeconds: 60 },         // 30/min (wallet switches trigger auth)
  'auth_verify': { limit: 30, windowSeconds: 60 },            // 30/min (wallet switches trigger auth)
  'balance_query': { limit: 60, windowSeconds: 60 },          // 60/min
  'tx_history': { limit: 30, windowSeconds: 60 },             // 30/min
  // Sized for the extension's bulk runs, not for one human clicking Send.
  // `payBatch` sends up to MAX_BATCH_SIZE (500) payments as one approval, and
  // each payment costs one prepare-tx plus one broadcast. The runner serializes
  // per account with a settle delay, so it tops out around 15 payments/minute —
  // the old 20/min and 10/min caps stopped a batch dead after ~10 payments, and
  // the runner treats a 429 as transient and burns its retries inside the same
  // window. These are the pre-auth per-IP shield; the real budget is per wallet.
  'prepare_tx': { limit: 60, windowSeconds: 60 },             // 60/min per IP
  'broadcast_tx': { limit: 60, windowSeconds: 60 },           // 60/min per IP
  // Per authenticated wallet, checked after the signature verifies. One full
  // 500-payment batch costs 500 of each; the 2x headroom absorbs the runner's
  // retries without letting a single wallet run batches back to back forever.
  'prepare_tx_wallet': { limit: 1000, windowSeconds: 3600 },   // 1000/hour per wallet
  'broadcast_tx_wallet': { limit: 1000, windowSeconds: 3600 }, // 1000/hour per wallet
  'estimate_fee': { limit: 60, windowSeconds: 60 },           // 60/min
  'settings': { limit: 30, windowSeconds: 60 },               // 30/min
  'sync_history': { limit: 10, windowSeconds: 60 },           // 10/min
  'rates_query': { limit: 60, windowSeconds: 60 },            // 60/min per IP
  // Merchant/payment API surface. These back endpoints that were previously
  // unauthenticated; auth is the primary control and these are the second
  // layer, sized so a credentialed caller cannot use them as an amplifier.
  'check_balance': { limit: 30, windowSeconds: 60 },          // 30/min per payment
  'payment_create': { limit: 60, windowSeconds: 60 },         // 60/min per business
  'widget_create': { limit: 20, windowSeconds: 60 },          // 20/min per business+IP
  'realtime_publish': { limit: 60, windowSeconds: 60 },       // 60/min per business
  'webhook_test': { limit: 10, windowSeconds: 300 },          // 10/5min per business
  'escrow_read': { limit: 30, windowSeconds: 60 },            // 30/min per caller
  'swap_read': { limit: 30, windowSeconds: 60 },              // 30/min per caller
  'lnurl_resolve': { limit: 10, windowSeconds: 60 },          // 10/min per business
  'usage_mutate': { limit: 60, windowSeconds: 60 },           // 60/min per business
  'invoice_mutate': { limit: 30, windowSeconds: 60 },         // 30/min per caller
  'invoice_email_resend': { limit: 10, windowSeconds: 300 },  // 10/5min per business
  'p2p_request': { limit: 30, windowSeconds: 60 },           // 30/min per issuing platform
  'cli_auth_start': { limit: 10, windowSeconds: 300 },       // 10/5min per IP
  // WebAuthn. `login-options` answers differently for a registered and an
  // unregistered account, so without a limit it is a free user-enumeration
  // oracle; the verify endpoints back an authentication decision.
  'webauthn_options': { limit: 20, windowSeconds: 300 },     // 20/5min per IP
  'webauthn_verify': { limit: 20, windowSeconds: 300 },      // 20/5min per IP
  // Address derivation. Its five sibling mutating routes are limited; this one
  // was not, and each call does HD derivation work and writes a row.
  'wallet_derive': { limit: 30, windowSeconds: 60 },         // 30/min per wallet
  // x402 facilitator. Anonymous callers can otherwise bloat the ledger and
  // burn third-party API quota (Stripe) for free.
  'x402_verify': { limit: 60, windowSeconds: 60 },           // 60/min per business
  'x402_settle': { limit: 60, windowSeconds: 60 },           // 60/min per business
  // Each swap quote costs two calls to the ChangeNOW third-party API, so an
  // unlimited anonymous endpoint is a quota-exhaustion lever against us.
  'swap_quote': { limit: 20, windowSeconds: 60 },            // 20/min per IP
  // The trust graph is only meaningful if attestations are expensive to mint.
  'reputation_attest': { limit: 10, windowSeconds: 60 },     // 10/min per caller
  // A boolean "is this address a CoinPay merchant?" oracle. Unauthenticated by
  // design (a sender checks before paying), so the limit is what stops it being
  // used to sweep the merchant base address by address.
  'wallet_lookup': { limit: 30, windowSeconds: 60 },         // 30/min per IP
};

/** In-memory fallback store */
const rateLimitStore = new Map<string, RateLimitEntry>();

/** Cleanup stale entries periodically (fallback only) */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function ensureCleanupRunning() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore) {
      if (now - entry.windowStart > 3600_000) {
        rateLimitStore.delete(key);
      }
    }
  }, 60_000);
  if (cleanupInterval.unref) cleanupInterval.unref();
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // Unix timestamp (seconds)
}

/**
 * Check rate limit using Supabase (distributed)
 */
async function checkRateLimitSupabase(
  storeKey: string,
  config: RateLimitConfig
): Promise<RateLimitResult | null> {
  const sb = getSupabase();
  if (!sb) return null;

  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - config.windowSeconds * 1000);

    // Try to get existing entry
    const { data: existing, error: fetchError } = await sb
      .from('rate_limits')
      .select('count, window_start')
      .eq('key', storeKey)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 = not found, which is fine
      throw fetchError;
    }

    if (!existing || new Date(existing.window_start) < windowStart) {
      // New window - upsert with count 1
      const { error: upsertError } = await sb
        .from('rate_limits')
        .upsert({
          key: storeKey,
          count: 1,
          window_start: now.toISOString(),
          updated_at: now.toISOString(),
        });

      if (upsertError) throw upsertError;

      return {
        allowed: true,
        limit: config.limit,
        remaining: config.limit - 1,
        resetAt: Math.floor(now.getTime() / 1000) + config.windowSeconds,
      };
    }

    // Existing window
    if (existing.count >= config.limit) {
      const resetAt = Math.floor(new Date(existing.window_start).getTime() / 1000) + config.windowSeconds;
      return {
        allowed: false,
        limit: config.limit,
        remaining: 0,
        resetAt,
      };
    }

    // Increment count
    const { error: updateError } = await sb
      .from('rate_limits')
      .update({ 
        count: existing.count + 1,
        updated_at: now.toISOString(),
      })
      .eq('key', storeKey);

    if (updateError) throw updateError;

    return {
      allowed: true,
      limit: config.limit,
      remaining: config.limit - existing.count - 1,
      resetAt: Math.floor(new Date(existing.window_start).getTime() / 1000) + config.windowSeconds,
    };
  } catch (error) {
    console.error('[RateLimit] Supabase error, falling back to in-memory:', error);
    useSupabase = false;
    return null;
  }
}

/**
 * Check rate limit using in-memory store (fallback)
 */
function checkRateLimitMemory(
  storeKey: string,
  config: RateLimitConfig
): RateLimitResult {
  ensureCleanupRunning();

  const now = Date.now();
  const entry = rateLimitStore.get(storeKey);

  if (!entry || now - entry.windowStart >= config.windowSeconds * 1000) {
    rateLimitStore.set(storeKey, { count: 1, windowStart: now });
    return {
      allowed: true,
      limit: config.limit,
      remaining: config.limit - 1,
      resetAt: Math.floor(now / 1000) + config.windowSeconds,
    };
  }

  if (entry.count >= config.limit) {
    const resetAt = Math.floor(entry.windowStart / 1000) + config.windowSeconds;
    return {
      allowed: false,
      limit: config.limit,
      remaining: 0,
      resetAt,
    };
  }

  entry.count++;
  return {
    allowed: true,
    limit: config.limit,
    remaining: config.limit - entry.count,
    resetAt: Math.floor(entry.windowStart / 1000) + config.windowSeconds,
  };
}

/**
 * Check rate limit for a given key and category.
 * Uses Supabase for distributed rate limiting, falls back to in-memory.
 * 
 * @param key - Unique identifier (e.g., IP address, wallet ID)
 * @param category - Rate limit category from RATE_LIMITS
 */
export function checkRateLimit(
  key: string,
  category: string
): RateLimitResult {
  const config = RATE_LIMITS[category];
  if (!config) {
    // An unknown category used to return `allowed: true` in silence, so a typo
    // in a category name disabled the limit entirely with nothing to notice.
    // Still allow — a config mistake must not take payments down — but say so.
    console.error(`[RateLimit] Unknown category '${category}' — no limit applied`);
    return { allowed: true, limit: 0, remaining: 0, resetAt: 0 };
  }

  const storeKey = `${category}:${key}`;

  // Try Supabase first (async, but we need sync response)
  // For now, use in-memory as primary and schedule Supabase sync
  // This is a trade-off: immediate response vs perfect accuracy
  const memResult = checkRateLimitMemory(storeKey, config);

  // Fire-and-forget Supabase sync for distributed tracking
  if (useSupabase) {
    checkRateLimitSupabase(storeKey, config).catch(() => {});
  }

  return memResult;
}

/**
 * Async version that waits for Supabase (use for critical paths)
 */
export async function checkRateLimitAsync(
  key: string,
  category: string
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[category];
  if (!config) {
    // See checkRateLimit: silent on an unknown category until now.
    console.error(`[RateLimit] Unknown category '${category}' — no limit applied`);
    return { allowed: true, limit: 0, remaining: 0, resetAt: 0 };
  }

  const storeKey = `${category}:${key}`;

  // Try Supabase first
  const sbResult = await checkRateLimitSupabase(storeKey, config);
  if (sbResult) return sbResult;

  // Fallback to in-memory
  return checkRateLimitMemory(storeKey, config);
}

/**
 * Reset rate limit store (for testing).
 */
export function resetRateLimits(): void {
  rateLimitStore.clear();
}

// ──────────────────────────────────────────────
// Replay Prevention (Signature Nonces)
// ──────────────────────────────────────────────

/**
 * Distributed replay prevention using Supabase.
 * Falls back to in-memory for development or when Supabase is unavailable.
 */
const seenSignatures = new Map<string, number>();

let sigCleanupInterval: ReturnType<typeof setInterval> | null = null;

const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

function ensureSigCleanupRunning() {
  if (sigCleanupInterval) return;
  sigCleanupInterval = setInterval(() => {
    const cutoff = Date.now() - SIGNATURE_WINDOW_MS;
    for (const [hash, ts] of seenSignatures) {
      if (ts < cutoff) {
        seenSignatures.delete(hash);
      }
    }
  }, 30_000);
  if (sigCleanupInterval.unref) sigCleanupInterval.unref();
}

/**
 * Check and record signature using Supabase (distributed)
 */
async function checkSignatureSupabase(signatureHash: string): Promise<boolean | null> {
  const sb = getSupabase();
  if (!sb) return null;

  try {
    // Try to insert - will fail if exists (primary key constraint)
    const { error } = await sb
      .from('seen_signatures')
      .insert({ hash: signatureHash, seen_at: new Date().toISOString() });

    if (error) {
      // Check if it's a duplicate key error
      if (error.code === '23505') {
        return false; // Replay detected
      }
      throw error;
    }

    return true; // Fresh signature
  } catch (error) {
    console.error('[ReplayPrevention] Supabase error:', error);
    // Signal "shared store unavailable" distinctly from "fresh"/"replay". The
    // caller decides — and when the store IS configured, the answer is to
    // reject, not to quietly downgrade. See checkAndRecordSignatureAsync.
    return null;
  }
}

/** Whether the shared replay store is configured for this deployment. */
export function hasSharedReplayStore(): boolean {
  return getSupabase() !== null;
}

/**
 * Check if a signature has been seen before (replay prevention).
 * Returns true if the signature is fresh (not a replay).
 * Returns false if the signature was already used.
 *
 * @param signatureHash - Hash or unique identifier for the signed request
 */
export function checkAndRecordSignature(signatureHash: string): boolean {
  ensureSigCleanupRunning();

  // Check in-memory first (fast path)
  if (seenSignatures.has(signatureHash)) {
    return false;
  }

  // Record in memory
  seenSignatures.set(signatureHash, Date.now());

  // Fire-and-forget Supabase sync for distributed tracking
  if (useSupabase) {
    checkSignatureSupabase(signatureHash).catch(() => {});
  }

  return true;
}

/**
 * Async version that waits for Supabase (use for critical paths)
 */
export async function checkAndRecordSignatureAsync(signatureHash: string): Promise<boolean> {
  // Try Supabase first
  const sbResult = await checkSignatureSupabase(signatureHash);
  if (sbResult !== null) {
    // Also update in-memory cache
    if (sbResult) {
      seenSignatures.set(signatureHash, Date.now());
    }
    return sbResult;
  }

  // The shared store answered neither "fresh" nor "replay" — it errored.
  //
  // Falling through to the in-memory map here is a FAIL-OPEN. On a
  // multi-instance deployment the in-memory map is per-process, so a signature
  // spent on instance A is unknown to instance B: replay protection quietly
  // evaporates at precisely the moment the shared store is unhealthy, which is
  // also when an attacker is most likely to be probing. Rejecting is the only
  // safe answer when the store exists but cannot be consulted.
  //
  // The in-memory path is kept ONLY for deployments with no shared store
  // configured at all (local development), where per-process is all there is.
  if (hasSharedReplayStore()) {
    console.error(
      '[ReplayPrevention] Shared store unreachable — rejecting the request rather than ' +
        'falling back to per-process memory, which is not replay protection across instances.'
    );
    return false;
  }

  // Fallback to in-memory
  ensureSigCleanupRunning();
  
  if (seenSignatures.has(signatureHash)) {
    return false;
  }

  seenSignatures.set(signatureHash, Date.now());
  return true;
}

/**
 * Reset seen signatures store (for testing).
 */
export function resetSeenSignatures(): void {
  seenSignatures.clear();
}
