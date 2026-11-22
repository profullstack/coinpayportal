/**
 * POST /api/exchange/orders/:id/submit — body { txHash }
 * The wallet broadcast the order's nextAction; attach the inbound tx hash so
 * the swap can be tracked. A hash can belong to only one order.
 */

import { NextRequest } from 'next/server';
import { authorizeWallet } from '@/lib/swap/auth';
import { errorResponse, exchangeSupabase, guardEnabled, json } from '@/lib/exchange/http';
import { loadOrder, presentOrder, submitOrderTx } from '@/lib/exchange/orders';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = guardEnabled();
  if (off) return off;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Order not found' }, 404);

  const supabase = exchangeSupabase();
  const raw = await request.text();
  const auth = await authorizeWallet(supabase, request, raw);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  let body: { txHash?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_request' }, 400);
  }

  try {
    const order = await loadOrder(supabase, id, auth.walletId);
    if (!order) return json({ error: 'Order not found' }, 404);
    const updated = await submitOrderTx(supabase, order, String(body.txHash ?? ''));
    return json({ order: presentOrder(updated) });
  } catch (e) {
    return errorResponse(e, 'orders.submit');
  }
}
