import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

/**
 * Supported cryptocurrencies
 */
export const SUPPORTED_CRYPTOCURRENCIES = ['BTC', 'ETH', 'MATIC', 'SOL'] as const;
export type Cryptocurrency = (typeof SUPPORTED_CRYPTOCURRENCIES)[number];

/**
 * Validation schemas
 */
const cryptocurrencySchema = z.enum(SUPPORTED_CRYPTOCURRENCIES);
const walletAddressSchema = z.string().min(26, 'Invalid wallet address').max(100);

/**
 * Types
 */
export interface BusinessWallet {
  id: string;
  business_id: string;
  cryptocurrency: Cryptocurrency;
  wallet_address: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateWalletInput {
  cryptocurrency: Cryptocurrency;
  wallet_address: string;
  is_active?: boolean;
}

export interface UpdateWalletInput {
  wallet_address?: string;
  is_active?: boolean;
}

export interface WalletResult {
  success: boolean;
  wallet?: BusinessWallet;
  error?: string;
}

export interface WalletListResult {
  success: boolean;
  wallets?: BusinessWallet[];
  error?: string;
}

/**
 * Create a wallet for a business
 */
export async function createWallet(
  supabase: SupabaseClient,
  businessId: string,
  merchantId: string,
  input: CreateWalletInput
): Promise<WalletResult> {
  try {
    // Validate cryptocurrency
    const cryptoResult = cryptocurrencySchema.safeParse(input.cryptocurrency);
    if (!cryptoResult.success) {
      return {
        success: false,
        error: 'Invalid cryptocurrency. Must be one of: BTC, ETH, MATIC, SOL',
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

    // Check if wallet already exists for this cryptocurrency
    const { data: existing } = await supabase
      .from('business_wallets')
      .select('id')
      .eq('business_id', businessId)
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
      .from('business_wallets')
      .insert({
        business_id: businessId,
        cryptocurrency: input.cryptocurrency,
        wallet_address: input.wallet_address,
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
      wallet: wallet as BusinessWallet,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Wallet creation failed',
    };
  }
}

/**
 * List all wallets for a business
 */
export async function listWallets(
  supabase: SupabaseClient,
  businessId: string,
  merchantId: string
): Promise<WalletListResult> {
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

    // Get all wallets
    const { data: wallets, error } = await supabase
      .from('business_wallets')
      .select('*')
      .eq('business_id', businessId)
      .order('cryptocurrency', { ascending: true });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      wallets: (wallets || []) as BusinessWallet[],
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list wallets',
    };
  }
}

/**
 * Get a single wallet by cryptocurrency
 */
export async function getWallet(
  supabase: SupabaseClient,
  businessId: string,
  cryptocurrency: Cryptocurrency,
  merchantId: string
): Promise<WalletResult> {
  try {
    // Validate cryptocurrency
    const cryptoResult = cryptocurrencySchema.safeParse(cryptocurrency);
    if (!cryptoResult.success) {
      return {
        success: false,
        error: 'Invalid cryptocurrency',
      };
    }

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

    // Get wallet
    const { data: wallet, error } = await supabase
      .from('business_wallets')
      .select('*')
      .eq('business_id', businessId)
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
      wallet: wallet as BusinessWallet,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get wallet',
    };
  }
}

/**
 * Update a wallet
 */
export async function updateWallet(
  supabase: SupabaseClient,
  businessId: string,
  cryptocurrency: Cryptocurrency,
  merchantId: string,
  input: UpdateWalletInput
): Promise<WalletResult> {
  try {
    // Validate cryptocurrency
    const cryptoResult = cryptocurrencySchema.safeParse(cryptocurrency);
    if (!cryptoResult.success) {
      return {
        success: false,
        error: 'Invalid cryptocurrency',
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

    // Prepare update data
    const updateData: any = {};
    if (input.wallet_address !== undefined) updateData.wallet_address = input.wallet_address;
    if (input.is_active !== undefined) updateData.is_active = input.is_active;

    // Update wallet
    const { data: wallet, error } = await supabase
      .from('business_wallets')
      .update(updateData)
      .eq('business_id', businessId)
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
      wallet: wallet as BusinessWallet,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Wallet update failed',
    };
  }
}

/**
 * Delete a wallet
 */
export async function deleteWallet(
  supabase: SupabaseClient,
  businessId: string,
  cryptocurrency: Cryptocurrency,
  merchantId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Validate cryptocurrency
    const cryptoResult = cryptocurrencySchema.safeParse(cryptocurrency);
    if (!cryptoResult.success) {
      return {
        success: false,
        error: 'Invalid cryptocurrency',
      };
    }

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

    // Delete wallet
    const { error } = await supabase
      .from('business_wallets')
      .delete()
      .eq('business_id', businessId)
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
 * Get active wallet address for a cryptocurrency
 * Used by payment processing to determine where to forward funds
 */
export async function getActiveWalletAddress(
  supabase: SupabaseClient,
  businessId: string,
  cryptocurrency: Cryptocurrency
): Promise<{ success: boolean; address?: string; error?: string }> {
  try {
    const { data: wallet, error } = await supabase
      .from('business_wallets')
      .select('wallet_address')
      .eq('business_id', businessId)
      .eq('cryptocurrency', cryptocurrency)
      .eq('is_active', true)
      .single();

    if (error || !wallet) {
      return {
        success: false,
        error: `No active wallet found for ${cryptocurrency}`,
      };
    }

    return {
      success: true,
      address: wallet.wallet_address,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get wallet address',
    };
  }
}