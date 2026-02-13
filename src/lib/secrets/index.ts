/**
 * Secure Secrets Management
 * 
 * Loads sensitive values from environment variables at startup,
 * then clears them from process.env to prevent exposure via:
 * - /proc/PID/environ inspection
 * - Debug endpoints dumping process.env
 * - Error handlers logging environment
 * - Child process inheritance
 * 
 * Usage:
 *   import { initSecrets, getSecret } from '@/lib/secrets';
 *   
 *   // Call once at app startup
 *   initSecrets();
 *   
 *   // Later, when needed
 *   const mnemonic = getSecret('COINPAY_MNEMONIC');
 */

interface SecretEntry {
  value: string;
  accessCount: number;
  firstAccessAt: number | null;
}

// Private store - not exported, only accessible via getSecret()
const secrets = new Map<string, SecretEntry>();

// Secrets to load and clear from env
const SECRET_KEYS = [
  'COINPAY_MNEMONIC',
  'JWT_SECRET',
  'WEBHOOK_SECRET',
  'ENCRYPTION_KEY',
  'INTERNAL_API_KEY',
  'TATUM_API_KEY',
  'RESEND_API_KEY',
  'MAILGUN_API_KEY',
] as const;

type SecretKey = typeof SECRET_KEYS[number];

let initialized = false;

/**
 * Initialize secrets from environment variables.
 * Call once at app startup before any routes are handled.
 * 
 * This reads configured secrets from process.env, stores them
 * in memory, then deletes them from process.env.
 */
export function initSecrets(): void {
  if (initialized) {
    console.warn('[Secrets] Already initialized, skipping');
    return;
  }

  let loaded = 0;
  let missing = 0;

  for (const key of SECRET_KEYS) {
    const value = process.env[key];
    
    if (value) {
      secrets.set(key, {
        value,
        accessCount: 0,
        firstAccessAt: null,
      });
      
      // Clear from process.env
      delete process.env[key];
      loaded++;
    } else {
      missing++;
    }
  }

  initialized = true;
  console.log(`[Secrets] Initialized: ${loaded} loaded, ${missing} not set, cleared from process.env`);
}

/**
 * Get a secret value.
 * 
 * @param key - The secret key (must be in SECRET_KEYS)
 * @returns The secret value, or undefined if not set
 */
export function getSecret(key: SecretKey): string | undefined {
  if (!initialized) {
    // Fall back to process.env if not initialized (e.g., during tests)
    return process.env[key];
  }

  const entry = secrets.get(key);
  if (!entry) {
    return undefined;
  }

  // Track access for audit
  entry.accessCount++;
  if (!entry.firstAccessAt) {
    entry.firstAccessAt = Date.now();
  }

  return entry.value;
}

/**
 * Check if a secret is configured (without revealing its value).
 */
export function hasSecret(key: SecretKey): boolean {
  if (!initialized) {
    return !!process.env[key];
  }
  return secrets.has(key);
}

/**
 * Get secret access stats (for monitoring/debugging).
 * Does NOT reveal secret values.
 */
export function getSecretStats(): Record<string, { accessCount: number; firstAccessAt: number | null }> {
  const stats: Record<string, { accessCount: number; firstAccessAt: number | null }> = {};
  
  for (const [key, entry] of secrets) {
    stats[key] = {
      accessCount: entry.accessCount,
      firstAccessAt: entry.firstAccessAt,
    };
  }
  
  return stats;
}

/**
 * Clear all secrets from memory (call on graceful shutdown if paranoid).
 */
export function clearSecrets(): void {
  for (const [key, entry] of secrets) {
    // Overwrite before clearing
    (entry as { value: string }).value = 'x'.repeat(entry.value.length);
  }
  secrets.clear();
  initialized = false;
  console.log('[Secrets] Cleared from memory');
}

// ──────────────────────────────────────────────
// Convenience helpers for common secrets
// These fall back to process.env for test compatibility
// ──────────────────────────────────────────────

/**
 * Get JWT secret. Throws if not configured.
 */
export function getJwtSecret(): string {
  const secret = getSecret('JWT_SECRET') || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
}

/**
 * Get webhook secret. Returns undefined if not set (some endpoints are optional).
 */
export function getWebhookSecret(): string | undefined {
  return getSecret('WEBHOOK_SECRET') || process.env.WEBHOOK_SECRET;
}

/**
 * Get encryption key. Throws if not configured.
 */
export function getEncryptionKey(): string {
  const key = getSecret('ENCRYPTION_KEY') || process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  return key;
}

/**
 * Get wallet mnemonic. Returns undefined if not set.
 */
export function getMnemonic(): string | undefined {
  return getSecret('COINPAY_MNEMONIC') || process.env.COINPAY_MNEMONIC;
}
