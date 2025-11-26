import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

/**
 * API Key Configuration
 */
const API_KEY_PREFIX = 'cp_live_';
const API_KEY_LENGTH = 32; // 32 random characters after prefix
const TOTAL_KEY_LENGTH = API_KEY_PREFIX.length + API_KEY_LENGTH;

/**
 * Types
 */
export interface ApiKeyValidation {
  valid: boolean;
  error?: string;
}

export interface BusinessFromApiKey {
  id: string;
  merchant_id: string;
  name: string;
  active: boolean;
}

export interface ApiKeyResult {
  success: boolean;
  apiKey?: string;
  business?: BusinessFromApiKey;
  error?: string;
}

/**
 * Generate a secure API key with the format: cp_live_xxxxx...
 * Uses cryptographically secure random bytes
 * 
 * @returns {string} A new API key with prefix and 32 random hex characters
 */
export function generateApiKey(): string {
  // Generate 16 random bytes (32 hex characters)
  const randomHex = randomBytes(16).toString('hex');
  return `${API_KEY_PREFIX}${randomHex}`;
}

/**
 * Validate API key format
 * Checks if the key has the correct prefix and length
 * 
 * @param {string} apiKey - The API key to validate
 * @returns {ApiKeyValidation} Validation result with error message if invalid
 */
export function validateApiKeyFormat(apiKey: string): ApiKeyValidation {
  if (!apiKey || typeof apiKey !== 'string') {
    return {
      valid: false,
      error: 'API key is required',
    };
  }

  if (!apiKey.startsWith(API_KEY_PREFIX)) {
    return {
      valid: false,
      error: `API key must start with ${API_KEY_PREFIX}`,
    };
  }

  if (apiKey.length !== TOTAL_KEY_LENGTH) {
    return {
      valid: false,
      error: `API key must be ${TOTAL_KEY_LENGTH} characters long`,
    };
  }

  // Validate that the part after prefix is hexadecimal (case-insensitive)
  const keyPart = apiKey.substring(API_KEY_PREFIX.length);
  if (!/^[a-fA-F0-9]{32}$/.test(keyPart)) {
    return {
      valid: false,
      error: 'API key contains invalid characters',
    };
  }

  return { valid: true };
}

/**
 * Get business by API key
 * Validates the key format and retrieves the associated business
 * 
 * @param {SupabaseClient} supabase - Supabase client instance
 * @param {string} apiKey - The API key to look up
 * @returns {Promise<ApiKeyResult>} Business data if found, error otherwise
 */
export async function getBusinessByApiKey(
  supabase: SupabaseClient,
  apiKey: string
): Promise<ApiKeyResult> {
  try {
    // Validate format first
    const validation = validateApiKeyFormat(apiKey);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    // Query database for business with this API key
    const { data: business, error } = await supabase
      .from('businesses')
      .select('id, merchant_id, name, active')
      .eq('api_key', apiKey)
      .single();

    if (error || !business) {
      return {
        success: false,
        error: 'Invalid API key',
      };
    }

    // Check if business is active
    if (!business.active) {
      return {
        success: false,
        error: 'Business is inactive',
      };
    }

    return {
      success: true,
      business: business as BusinessFromApiKey,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to validate API key',
    };
  }
}

/**
 * Regenerate API key for a business
 * Creates a new key and updates the database
 * 
 * @param {SupabaseClient} supabase - Supabase client instance
 * @param {string} businessId - The business ID to regenerate key for
 * @param {string} merchantId - The merchant ID (for authorization)
 * @returns {Promise<ApiKeyResult>} New API key if successful
 */
export async function regenerateApiKey(
  supabase: SupabaseClient,
  businessId: string,
  merchantId: string
): Promise<ApiKeyResult> {
  try {
    // Generate new API key
    const newApiKey = generateApiKey();

    // Update business with new API key
    const { data: business, error } = await supabase
      .from('businesses')
      .update({
        api_key: newApiKey,
        api_key_created_at: new Date().toISOString(),
      })
      .eq('id', businessId)
      .eq('merchant_id', merchantId)
      .select('id, merchant_id, name, active')
      .single();

    if (error || !business) {
      return {
        success: false,
        error: error?.message || 'Failed to regenerate API key',
      };
    }

    return {
      success: true,
      apiKey: newApiKey,
      business: business as BusinessFromApiKey,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to regenerate API key',
    };
  }
}

/**
 * Check if a token is an API key (vs JWT)
 * Simply checks if it starts with the API key prefix
 * 
 * @param {string} token - The token to check
 * @returns {boolean} True if token is an API key
 */
export function isApiKey(token: string): boolean {
  return token?.startsWith(API_KEY_PREFIX) ?? false;
}