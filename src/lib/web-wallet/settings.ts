/**
 * Web Wallet Settings & Security Controls
 *
 * Manages wallet settings including spend limits and address whitelists.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { validateAddress, isValidChain } from './identity';
import type { WalletChain } from './identity';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

// Supported fiat currencies
export const SUPPORTED_FIAT_CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'CHF', symbol: 'Fr', name: 'Swiss Franc' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
] as const;

export type FiatCurrency = typeof SUPPORTED_FIAT_CURRENCIES[number]['code'];

export interface WalletSettings {
  wallet_id: string;
  daily_spend_limit: number | null;
  whitelist_addresses: string[];
  whitelist_enabled: boolean;
  require_confirmation: boolean;
  confirmation_delay_seconds: number;
  display_currency: FiatCurrency;
}

export interface UpdateSettingsInput {
  daily_spend_limit?: number | null;
  whitelist_addresses?: string[];
  whitelist_enabled?: boolean;
  require_confirmation?: boolean;
  confirmation_delay_seconds?: number;
  display_currency?: FiatCurrency;
}

// ──────────────────────────────────────────────
// Settings CRUD
// ──────────────────────────────────────────────

/**
 * Get wallet settings. Creates default settings if none exist.
 */
export async function getSettings(
  supabase: SupabaseClient,
  walletId: string
): Promise<{ success: true; data: WalletSettings } | { success: false; error: string; code?: string }> {
  console.log(`[Settings] Loading settings for wallet ${walletId}`);

  const { data, error } = await supabase
    .from('wallet_settings')
    .select('*')
    .eq('wallet_id', walletId)
    .single();

  if (error && error.code === 'PGRST116') {
    // No settings row — create default
    const { data: created, error: createError } = await supabase
      .from('wallet_settings')
      .insert({
        wallet_id: walletId,
        daily_spend_limit: null,
        whitelist_addresses: [],
        whitelist_enabled: false,
        require_confirmation: false,
        confirmation_delay_seconds: 0,
        display_currency: 'USD',
      })
      .select('*')
      .single();

    if (createError || !created) {
      return { success: false, error: 'Failed to create default settings', code: 'DB_ERROR' };
    }

    return {
      success: true,
      data: formatSettings(walletId, created),
    };
  }

  if (error || !data) {
    return { success: false, error: 'Failed to load settings', code: 'DB_ERROR' };
  }

  return {
    success: true,
    data: formatSettings(walletId, data),
  };
}

/**
 * Update wallet settings.
 */
export async function updateSettings(
  supabase: SupabaseClient,
  walletId: string,
  input: UpdateSettingsInput
): Promise<{ success: true; data: WalletSettings } | { success: false; error: string; code?: string }> {
  // Validate spend limit
  if (input.daily_spend_limit !== undefined && input.daily_spend_limit !== null) {
    if (typeof input.daily_spend_limit !== 'number' || input.daily_spend_limit < 0) {
      return { success: false, error: 'Invalid daily spend limit', code: 'INVALID_LIMIT' };
    }
  }

  // Validate confirmation delay
  if (input.confirmation_delay_seconds !== undefined) {
    if (typeof input.confirmation_delay_seconds !== 'number' || input.confirmation_delay_seconds < 0) {
      return { success: false, error: 'Invalid confirmation delay', code: 'INVALID_DELAY' };
    }
  }

  // Validate display currency
  if (input.display_currency !== undefined) {
    const validCurrencies = SUPPORTED_FIAT_CURRENCIES.map(c => c.code);
    if (!validCurrencies.includes(input.display_currency)) {
      return { success: false, error: 'Invalid display currency', code: 'INVALID_CURRENCY' };
    }
  }

  console.log(`[Settings] Updating settings for wallet ${walletId}:`, Object.keys(input).filter(k => (input as any)[k] !== undefined).join(', '));

  // Build update object (only include fields that were provided)
  const updates: Record<string, any> = {};
  if (input.daily_spend_limit !== undefined) updates.daily_spend_limit = input.daily_spend_limit;
  if (input.whitelist_addresses !== undefined) updates.whitelist_addresses = input.whitelist_addresses;
  if (input.whitelist_enabled !== undefined) updates.whitelist_enabled = input.whitelist_enabled;
  if (input.require_confirmation !== undefined) updates.require_confirmation = input.require_confirmation;
  if (input.confirmation_delay_seconds !== undefined) updates.confirmation_delay_seconds = input.confirmation_delay_seconds;
  if (input.display_currency !== undefined) updates.display_currency = input.display_currency;

  if (Object.keys(updates).length === 0) {
    return { success: false, error: 'No fields to update', code: 'NO_CHANGES' };
  }

  // Upsert settings
  const { data, error } = await supabase
    .from('wallet_settings')
    .upsert({ wallet_id: walletId, ...updates }, { onConflict: 'wallet_id' })
    .select('*')
    .single();

  if (error || !data) {
    console.error(`[Settings] Update failed for wallet ${walletId}:`, error?.message);
    return { success: false, error: 'Failed to update settings', code: 'DB_ERROR' };
  }

  console.log(`[Settings] Settings updated for wallet ${walletId}`);

  return {
    success: true,
    data: formatSettings(walletId, data),
  };
}

