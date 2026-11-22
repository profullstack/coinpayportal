/**
 * GET /api/exchange/providers/status — admin only. Provider configuration,
 * kill-switch state, and order counts that need attention.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { exchangeSupabase, json } from '@/lib/exchange/http';
import { getAdapters } from '@/lib/exchange/router';
import { POLICY_VERSION, isExchangeEnabled, isProviderEnabled } from '@/lib/exchange/policy';

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const supabase = exchangeSupabase();
  const counts: Record<string, number> = {};
  for (const status of ['awaiting_user_action', 'submitted', 'pending', 'refund_pending', 'manual_review', 'failed']) {
    const { count } = await supabase.from('exchange_orders').select('id', { count: 'exact', head: true }).eq('status', status);
    counts[status] = count ?? 0;
  }

  return json({
    enabled: isExchangeEnabled(),
    policyVersion: POLICY_VERSION,
    providers: getAdapters().map((a) => ({
      id: a.id,
      label: a.label,
      configured: a.isConfigured(),
      enabled: isProviderEnabled(a.id),
    })),
    orders: counts,
  });
}
