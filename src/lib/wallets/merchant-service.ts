import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { SUPPORTED_CRYPTOCURRENCIES, type Cryptocurrency } from './service';

/**
 * Validation schemas
 */
const cryptocurrencySchema = z.enum(SUPPORTED_CRYPTOCURRENCIES);
const walletAddressSchema = z.string().min(26, 'Invalid wallet address').max(100);
const labelSchema = z.string().max(100).optional();

/**
 * Types
 */
export interface MerchantWallet {
  id: string;
  merchant_id: string;
  cryptocurrency: Cryptocurrency;
  wallet_address: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateMerchantWalletInput {
  cryptocurrency: Cryptocurrency;
  wallet_address: string;
  label?: string;
  is_active?: boolean;
}

export interface UpdateMerchantWalletInput {
  wallet_address?: string;
  label?: string;
  is_active?: boolean;
}

export interface MerchantWalletResult {
  success: boolean;
  wallet?: MerchantWallet;
  error?: string;
}

export interface MerchantWalletListResult {
  success: boolean;
  wallets?: MerchantWallet[];
  error?: string;
}

export interface ImportWalletsResult {
  success: boolean;
  imported?: number;
  skipped?: number;
  error?: string;
}

/**
 * Create a global wallet for a merchant
 */
export async function createMerchantWallet(
  supabase: SupabaseClient,
  merchantId: string,
  input: CreateMerchantWalletInput
): Promise<MerchantWalletResult> {
  try {
    // Validate cryptocurrency
    const cryptoResult = cryptocurrencySchema.safeParse(input.cryptocurrency);
    if (!cryptoResult.success) {
      return {
        success: false,
        error: `Invalid cryptocurrency. Must be one of: ${SUPPORTED_CRYPTOCURRENCIES.join(', ')}`,
      };
    }

    // Validate wallet address
    const addressResult = walletAddressSchema.safeParse(input.wallet_address);
    if (!addressResult.success) {
      return {
        success: false,
        error: addressResult.error.errors[0].message,
      };
    }

    // Validate label if provided
    if (input.label) {
      const labelResult = labelSchema.safeParse(input.label);
      if (!labelResult.success) {
        return {
          success: false,
          error: 'Label must be 100 characters or less',
        };
      }
    }

    // Check if wallet already exists for this cryptocurrency
    const { data: existing } = await supabase
      .from('merchant_wallets')
      .select('id')
      .eq('merchant_id', merchantId)
      .eq('cryptocurrency', input.cryptocurrency)
      .single();

    if (existing) {
      return {
        success: false,
        error: `Wallet for ${input.cryptocurrency} already exists. Use update instead.`,
      };
    }

    // Insert wallet
    const { data: wallet, error } = await supabase
      .from('merchant_wallets')
      .insert({
        merchant_id: merchantId,
        cryptocurrency: input.cryptocurrency,
        wallet_address: input.wallet_address,
        label: input.label || null,
        is_active: input.is_active ?? true,
      })
      .select()
      .single();

    if (error || !wallet) {
      return {
        success: false,
        error: error?.message || 'Failed to create wallet',
      };
    }

    return {
      success: true,
      wallet: wallet as MerchantWallet,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Wallet creation failed',
    };
  }
}

/**
 * List all global wallets for a merchant
 */
export async function listMerchantWallets(
  supabase: SupabaseClient,
  merchantId: string
): Promise<MerchantWalletListResult> {
  try {
    const { data: wallets, error } = await supabase
      .from('merchant_wallets')
      .select('*')
      .eq('merchant_id', merchantId)
      .order('cryptocurrency', { ascending: true });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      wallets: (wallets || []) as MerchantWallet[],
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list wallets',
    };
  }
}

/**
 * Get a single merchant wallet by cryptocurrency
 */
export async function getMerchantWallet(
  supabase: SupabaseClient,
  merchantId: string,
  cryptocurrency: Cryptocurrency
): Promise<MerchantWalletResult> {
  try {
    // Validate cryptocurrency
    const cryptoResult = cryptocurrencySchema.safeParse(cryptocurrency);
    if (!cryptoResult.success) {
      return {
        success: false,
        error: `Invalid cryptocurrency. Must be one of: ${SUPPORTED_CRYPTOCURRENCIES.join(', ')}`,
      };
    }

    const { data: wallet, error } = await supabase
      .from('merchant_wallets')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('cryptocurrency', cryptocurrency)
      .single();

    if (error || !wallet) {
      return {
        success: false,
        error: error?.message || 'Wallet not found',
      };
    }

    return {
      success: true,
      wallet: wallet as MerchantWallet,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get wallet',
    };
  }
}

/**
 * Update a merchant wallet
 */
