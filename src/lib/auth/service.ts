import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, createHash } from 'crypto';
import { hashPassword, verifyPassword } from '../crypto/encryption';
import { generateToken, verifyToken } from './jwt';
import { getSecret } from '../secrets';
import { z } from 'zod';

/**
 * Validation schemas
 */
const emailSchema = z.string().email('Invalid email format');
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

/**
 * Types
 */
export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  success: boolean;
  merchant?: {
    id: string;
    email: string;
    name?: string;
  };
  token?: string;
  error?: string;
}

/**
 * Get JWT secret from secure secrets store.
 * Falls back to process.env if secrets not initialized (e.g., tests).
 */
function getJwtSecret(): string {
  const secret = getSecret('JWT_SECRET') || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
}

/**
 * Register a new merchant
 */
export async function register(
  supabase: SupabaseClient,
  input: RegisterInput
): Promise<AuthResult> {
  try {
    // Validate email
    const emailResult = emailSchema.safeParse(input.email);
    if (!emailResult.success) {
      return {
        success: false,
        error: emailResult.error.errors[0].message,
      };
    }

    // Validate password
    const passwordResult = passwordSchema.safeParse(input.password);
    if (!passwordResult.success) {
      return {
        success: false,
        error: passwordResult.error.errors[0].message,
      };
    }

    // Check if email already exists
    const { data: existingMerchant } = await supabase
      .from('merchants')
      .select('id')
      .eq('email', input.email.toLowerCase())
      .single();

    if (existingMerchant) {
      return {
        success: false,
        error: 'Email already exists',
      };
    }

    // Hash password
    const passwordHash = await hashPassword(input.password);

    // Insert new merchant
    const { data: merchant, error } = await supabase
      .from('merchants')
      .insert({
        email: input.email.toLowerCase(),
        password_hash: passwordHash,
        name: input.name,
      })
      .select('id, email, name, created_at')
      .single();

    if (error || !merchant) {
      return {
        success: false,
        error: error?.message || 'Failed to create merchant account',
      };
    }

    // Link any platform-registered DIDs (e.g., from ugig.net) to this merchant
    try {
      const { data: platformDids } = await supabase
        .from('merchant_dids')
        .select('id, did')
        .eq('email', input.email.toLowerCase())
        .is('merchant_id', null);

      if (platformDids && platformDids.length > 0) {
        for (const pd of platformDids) {
          await supabase
            .from('merchant_dids')
            .update({ merchant_id: merchant.id })
            .eq('id', pd.id);
          console.log(`[Auth] Linked platform DID ${pd.did} to merchant ${merchant.id}`);
        }
      }
    } catch (linkErr) {
      // Non-fatal — don't block registration
      console.error('[Auth] Failed to link platform DIDs:', linkErr);
    }

    // Generate JWT token
    const token = generateToken(
      {
        userId: merchant.id,
        email: merchant.email,
      },
      getJwtSecret(),
      '7d' // 7 days expiration
    );

    return {
      success: true,
      merchant: {
        id: merchant.id,
        email: merchant.email,
        name: merchant.name,
      },
      token,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Registration failed',
    };
  }
}

/**
 * Login a merchant
 */
export async function login(
  supabase: SupabaseClient,
  input: LoginInput
): Promise<AuthResult> {
  try {
    // Validate email
    const emailResult = emailSchema.safeParse(input.email);
    if (!emailResult.success) {
      return {
        success: false,
        error: emailResult.error.errors[0].message,
      };
    }

    // Validate password is not empty
    if (!input.password || input.password.length === 0) {
      return {
        success: false,
        error: 'Password is required',
      };
    }

    // Get merchant by email
    const { data: merchant, error } = await supabase
      .from('merchants')
      .select('id, email, name, password_hash')
      .eq('email', input.email.toLowerCase())
      .single();

    if (error || !merchant) {
      return {
        success: false,
        error: 'Invalid email or password',
      };
    }

    // Verify password
    const isValidPassword = await verifyPassword(
      input.password,
      merchant.password_hash
    );

    if (!isValidPassword) {
      return {
        success: false,
        error: 'Invalid email or password',
      };
    }

    // Generate JWT token
    const token = generateToken(
      {
        userId: merchant.id,
        email: merchant.email,
      },
      getJwtSecret(),
      '7d' // 7 days expiration
    );

    return {
      success: true,
      merchant: {
        id: merchant.id,
        email: merchant.email,
        name: merchant.name,
      },
      token,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Login failed',
    };
  }
}