// ──────────────────────────────────────────────
// Security Checks
// ──────────────────────────────────────────────

/**
 * Check if a transaction is allowed by the wallet's security settings.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export async function checkTransactionAllowed(
  supabase: SupabaseClient,
  walletId: string,
  toAddress: string,
  amount: number,
  chain: WalletChain
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const settingsResult = await getSettings(supabase, walletId);
  if (!settingsResult.success) {
    // If we can't load settings, allow (fail open for now)
    return { allowed: true };
  }

  const settings = settingsResult.data;

  // Check whitelist
  if (settings.whitelist_enabled && settings.whitelist_addresses.length > 0) {
    const isWhitelisted = settings.whitelist_addresses.some(
      (addr) => addr.toLowerCase() === toAddress.toLowerCase()
    );
    if (!isWhitelisted) {
      console.log(`[Settings] Transaction blocked: address not whitelisted for wallet ${walletId}`);
      return { allowed: false, reason: 'Recipient address not in whitelist' };
    }
  }

  // Check daily spend limit
  if (settings.daily_spend_limit !== null && settings.daily_spend_limit > 0) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const { data: todayTxs, error } = await supabase
      .from('wallet_transactions')
      .select('amount')
      .eq('wallet_id', walletId)
      .eq('direction', 'outgoing')
      .in('status', ['pending', 'confirming', 'confirmed'])
      .gte('created_at', todayStart.toISOString());

    if (!error && todayTxs) {
      const todayTotal = todayTxs.reduce((sum, tx) => sum + parseFloat(tx.amount || '0'), 0);
      if (todayTotal + amount > settings.daily_spend_limit) {
        console.log(`[Settings] Transaction blocked: daily spend limit exceeded for wallet ${walletId} (limit=${settings.daily_spend_limit}, spent=${todayTotal.toFixed(8)}, requested=${amount})`);
        return {
          allowed: false,
          reason: `Daily spend limit exceeded. Limit: ${settings.daily_spend_limit}, spent today: ${todayTotal.toFixed(8)}, requested: ${amount}`,
        };
      }
    }
  }

  return { allowed: true };
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatSettings(walletId: string, raw: any): WalletSettings {
  return {
    wallet_id: walletId,
    daily_spend_limit: raw.daily_spend_limit ?? null,
    whitelist_addresses: raw.whitelist_addresses || [],
    whitelist_enabled: raw.whitelist_enabled ?? false,
    require_confirmation: raw.require_confirmation ?? false,
    confirmation_delay_seconds: raw.confirmation_delay_seconds ?? 0,
    display_currency: raw.display_currency ?? 'USD',
  };
}

/**
 * Get the symbol for a fiat currency code
 */
export function getFiatSymbol(code: FiatCurrency): string {
  const currency = SUPPORTED_FIAT_CURRENCIES.find(c => c.code === code);
  return currency?.symbol ?? '$';
}