export async function updateMerchantWallet(
  supabase: SupabaseClient,
  merchantId: string,
  cryptocurrency: Cryptocurrency,
  input: UpdateMerchantWalletInput
): Promise<MerchantWalletResult> {
  try {
    // Validate cryptocurrency
    const cryptoResult = cryptocurrencySchema.safeParse(cryptocurrency);
    if (!cryptoResult.success) {
      return {
        success: false,
        error: `Invalid cryptocurrency. Must be one of: ${SUPPORTED_CRYPTOCURRENCIES.join(', ')}`,
      };
    }

    // Validate wallet address if provided
    if (input.wallet_address) {
      const addressResult = walletAddressSchema.safeParse(input.wallet_address);
      if (!addressResult.success) {
        return {
          success: false,
          error: addressResult.error.errors[0].message,
        };
      }
    }

    // Validate label if provided
    if (input.label !== undefined) {
      const labelResult = labelSchema.safeParse(input.label);
      if (!labelResult.success) {
        return {
          success: false,
          error: 'Label must be 100 characters or less',
        };
      }
    }

    // Prepare update data
    const updateData: Record<string, unknown> = {};
    if (input.wallet_address !== undefined) updateData.wallet_address = input.wallet_address;
    if (input.label !== undefined) updateData.label = input.label || null;
    if (input.is_active !== undefined) updateData.is_active = input.is_active;

    // Update wallet
    const { data: wallet, error } = await supabase
      .from('merchant_wallets')
      .update(updateData)
      .eq('merchant_id', merchantId)
      .eq('cryptocurrency', cryptocurrency)
      .select()
      .single();

    if (error || !wallet) {
      return {
        success: false,
        error: error?.message || 'Failed to update wallet',
      };
    }

    return {
      success: true,
      wallet: wallet as MerchantWallet,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Wallet update failed',
    };
  }
}

/**
 * Delete a merchant wallet
 */
export async function deleteMerchantWallet(
  supabase: SupabaseClient,
  merchantId: string,
  cryptocurrency: Cryptocurrency
): Promise<{ success: boolean; error?: string }> {
  try {
    // Validate cryptocurrency
    const cryptoResult = cryptocurrencySchema.safeParse(cryptocurrency);
    if (!cryptoResult.success) {
      return {
        success: false,
        error: `Invalid cryptocurrency. Must be one of: ${SUPPORTED_CRYPTOCURRENCIES.join(', ')}`,
      };
    }

    const { error } = await supabase
      .from('merchant_wallets')
      .delete()
      .eq('merchant_id', merchantId)
      .eq('cryptocurrency', cryptocurrency);

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
      error: error instanceof Error ? error.message : 'Wallet deletion failed',
    };
  }
}

/**
 * Import global wallets to a business
 * Skips wallets that already exist on the business
 */
export async function importWalletsToBusiness(
  supabase: SupabaseClient,
  merchantId: string,
  businessId: string,
  cryptocurrencies?: Cryptocurrency[]
): Promise<ImportWalletsResult> {
  try {
    // Verify business belongs to merchant
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .eq('merchant_id', merchantId)
      .single();

    if (businessError || !business) {
      return {
        success: false,
        error: 'Business not found or access denied',
      };
    }

    // Get merchant's global wallets
    let query = supabase
      .from('merchant_wallets')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('is_active', true);

    if (cryptocurrencies && cryptocurrencies.length > 0) {
      query = query.in('cryptocurrency', cryptocurrencies);
    }

    const { data: merchantWallets, error: walletsError } = await query;

    if (walletsError) {
      return {
        success: false,
        error: walletsError.message,
      };
    }

    if (!merchantWallets || merchantWallets.length === 0) {
      return {
        success: true,
        imported: 0,
        skipped: 0,
      };
    }

    // Get existing business wallets
    const { data: existingWallets } = await supabase
      .from('business_wallets')
      .select('cryptocurrency')
      .eq('business_id', businessId);

    const existingCryptos = new Set(
      (existingWallets || []).map((w) => w.cryptocurrency)
    );

    // Filter out wallets that already exist
    const walletsToImport = merchantWallets.filter(
      (w) => !existingCryptos.has(w.cryptocurrency)
    );

    const skipped = merchantWallets.length - walletsToImport.length;

    if (walletsToImport.length === 0) {
      return {
        success: true,
        imported: 0,
        skipped,
      };
    }

    // Import wallets
    const { error: insertError } = await supabase.from('business_wallets').insert(
      walletsToImport.map((w) => ({
        business_id: businessId,
        cryptocurrency: w.cryptocurrency,
        wallet_address: w.wallet_address,
        is_active: true,
      }))
    );

    if (insertError) {
      return {
        success: false,
        error: insertError.message,
      };
    }

    return {
      success: true,
      imported: walletsToImport.length,
      skipped,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Import failed',
    };
  }
}
