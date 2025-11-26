import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, MerchantSettings } from '../supabase/types';

type SupabaseClientType = SupabaseClient<Database>;

export interface SettingsResult {
  success: boolean;
  settings?: Partial<MerchantSettings>;
  error?: string;
}

export interface UpdateSettingsInput {
  notifications_enabled?: boolean;
  email_notifications?: boolean;
  web_notifications?: boolean;
}

/**
 * Get merchant notification settings
 * Returns default settings if none exist
 */
export async function getSettings(
  supabase: SupabaseClientType,
  merchantId: string
): Promise<SettingsResult> {
  try {
    // Validate input
    if (!merchantId) {
      return {
        success: false,
        error: 'Merchant ID is required',
      };
    }

    // Query settings
    const { data, error } = await supabase
      .from('merchant_settings')
      .select('*')
      .eq('merchant_id', merchantId)
      .single();

    // Handle not found - return defaults
    if (error?.code === 'PGRST116') {
      return {
        success: true,
        settings: {
          notifications_enabled: true,
          email_notifications: true,
          web_notifications: false,
        },
      };
    }

    // Handle other errors
    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      settings: data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get settings',
    };
  }
}

/**
 * Update merchant notification settings
 * Uses upsert to create or update settings
 */
export async function updateSettings(
  supabase: SupabaseClientType,
  merchantId: string,
  input: UpdateSettingsInput
): Promise<SettingsResult> {
  try {
    // Validate input
    if (!merchantId) {
      return {
        success: false,
        error: 'Merchant ID is required',
      };
    }

    // Check that at least one field is provided
    const hasUpdates = Object.keys(input).length > 0;
    if (!hasUpdates) {
      return {
        success: false,
        error: 'At least one setting must be provided',
      };
    }

    // Build update data
    const updateData: any = {
      merchant_id: merchantId,
      ...input,
    };

    // Upsert settings (insert or update)
    const { data, error } = await supabase
      .from('merchant_settings')
      .upsert(updateData)
      .eq('merchant_id', merchantId)
      .select()
      .single();

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      settings: data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update settings',
    };
  }
}