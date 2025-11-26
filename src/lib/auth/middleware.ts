import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyToken } from './jwt';
import { isApiKey, getBusinessByApiKey } from './apikey';

/**
 * Authentication context types
 */
export interface MerchantAuthContext {
  type: 'merchant';
  merchantId: string;
  email: string;
}

export interface BusinessAuthContext {
  type: 'business';
  businessId: string;
  merchantId: string;
  businessName: string;
}

export type AuthContext = MerchantAuthContext | BusinessAuthContext;

export interface AuthResult {
  success: boolean;
  context?: AuthContext;
  error?: string;
}

/**
 * Extract bearer token from Authorization header
 * 
 * @param {string | null} authHeader - The Authorization header value
 * @returns {string | null} The extracted token or null
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }

  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.substring(7).trim();
}

/**
 * Authenticate request using either JWT token or API key
 * Automatically detects the token type and validates accordingly
 * 
 * @param {SupabaseClient} supabase - Supabase client instance
 * @param {string | null} authHeader - The Authorization header value
 * @returns {Promise<AuthResult>} Authentication result with context
 */
export async function authenticateRequest(
  supabase: SupabaseClient,
  authHeader: string | null
): Promise<AuthResult> {
  try {
    // Extract token from header
    const token = extractBearerToken(authHeader);
    
    if (!token) {
      return {
        success: false,
        error: 'Missing authorization header',
      };
    }

    // Determine token type and authenticate accordingly
    if (isApiKey(token)) {
      return await authenticateWithApiKey(supabase, token);
    } else {
      return await authenticateWithJWT(supabase, token);
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Authentication failed',
    };
  }
}

/**
 * Authenticate using JWT token (for merchant dashboard access)
 * 
 * @param {SupabaseClient} supabase - Supabase client instance
 * @param {string} token - JWT token
 * @returns {Promise<AuthResult>} Merchant authentication context
 */
async function authenticateWithJWT(
  supabase: SupabaseClient,
  token: string
): Promise<AuthResult> {
  try {
    // Get JWT secret
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return {
        success: false,
        error: 'Server configuration error',
      };
    }

    // Verify JWT token
    const decoded = verifyToken(token, jwtSecret);
    
    if (!decoded || !decoded.userId) {
      return {
        success: false,
        error: 'Invalid token',
      };
    }

    // Get merchant from database
    const { data: merchant, error } = await supabase
      .from('merchants')
      .select('id, email')
      .eq('id', decoded.userId)
      .single();

    if (error || !merchant) {
      return {
        success: false,
        error: 'Merchant not found',
      };
    }

    return {
      success: true,
      context: {
        type: 'merchant',
        merchantId: merchant.id,
        email: merchant.email,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('expired')) {
      return {
        success: false,
        error: 'Token has expired',
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'JWT authentication failed',
    };
  }
}

/**
 * Authenticate using API key (for API access)
 * 
 * @param {SupabaseClient} supabase - Supabase client instance
 * @param {string} apiKey - API key
 * @returns {Promise<AuthResult>} Business authentication context
 */
async function authenticateWithApiKey(
  supabase: SupabaseClient,
  apiKey: string
): Promise<AuthResult> {
  try {
    // Validate and get business by API key
    const result = await getBusinessByApiKey(supabase, apiKey);

    if (!result.success || !result.business) {
      return {
        success: false,
        error: result.error || 'Invalid API key',
      };
    }

    return {
      success: true,
      context: {
        type: 'business',
        businessId: result.business.id,
        merchantId: result.business.merchant_id,
        businessName: result.business.name,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'API key authentication failed',
    };
  }
}

/**
 * Check if auth context is for a merchant
 * Type guard function
 * 
 * @param {AuthContext} context - Authentication context
 * @returns {boolean} True if context is for a merchant
 */
export function isMerchantAuth(context: AuthContext): context is MerchantAuthContext {
  return context.type === 'merchant';
}

/**
 * Check if auth context is for a business
 * Type guard function
 * 
 * @param {AuthContext} context - Authentication context
 * @returns {boolean} True if context is for a business
 */
export function isBusinessAuth(context: AuthContext): context is BusinessAuthContext {
  return context.type === 'business';
}