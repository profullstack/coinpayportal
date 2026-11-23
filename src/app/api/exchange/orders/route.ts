/**
 * POST /api/exchange/orders — accept a quote. Wallet-signed.
 *   Header: Idempotency-Key (required)
 *   Body:   { quoteId, destinationAddress, refundAddress? }
 *   Returns the order and its nextAction: what the user's wallet must send.
 *
 * GET /api/exchange/orders — the authenticated wallet's orders.
 *
 * Never accepts a private key or seed phrase: the wallet signs and broadcasts
 * the nextAction itself, then reports the tx hash to /orders/:id/submit.
 */

import { NextRequest } from 'next/server';
import { authorizeWallet } from '@/lib/swap/auth';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { errorResponse, exchangeSupabase, guardEnabled, guardWallet, json, requestCountry } from '@/lib/exchange/http';
import { createOrder, listOrders, presentOrder } from '@/lib/exchange/orders';

export async function POST(request: NextRequest) {
  const off = guardEnabled();
  if (off) return off;

  const supabase = exchangeSupabase();
  const raw = await request.text();
  const auth = await authorizeWallet(supabase, request, raw);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const gate = guardWallet(auth.walletId);
  if (gate) return gate;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_request' }, 400);
  }
  const idempotencyKey = request.headers.get('idempotency-key') ?? (body.idempotencyKey as string | undefined);
  if (!idempotencyKey) return json({ error: 'Idempotency-Key header is required', code: 'invalid_request' }, 400);
  if (typeof body.quoteId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.quoteId)) {
    return json({ error: 'quoteId is required', code: 'invalid_request' }, 400);
  }

  const rate = await checkRateLimitAsync(auth.walletId, 'exchange_order');
  if (!rate.allowed) return json({ error: 'Too many exchange orders. Try again later.', code: 'rate_limited' }, 429);

  try {
    const { order, replayed } = await createOrder(supabase, {
      walletId: auth.walletId,
      quoteId: body.quoteId,
      idempotencyKey,
      destinationAddress: String(body.destinationAddress ?? body.destination_address ?? ''),
      refundAddress: (body.refundAddress ?? body.refund_address) as string | undefined,
      country: requestCountry(request),
    });
    return json({ order: presentOrder(order), replayed }, replayed ? 200 : 201);
  } catch (e) {
    return errorResponse(e, 'orders.create');
  }
}

export async function GET(request: NextRequest) {
  const off = guardEnabled();
  if (off) return off;

  const supabase = exchangeSupabase();
  const auth = await authorizeWallet(supabase, request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const gate = guardWallet(auth.walletId);
  if (gate) return gate;
  try {
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 50);
    const orders = await listOrders(supabase, auth.walletId, Number.isFinite(limit) ? limit : 50);
    return json({ orders: orders.map(presentOrder) });
  } catch (e) {
    return errorResponse(e, 'orders.list');
  }
}
