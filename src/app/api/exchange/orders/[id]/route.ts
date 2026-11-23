/**
 * GET /api/exchange/orders/:id — normalised status. Polls the provider (at
 * most every 15 s per order) and applies only legal state transitions.
 */

import { NextRequest } from 'next/server';
import { authorizeWallet } from '@/lib/swap/auth';
import { errorResponse, exchangeSupabase, guardEnabled, guardWallet, json } from '@/lib/exchange/http';
import { loadOrder, presentOrder, refreshOrder } from '@/lib/exchange/orders';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = guardEnabled();
  if (off) return off;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Order not found' }, 404);

  const supabase = exchangeSupabase();
  const auth = await authorizeWallet(supabase, request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const gate = guardWallet(auth.walletId);
  if (gate) return gate;

  try {
    const order = await loadOrder(supabase, id, auth.walletId);
    if (!order) return json({ error: 'Order not found' }, 404);
    const fresh = await refreshOrder(supabase, order);
    return json({ order: presentOrder(fresh) });
  } catch (e) {
    return errorResponse(e, 'orders.get');
  }
}