/**
 * Verify a session token and return merchant data
 */
export async function verifySession(
  supabase: SupabaseClient,
  token: string
): Promise<AuthResult> {
  try {
    // Verify JWT token
    const decoded = verifyToken(token, getJwtSecret());

    if (!decoded || !decoded.userId) {
      return {
        success: false,
        error: 'Invalid token',
      };
    }

    // Get merchant from database
    const { data: merchant, error } = await supabase
      .from('merchants')
      .select('id, email, name')
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
      merchant: {
        id: merchant.id,
        email: merchant.email,
        name: merchant.name,
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
      error: error instanceof Error ? error.message : 'Session verification failed',
    };
  }
}

/**
 * Refresh an access token
 */
export async function refreshToken(
  supabase: SupabaseClient,
  oldToken: string
): Promise<AuthResult> {
  try {
    // Verify the old token (even if expired, we can still decode it)
    const decoded = verifyToken(oldToken, getJwtSecret());

    if (!decoded || !decoded.userId) {
      return {
        success: false,
        error: 'Invalid token',
      };
    }

    // Verify merchant still exists
    const { data: merchant, error } = await supabase
      .from('merchants')
      .select('id, email, name')
      .eq('id', decoded.userId)
      .single();

    if (error || !merchant) {
      return {
        success: false,
        error: 'Merchant not found',
      };
    }

    // Generate new token
    const newToken = generateToken(
      {
        userId: merchant.id,
        email: merchant.email,
      },
      getJwtSecret(),
      '7d'
    );

    return {
      success: true,
      merchant: {
        id: merchant.id,
        email: merchant.email,
        name: merchant.name,
      },
      token: newToken,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Token refresh failed',
    };
  }
}

/**
 * Hash a reset token using SHA-256
 */
function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface ResetResult {
  success: boolean;
  token?: string;
  error?: string;
}

/**
 * Request a password reset. Returns a raw token to include in the email link.
 * If email not found, returns success with no token (don't leak email existence).
 */
export async function requestPasswordReset(
  supabase: SupabaseClient,
  email: string
): Promise<ResetResult> {
  try {
    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      return { success: true }; // Don't leak validation errors
    }

    const { data: merchant } = await supabase
      .from('merchants')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (!merchant) {
      return { success: true }; // Don't leak email existence
    }

    // Generate random token
    const rawToken = randomBytes(32).toString('hex');
    const hashedToken = hashResetToken(rawToken);
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    // Store hashed token
    const { error } = await supabase
      .from('merchants')
      .update({
        reset_token: hashedToken,
        reset_token_expires: expires,
      })
      .eq('id', merchant.id);

    if (error) {
      return { success: false, error: 'Failed to generate reset token' };
    }

    return { success: true, token: rawToken };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Password reset request failed',
    };
  }
}

/**
 * Reset password using a token
 */
export async function resetPassword(
  supabase: SupabaseClient,
  token: string,
  newPassword: string
): Promise<ResetResult> {
  try {
    // Validate new password
    const passwordResult = passwordSchema.safeParse(newPassword);
    if (!passwordResult.success) {
      return {
        success: false,
        error: passwordResult.error.errors[0].message,
      };
    }

    // Hash the incoming token to compare
    const hashedToken = hashResetToken(token);

    // Find merchant with valid (non-expired) reset token
    const { data: merchants, error: fetchError } = await supabase
      .from('merchants')
      .select('id, reset_token, reset_token_expires')
      .eq('reset_token', hashedToken)
      .gt('reset_token_expires', new Date().toISOString());

    if (fetchError || !merchants || merchants.length === 0) {
      return {
        success: false,
        error: 'Invalid or expired reset token',
      };
    }

    const merchant = merchants[0];

    // Hash new password and update
    const passwordHash = await hashPassword(newPassword);

    const { error: updateError } = await supabase
      .from('merchants')
      .update({
        password_hash: passwordHash,
        reset_token: null,
        reset_token_expires: null,
      })
      .eq('id', merchant.id);

    if (updateError) {
      return { success: false, error: 'Failed to update password' };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Password reset failed',
    };
  }
}