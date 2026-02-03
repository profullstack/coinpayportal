/**
 * Web Wallet Rate Limiting & Replay Prevention
 *
 * In-memory rate limiter and signature replay prevention.
 * For single-server deployments. For multi-server, replace
 * with Redis-backed storage.
 */

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
  'wallet_creation': { limit: 5, windowSeconds: 3600 },       // 5/hour
  'auth_challenge': { limit: 10, windowSeconds: 60 },         // 10/min
  'auth_verify': { limit: 10, windowSeconds: 60 },            // 10/min
  'balance_query': { limit: 60, windowSeconds: 60 },          // 60/min
  'tx_history': { limit: 30, windowSeconds: 60 },             // 30/min
  'prepare_tx': { limit: 20, windowSeconds: 60 },             // 20/min
  'broadcast_tx': { limit: 10, windowSeconds: 60 },           // 10/min
  'estimate_fee': { limit: 60, windowSeconds: 60 },           // 60/min
  'settings': { limit: 30, windowSeconds: 60 },               // 30/min
  'sync_history': { limit: 10, windowSeconds: 60 },           // 10/min
};

/** In-memory rate limit store */
const rateLimitStore = new Map<string, RateLimitEntry>();

/** Cleanup stale entries periodically */
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
  }, 60_000); // Cleanup every minute
  // Don't prevent process exit
  if (cleanupInterval.unref) cleanupInterval.unref();
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // Unix timestamp (seconds)
}

/**
 * Check rate limit for a given key and category.
 * @param key - Unique identifier (e.g., IP address, wallet ID)
 * @param category - Rate limit category from RATE_LIMITS
 */
export function checkRateLimit(
  key: string,
  category: string
): RateLimitResult {
  const config = RATE_LIMITS[category];
  if (!config) {
    // No rate limit configured for this category
    return { allowed: true, limit: 0, remaining: 0, resetAt: 0 };
  }

  ensureCleanupRunning();

  const storeKey = `${category}:${key}`;
  const now = Date.now();
  const entry = rateLimitStore.get(storeKey);

  if (!entry || now - entry.windowStart >= config.windowSeconds * 1000) {
    // New window
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
 * Reset rate limit store (for testing).
 */
export function resetRateLimits(): void {
  rateLimitStore.clear();
}

// ──────────────────────────────────────────────
// Replay Prevention (Signature Nonces)
// ──────────────────────────────────────────────

/**
 * In-memory store of recently seen signature hashes.
 * Prevents the same signed request from being replayed.
 * Entries expire after the timestamp window (5 minutes).
 */
const seenSignatures = new Map<string, number>(); // hash -> timestamp

/** Cleanup old signatures periodically */
let sigCleanupInterval: ReturnType<typeof setInterval> | null = null;

const SIGNATURE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function ensureSigCleanupRunning() {
  if (sigCleanupInterval) return;
  sigCleanupInterval = setInterval(() => {
    const cutoff = Date.now() - SIGNATURE_WINDOW_MS;
    for (const [hash, ts] of seenSignatures) {
      if (ts < cutoff) {
        seenSignatures.delete(hash);
      }
    }
  }, 30_000); // Cleanup every 30 seconds
  if (sigCleanupInterval.unref) sigCleanupInterval.unref();
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

  if (seenSignatures.has(signatureHash)) {
    return false; // Replay detected
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
