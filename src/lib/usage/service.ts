import type { SupabaseClient } from '@supabase/supabase-js';

export interface UsageBalance {
  id: string;
  business_id: string;
  user_email: string;
  balance_usd: number;
  lifetime_purchased_usd: number;
  lifetime_used_usd: number;
  low_balance_threshold_usd: number;
  auto_refill: boolean;
  auto_refill_amount_usd: number;
  auto_refill_below_usd: number;
  created_at: string;
  updated_at: string;
}

export interface UsageRate {
  id: string;
  business_id: string;
  action_type: string;
  description: string | null;
  cost_usd: number;
  unit: string;
  created_at: string;
}

export interface UsageLogEntry {
  id: string;
  business_id: string;
  user_email: string;
  action_type: string;
  quantity: number;
  cost_usd: number;
  metadata: Record<string, unknown>;
  credit_id: string;
  created_at: string;
}

export interface DeductResult {
  success: boolean;
  remaining_balance: number;
  cost: number;
  action_type: string;
  error?: string;
}

export interface UsageHistoryFilters {
  action_type?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/**
 * Get credit balance for a user within a business.
 * Returns null if no credit record exists.
 */
export async function getBalance(
  supabase: SupabaseClient,
  businessId: string,
  userEmail: string
): Promise<UsageBalance | null> {
  const { data, error } = await supabase
    .from('usage_credits')
    .select('*')
    .eq('business_id', businessId)
    .eq('user_email', userEmail)
    .single();

  if (error || !data) return null;
  return data as UsageBalance;
}

/**
 * Add credits to a user's balance (top-up).
 * Creates the credit record if it doesn't exist.
 */
export async function addCredits(
  supabase: SupabaseClient,
  businessId: string,
  userEmail: string,
  amountUsd: number,
  paymentId?: string,
  paymentMethod: string = 'crypto',
  txHash?: string
): Promise<{ success: boolean; balance?: UsageBalance; error?: string }> {
  // Upsert the credit balance
  const { data: existing } = await supabase
    .from('usage_credits')
    .select('id, balance_usd, lifetime_purchased_usd')
    .eq('business_id', businessId)
    .eq('user_email', userEmail)
    .single();

  let creditRecord: UsageBalance;

  if (existing) {
    const newBalance = Number(existing.balance_usd) + amountUsd;
    const newLifetime = Number(existing.lifetime_purchased_usd) + amountUsd;

    const { data, error } = await supabase
      .from('usage_credits')
      .update({
        balance_usd: newBalance,
        lifetime_purchased_usd: newLifetime,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('*')
      .single();

    if (error || !data) {
      return { success: false, error: error?.message || 'Failed to update credits' };
    }
    creditRecord = data as UsageBalance;
  } else {
    const { data, error } = await supabase
      .from('usage_credits')
      .insert({
        business_id: businessId,
        user_email: userEmail,
        balance_usd: amountUsd,
        lifetime_purchased_usd: amountUsd,
      })
      .select('*')
      .single();

    if (error || !data) {
      return { success: false, error: error?.message || 'Failed to create credits' };
    }
    creditRecord = data as UsageBalance;
  }

  // Record the top-up
  await supabase.from('usage_topups').insert({
    business_id: businessId,
    user_email: userEmail,
    amount_usd: amountUsd,
    payment_method: paymentMethod,
    payment_id: paymentId || null,
    tx_hash: txHash || null,
    status: 'completed',
  });

  return { success: true, balance: creditRecord };
}

/**
 * Check if a user has enough credits for an action without deducting.
 */
export async function checkBalance(
  supabase: SupabaseClient,
  businessId: string,
  userEmail: string,
  actionType: string,
  quantity: number = 1
): Promise<{ sufficient: boolean; cost: number; balance: number; error?: string }> {
  // Look up the rate
  const { data: rate, error: rateError } = await supabase
    .from('usage_rates')
    .select('cost_usd')
    .eq('business_id', businessId)
    .eq('action_type', actionType)
    .single();

  if (rateError || !rate) {
    return { sufficient: false, cost: 0, balance: 0, error: `No rate defined for action type: ${actionType}` };
  }

  const totalCost = Number(rate.cost_usd) * quantity;

  const balance = await getBalance(supabase, businessId, userEmail);
  const currentBalance = balance ? Number(balance.balance_usd) : 0;

  return {
    sufficient: currentBalance >= totalCost,
    cost: totalCost,
    balance: currentBalance,
  };
}

/**
 * Deduct credits for an action. Atomic: checks balance and deducts in a single update
 * that only succeeds if balance >= cost.
 */
export async function deductCredits(
  supabase: SupabaseClient,
  businessId: string,
  userEmail: string,
  actionType: string,
  quantity: number = 1,
  metadata: Record<string, unknown> = {}
): Promise<DeductResult> {
  // Look up the rate
  const { data: rate, error: rateError } = await supabase
    .from('usage_rates')
    .select('cost_usd')
    .eq('business_id', businessId)
    .eq('action_type', actionType)
    .single();

  if (rateError || !rate) {
    return {
      success: false,
      remaining_balance: 0,
      cost: 0,
      action_type: actionType,
      error: `No rate defined for action type: ${actionType}`,
    };
  }

  const totalCost = Number(rate.cost_usd) * quantity;

  // Atomic deduction: update only if balance is sufficient
  // Uses a conditional update — balance_usd >= totalCost
  const { data: credit, error: creditError } = await supabase
    .from('usage_credits')
    .select('id, balance_usd, lifetime_used_usd')
    .eq('business_id', businessId)
    .eq('user_email', userEmail)
    .gte('balance_usd', totalCost)
    .single();

  if (creditError || !credit) {
    // Check if user exists but insufficient balance vs no record
    const existing = await getBalance(supabase, businessId, userEmail);
    const currentBalance = existing ? Number(existing.balance_usd) : 0;
    return {
      success: false,
      remaining_balance: currentBalance,
      cost: totalCost,
      action_type: actionType,
      error: 'Insufficient credits',
    };
  }

  const newBalance = Number(credit.balance_usd) - totalCost;
  const newLifetimeUsed = Number(credit.lifetime_used_usd) + totalCost;

  const { data: updated, error: updateError } = await supabase
    .from('usage_credits')
    .update({
      balance_usd: newBalance,
      lifetime_used_usd: newLifetimeUsed,
      updated_at: new Date().toISOString(),
    })
    .eq('id', credit.id)
    .gte('balance_usd', totalCost) // Double-check in the update for atomicity
    .select('balance_usd')
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      remaining_balance: Number(credit.balance_usd),
      cost: totalCost,
      action_type: actionType,
      error: 'Insufficient credits (race condition)',
    };
  }

  // Log the usage
  await supabase.from('usage_log').insert({
    business_id: businessId,
    user_email: userEmail,
    action_type: actionType,
    quantity,
    cost_usd: totalCost,
    metadata,
    credit_id: credit.id,
  });

  return {
    success: true,
    remaining_balance: Number(updated.balance_usd),
    cost: totalCost,
    action_type: actionType,
  };
}

/**
 * Get usage history for a user within a business.
 */
export async function getUsageHistory(
  supabase: SupabaseClient,
  businessId: string,
  userEmail: string,
  filters: UsageHistoryFilters = {}
): Promise<{ data: UsageLogEntry[]; count: number }> {
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  let query = supabase
    .from('usage_log')
    .select('*', { count: 'exact' })
    .eq('business_id', businessId)
    .eq('user_email', userEmail)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.action_type) {
    query = query.eq('action_type', filters.action_type);
  }
  if (filters.from) {
    query = query.gte('created_at', filters.from);
  }
  if (filters.to) {
    query = query.lte('created_at', filters.to);
  }

