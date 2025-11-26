import type { SupabaseClient } from '@supabase/supabase-js';
import { encrypt, deriveKey } from '../crypto/encryption';
import { generateApiKey } from '../auth/apikey';
import { z } from 'zod';

/**
 * Validation schemas
 */
const businessNameSchema = z.string().min(1, 'Business name is required').max(100);
const webhookUrlSchema = z.string().url('Invalid webhook URL').optional();
const descriptionSchema = z.string().max(500).optional();

/**
 * Types
 */
export interface CreateBusinessInput {
  name: string;
  description?: string;
  webhook_url?: string;
  webhook_secret?: string;
  webhook_events?: string[];
}

export interface UpdateBusinessInput {
  name?: string;
  description?: string;
  webhook_url?: string;
  webhook_secret?: string;
  webhook_events?: string[];
  active?: boolean;
}

export interface Business {
  id: string;
  merchant_id: string;
  name: string;
  description?: string;
  webhook_url?: string;
  webhook_secret?: string;
  webhook_events?: string[];
  active: boolean;
  api_key?: string;
  api_key_created_at?: string;
  created_at: string;
  updated_at: string;
}

export interface BusinessResult {
  success: boolean;
  business?: Business;
  error?: string;
}

export interface BusinessListResult {
  success: boolean;
  businesses?: Business[];
  error?: string;
}

/**
 * Get encryption key for business data
 */
function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  return key;
}

/**
 * Create a new business
 */
export async function createBusiness(
  supabase: SupabaseClient,
  merchantId: string,
  input: CreateBusinessInput
): Promise<BusinessResult> {
  try {
    // Validate name
    const nameResult = businessNameSchema.safeParse(input.name);
    if (!nameResult.success) {
      return {
        success: false,
        error: nameResult.error.errors[0].message,
      };
    }

    // Validate webhook URL if provided
    if (input.webhook_url) {
      const urlResult = webhookUrlSchema.safeParse(input.webhook_url);
      if (!urlResult.success) {
        return {
          success: false,
          error: urlResult.error.errors[0].message,
        };
      }
    }

    // Validate description if provided
    if (input.description) {
      const descResult = descriptionSchema.safeParse(input.description);
      if (!descResult.success) {
        return {
          success: false,
          error: descResult.error.errors[0].message,
        };
      }
    }

    // Encrypt webhook secret if provided
    let encryptedSecret: string | undefined;
    if (input.webhook_secret) {
      const encryptionKey = getEncryptionKey();
      const derivedKey = deriveKey(encryptionKey, merchantId);
      encryptedSecret = encrypt(input.webhook_secret, derivedKey);
    }

    // Generate API key for the new business
    const apiKey = generateApiKey();
    const apiKeyCreatedAt = new Date().toISOString();

    // Insert business
    const { data: business, error } = await supabase
      .from('businesses')
      .insert({
        merchant_id: merchantId,
        name: input.name,
        description: input.description,
        webhook_url: input.webhook_url,
        webhook_secret: encryptedSecret,
        webhook_events: input.webhook_events || ['payment.confirmed', 'payment.forwarded'],
        active: true,
        api_key: apiKey,
        api_key_created_at: apiKeyCreatedAt,
      })
      .select()
      .single();

    if (error || !business) {
      return {
        success: false,
        error: error?.message || 'Failed to create business',
      };
    }

    return {
      success: true,
      business: business as Business,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Business creation failed',
    };
  }
}

/**
 * List all businesses for a merchant
 */
export async function listBusinesses(
  supabase: SupabaseClient,
  merchantId: string
): Promise<BusinessListResult> {
  try {
    const { data: businesses, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('merchant_id', merchantId);

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      businesses: (businesses || []) as Business[],
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list businesses',
    };
  }
}

/**
 * Get a single business by ID
 */
export async function getBusiness(
  supabase: SupabaseClient,
  businessId: string,
  merchantId: string
): Promise<BusinessResult> {
  try {
    const { data: business, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', businessId)
      .eq('merchant_id', merchantId)
      .single();

    if (error || !business) {
      return {
        success: false,
        error: error?.message || 'Business not found',
      };
    }

    return {
      success: true,
      business: business as Business,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get business',
    };
  }
}

/**
 * Update a business
 */
export async function updateBusiness(
  supabase: SupabaseClient,
  businessId: string,
  merchantId: string,
  input: UpdateBusinessInput
): Promise<BusinessResult> {
  try {
    // Validate inputs if provided
    if (input.name !== undefined) {
      const nameResult = businessNameSchema.safeParse(input.name);
      if (!nameResult.success) {
        return {
          success: false,
          error: nameResult.error.errors[0].message,
        };
      }
    }

    if (input.webhook_url !== undefined && input.webhook_url !== null) {
      const urlResult = webhookUrlSchema.safeParse(input.webhook_url);
      if (!urlResult.success) {
        return {
          success: false,
          error: urlResult.error.errors[0].message,
        };
      }
    }

    if (input.description !== undefined && input.description !== null) {
      const descResult = descriptionSchema.safeParse(input.description);
      if (!descResult.success) {
        return {
          success: false,
          error: descResult.error.errors[0].message,
        };
      }
    }

    // Prepare update data
    const updateData: any = {};
    
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.webhook_url !== undefined) updateData.webhook_url = input.webhook_url;
    if (input.webhook_events !== undefined) updateData.webhook_events = input.webhook_events;
    if (input.active !== undefined) updateData.active = input.active;

    // Encrypt webhook secret if provided
    if (input.webhook_secret) {
      const encryptionKey = getEncryptionKey();
      const derivedKey = deriveKey(encryptionKey, merchantId);
      updateData.webhook_secret = encrypt(input.webhook_secret, derivedKey);
    }

    // Update business
    const { data: business, error } = await supabase
      .from('businesses')
      .update(updateData)
      .eq('id', businessId)
      .eq('merchant_id', merchantId)
      .select()
      .single();

    if (error || !business) {
      return {
        success: false,
        error: error?.message || 'Failed to update business',
      };
    }

    return {
      success: true,
      business: business as Business,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Business update failed',
    };
  }
}

/**
 * Delete a business
 */
export async function deleteBusiness(
  supabase: SupabaseClient,
  businessId: string,
  merchantId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('businesses')
      .delete()
      .eq('id', businessId)
      .eq('merchant_id', merchantId);

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Business deletion failed',
    };
  }
}