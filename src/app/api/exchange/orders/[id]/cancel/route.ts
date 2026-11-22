/**
 * POST /api/exchange/orders/:id/cancel — only while the order still waits on
 * the user (nothing has been sent). Once funds move, the chain decides.
 */

import { NextRequest } from 'next/server';
import { authorizeWallet } from '@/lib/swap/auth';
import { errorResponse, exchangeSupabase, guardEnabled, json } from '@/lib/exchange/http';
import { cancelOrder, loadOrder, presentOrder } from '@/lib/exchange/orders';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = guardEnabled();
  if (off) return off;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Order not found' }, 404);

  const supabase = exchangeSupabase();
  const raw = await request.text();
  const auth = await authorizeWallet(supabase, request, raw);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  try {
    const order = await loadOrder(supabase, id, auth.walletId);
    if (!order) return json({ error: 'Order not found' }, 404);
    return json({ order: presentOrder(await cancelOrder(supabase, order)) });
  } catch (e) {
    return errorResponse(e, 'orders.cancel');
  }
}