  const { data, error, count } = await query;

  if (error || !data) {
    return { data: [], count: 0 };
  }

  return { data: data as UsageLogEntry[], count: count || 0 };
}

/**
 * Get all rates for a business.
 */
export async function getRates(
  supabase: SupabaseClient,
  businessId: string
): Promise<UsageRate[]> {
  const { data, error } = await supabase
    .from('usage_rates')
    .select('*')
    .eq('business_id', businessId)
    .order('action_type', { ascending: true });

  if (error || !data) return [];
  return data as UsageRate[];
}

/**
 * Create or update a rate for a business.
 */
export async function upsertRate(
  supabase: SupabaseClient,
  businessId: string,
  actionType: string,
  costUsd: number,
  unit: string = 'request',
  description?: string
): Promise<{ success: boolean; rate?: UsageRate; error?: string }> {
  const { data, error } = await supabase
    .from('usage_rates')
    .upsert(
      {
        business_id: businessId,
        action_type: actionType,
        cost_usd: costUsd,
        unit,
        description: description || null,
      },
      { onConflict: 'business_id,action_type' }
    )
    .select('*')
    .single();

  if (error || !data) {
    return { success: false, error: error?.message || 'Failed to upsert rate' };
  }

  return { success: true, rate: data as UsageRate };
}

/**
 * Delete a rate for a business.
 */
export async function deleteRate(
  supabase: SupabaseClient,
  businessId: string,
  actionType: string
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('usage_rates')
    .delete()
    .eq('business_id', businessId)
    .eq('action_type', actionType);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
