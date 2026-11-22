/**
 * Order manager: durable quotes and orders, idempotency, state transitions and
 * the append-only event log. Service-role Supabase client only.
 *
 * Money-moving rule: never call a provider twice for the same order. The order
 * row is inserted FIRST under (wallet_id, idempotency_key); a retry with the
 * same key gets the existing order back instead of a second provider swap.
 */

import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAsset, normalizeAsset } from './assets';
import { isPositiveDecimal } from './decimal';
import { evaluatePolicy } from './policy';
import { getAdapter, routeQuotes, type RoutedQuotes } from './router';
import { canTransition, isCancellable, isTerminal } from './state';
import {
  ExchangeError,
  type ExchangeOrderStatus,
  type ExchangeQuote,
  type ExchangeQuoteRequest,
  type ExecutionPlan,
} from './types';
import { isValidChain, validateAddress } from '@/lib/web-wallet/identity';

/** Don't hit a provider status API more than once per this window per order. */
const POLL_MIN_INTERVAL_MS = 15_000;
/** Quotes without a provider expiry are refused for orders after this. */
const DEFAULT_QUOTE_TTL_MS = 10 * 60 * 1000;

export interface StoredQuote extends ExchangeQuote {
  id: string;
}

export interface ExchangeOrderRow {
  id: string;
  wallet_id: string;
  quote_id: string | null;
  idempotency_key: string;
  provider: string;
  from_asset: string;
  to_asset: string;
  amount_in: string;
  expected_amount_out: string | null;
  amount_out: string | null;
  destination_address: string;
  refund_address: string | null;
  status: ExchangeOrderStatus;
  provider_order_id: string | null;
  provider_status: string | null;
  plan: ExecutionPlan | null;
  details: Record<string, unknown>;
  in_tx_hash: string | null;
  out_tx_hash: string | null;
  expires_at: string | null;
  policy_version: string;
  last_polled_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function checkAddress(address: string | undefined, asset: string, field: string): void {
  if (!address) return;
  if (typeof address !== 'string' || address.length > 128 || !isValidChain(asset) || !validateAddress(address, asset)) {
    throw new ExchangeError(`${field} is not a valid ${asset} address`, 'invalid_request');
  }
}

export function parseQuoteRequest(input: Record<string, unknown>, country: string | null): ExchangeQuoteRequest {
  const from = normalizeAsset(input.from as string);
  const to = normalizeAsset(input.to as string);
  if (!from) throw new ExchangeError(`Unsupported source asset: ${String(input.from ?? '')}`, 'unsupported');
  if (!to) throw new ExchangeError(`Unsupported destination asset: ${String(input.to ?? '')}`, 'unsupported');
  if (from === to) throw new ExchangeError('Cannot exchange an asset for itself', 'invalid_request');
  const amount = typeof input.amount === 'number' ? String(input.amount) : input.amount;
  if (!isPositiveDecimal(amount)) throw new ExchangeError('amount must be a positive decimal string', 'invalid_request');
  const destinationAddress = (input.destinationAddress ?? input.destination_address) as string | undefined;
  const refundAddress = (input.refundAddress ?? input.refund_address) as string | undefined;
  checkAddress(destinationAddress, to, 'destinationAddress');
  checkAddress(refundAddress, from, 'refundAddress');
  return { from, to, amount: amount.trim(), destinationAddress, refundAddress, country };
}

/** Quote every eligible provider and persist the set so an order can cite one. */
export async function quoteAndStore(
  supabase: SupabaseClient,
  req: ExchangeQuoteRequest
): Promise<Omit<RoutedQuotes, 'quotes'> & { requestId: string; quotes: StoredQuote[] }> {
  const routed = await routeQuotes(req);
  const requestId = randomUUID();
  if (routed.quotes.length === 0) return { ...routed, requestId, quotes: [] };

  const rows = routed.quotes.map((q, i) => ({
    request_id: requestId,
    provider: q.provider,
    from_asset: q.from,
    to_asset: q.to,
    amount_in: q.amountIn,
    expected_amount_out: q.expectedAmountOut,
    fees: q.fees,
    route: q.route,
    verification: q.verification,
    rank: i + 1,
    expires_at: q.expiresAt ? new Date(q.expiresAt).toISOString() : null,
    destination_address: req.destinationAddress ?? null,
    country: req.country ?? null,
    policy_version: routed.policyVersion,
  }));
  const { data, error } = await supabase.from('exchange_quotes').insert(rows).select('id, rank');
  if (error || !data) throw new Error(`Failed to store quotes: ${error?.message}`);
  const idByRank = new Map(data.map((r: { id: string; rank: number }) => [r.rank, r.id]));
  return {
    ...routed,
    requestId,
    quotes: routed.quotes.map((q, i) => ({ ...q, id: idByRank.get(i + 1)! })),
  };
}

async function appendEvent(
  supabase: SupabaseClient,
  orderId: string,
  e: { source: string; from: ExchangeOrderStatus | null; to: ExchangeOrderStatus; providerStatus?: string | null; data?: Record<string, unknown>; dedupeKey: string }
): Promise<void> {
  const { error } = await supabase.from('exchange_order_events').insert({
    order_id: orderId,
    source: e.source,
    from_status: e.from,
    to_status: e.to,
    provider_status: e.providerStatus ?? null,
    data: e.data ?? {},
    dedupe_key: e.dedupeKey,
  });
  // 23505 = the same event was already recorded: that is the dedupe working.
  if (error && error.code !== '23505') console.error('[exchange] event insert failed', orderId, error.message);
}

async function transition(
  supabase: SupabaseClient,
  order: ExchangeOrderRow,
  to: ExchangeOrderStatus,
  patch: Partial<ExchangeOrderRow>,
  event: { source: string; providerStatus?: string | null; data?: Record<string, unknown>; dedupeKey: string }
): Promise<ExchangeOrderRow> {
  if (!canTransition(order.status, to)) {
    throw new ExchangeError(`Order cannot move from ${order.status} to ${to}`, 'invalid_transition', 409);
  }
  const update: Partial<ExchangeOrderRow> = { ...patch, status: to };
  if (to === 'completed' && !order.completed_at) update.completed_at = new Date().toISOString();
  // Compare-and-set on the old status so two concurrent pollers cannot both apply.
  const { data, error } = await supabase
    .from('exchange_orders')
    .update(update)
    .eq('id', order.id)
    .eq('status', order.status)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Failed to update order: ${error.message}`);
  if (!data) {
    const fresh = await loadOrder(supabase, order.id, order.wallet_id);
    if (!fresh) throw new ExchangeError('Order not found', 'invalid_request', 404);
    return fresh; // someone else moved it; theirs wins
  }
  if (to !== order.status || event.source !== 'poll') {
    await appendEvent(supabase, order.id, { ...event, from: order.status, to });
  }
  return data as ExchangeOrderRow;
}

export async function loadOrder(supabase: SupabaseClient, id: string, walletId: string): Promise<ExchangeOrderRow | null> {
  const { data, error } = await supabase
    .from('exchange_orders')
    .select('*')
    .eq('id', id)
    .eq('wallet_id', walletId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load order: ${error.message}`);
  return (data as ExchangeOrderRow) ?? null;
}

export async function listOrders(supabase: SupabaseClient, walletId: string, limit = 50): Promise<ExchangeOrderRow[]> {
  const { data, error } = await supabase
    .from('exchange_orders')
    .select('*')
    .eq('wallet_id', walletId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new Error(`Failed to list orders: ${error.message}`);
  return (data as ExchangeOrderRow[]) ?? [];
}

export interface CreateOrderInput {
  walletId: string;
  quoteId: string;
  idempotencyKey: string;
  destinationAddress: string;
  refundAddress?: string;
  country: string | null;
}

export async function createOrder(supabase: SupabaseClient, input: CreateOrderInput): Promise<{ order: ExchangeOrderRow; replayed: boolean }> {
  if (!/^[A-Za-z0-9_\-:.]{8,128}$/.test(input.idempotencyKey)) {
    throw new ExchangeError('Idempotency-Key must be 8-128 chars of [A-Za-z0-9_-:.]', 'invalid_request');
  }

  const existing = await supabase
    .from('exchange_orders')
    .select('*')
    .eq('wallet_id', input.walletId)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();
  if (existing.data) return { order: existing.data as ExchangeOrderRow, replayed: true };

  const { data: q, error: qErr } = await supabase
    .from('exchange_quotes')
    .select('*')
    .eq('id', input.quoteId)
    .maybeSingle();
  if (qErr) throw new Error(`Failed to load quote: ${qErr.message}`);
  if (!q) throw new ExchangeError('Quote not found', 'invalid_request', 404);

  const quotedAt = new Date(q.created_at).getTime();
  const expiresAt = q.expires_at ? new Date(q.expires_at).getTime() : quotedAt + DEFAULT_QUOTE_TTL_MS;
  if (Date.now() >= Math.min(expiresAt, quotedAt + DEFAULT_QUOTE_TTL_MS)) {
    throw new ExchangeError('Quote expired; request a new one', 'quote_expired', 409);
  }

  const adapter = getAdapter(q.provider);
  if (!adapter || !adapter.isConfigured()) throw new ExchangeError('Provider unavailable', 'provider_unavailable', 503);

  checkAddress(input.destinationAddress, q.to_asset, 'destinationAddress');
  checkAddress(input.refundAddress, q.from_asset, 'refundAddress');
  if (!input.destinationAddress) throw new ExchangeError('destinationAddress is required', 'invalid_request');

  const policy = evaluatePolicy({ rail: 'crypto_crypto', from: q.from_asset, to: q.to_asset, country: input.country, provider: adapter.id });
  if (!policy.allow) throw new ExchangeError(`Exchange not available: ${policy.reason}`, 'policy_denied', 403);

  const amountIn = String(q.amount_in);
  const insert = await supabase
    .from('exchange_orders')
    .insert({
      wallet_id: input.walletId,
      quote_id: q.id,
      idempotency_key: input.idempotencyKey,
      provider: adapter.id,
      from_asset: q.from_asset,
      to_asset: q.to_asset,
      amount_in: amountIn,
      expected_amount_out: q.expected_amount_out,
      destination_address: input.destinationAddress,
      refund_address: input.refundAddress ?? null,
      status: 'created',
      policy_version: policy.version,
    })
    .select('*')
    .single();
  if (insert.error) {
    if (insert.error.code === '23505') {
      const again = await supabase.from('exchange_orders').select('*')
        .eq('wallet_id', input.walletId).eq('idempotency_key', input.idempotencyKey).single();
      if (again.data) return { order: again.data as ExchangeOrderRow, replayed: true };
    }
    throw new Error(`Failed to create order: ${insert.error.message}`);
  }
  let order = insert.data as ExchangeOrderRow;
  await appendEvent(supabase, order.id, { source: 'api', from: null, to: 'created', dedupeKey: 'created', data: { quoteId: q.id, policy: policy.version } });

  const quote: ExchangeQuote = {
    provider: adapter.id,
    from: q.from_asset,
    to: q.to_asset,
    amountIn,
    expectedAmountOut: String(q.expected_amount_out),
    fees: q.fees,
    expiresAt,
    etaSeconds: null,
    verification: q.verification,
    warnings: [],
    route: q.route,
  };

  try {
    const po = await adapter.createOrder(quote, {
      from: q.from_asset,
      to: q.to_asset,
      amount: amountIn,
      destinationAddress: input.destinationAddress,
      refundAddress: input.refundAddress,
      country: input.country,
    });
    order = await transition(supabase, order, 'awaiting_user_action', {
      provider_order_id: po.providerOrderId,
      plan: po.plan,
      details: po.details,
      expires_at: po.plan.expiresAt ? new Date(po.plan.expiresAt).toISOString() : null,
    }, { source: 'api', dedupeKey: 'plan_issued', data: { providerOrderId: po.providerOrderId } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    order = await transition(supabase, order, 'failed', { details: { error: message } }, { source: 'api', dedupeKey: 'create_failed', data: { error: message } });
    if (e instanceof ExchangeError) throw e;
    throw new ExchangeError(message, 'provider_unavailable', 502);
  }
  return { order, replayed: false };
}

/** The user's wallet broadcast the plan's transaction; record its hash. */
export async function submitOrderTx(supabase: SupabaseClient, order: ExchangeOrderRow, txHash: string): Promise<ExchangeOrderRow> {
  const hash = typeof txHash === 'string' ? txHash.trim() : '';
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(hash) && !/^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(hash)) {
    throw new ExchangeError('txHash is not a transaction hash', 'invalid_request');
  }
  if (order.in_tx_hash) {
    if (order.in_tx_hash.toLowerCase() === hash.toLowerCase()) return order;
    throw new ExchangeError('A different transaction is already attached to this order', 'invalid_transition', 409);
  }
  if (order.status !== 'awaiting_user_action') {
    throw new ExchangeError(`Order is ${order.status}`, 'invalid_transition', 409);
  }
  if (order.expires_at && Date.now() > new Date(order.expires_at).getTime()) {
    // Funds sent after a THORChain quote expiry may still be processed or
    // refunded by the protocol; park it for a human rather than dropping it.
    return transition(supabase, order, 'manual_review', { in_tx_hash: hash }, { source: 'user', dedupeKey: `tx:${hash.toLowerCase()}`, data: { late: true } });
  }
  try {
    return await transition(supabase, order, 'submitted', { in_tx_hash: hash }, { source: 'user', dedupeKey: `tx:${hash.toLowerCase()}` });
  } catch (e) {
    if (e instanceof Error && /uq_exchange_orders_in_tx|duplicate key/.test(e.message)) {
      throw new ExchangeError('That transaction is already attached to another order', 'invalid_transition', 409);
    }
    throw e;
  }
}

export async function cancelOrder(supabase: SupabaseClient, order: ExchangeOrderRow): Promise<ExchangeOrderRow> {
  if (!isCancellable(order.status)) {
    throw new ExchangeError(`Order is ${order.status} and can no longer be cancelled`, 'invalid_transition', 409);
  }
  return transition(supabase, order, 'cancelled', {}, { source: 'user', dedupeKey: 'cancelled' });
}

/**
 * Pull the provider's view of an open order and apply it if the transition is
 * legal. Throttled per order, and a provider error never changes state.
 */
export async function refreshOrder(supabase: SupabaseClient, order: ExchangeOrderRow, opts: { force?: boolean } = {}): Promise<ExchangeOrderRow> {
  if (isTerminal(order.status)) return order;

  if (order.status === 'awaiting_user_action' && order.expires_at && !order.in_tx_hash
      && Date.now() > new Date(order.expires_at).getTime() && order.provider === 'thorchain') {
    return transition(supabase, order, 'expired', {}, { source: 'system', dedupeKey: 'expired' });
  }

  const last = order.last_polled_at ? new Date(order.last_polled_at).getTime() : 0;
  if (!opts.force && Date.now() - last < POLL_MIN_INTERVAL_MS) return order;

  const adapter = getAdapter(order.provider);
  if (!adapter) return order;

  const polledAt = new Date().toISOString();
  let update;
  try {
    update = await adapter.getStatus({ providerOrderId: order.provider_order_id, inTxHash: order.in_tx_hash, route: order.details });
  } catch (e) {
    console.warn('[exchange] status poll failed', order.id, e instanceof Error ? e.message : e);
    await supabase.from('exchange_orders').update({ last_polled_at: polledAt }).eq('id', order.id);
    return { ...order, last_polled_at: polledAt };
  }
  if (!update) {
    await supabase.from('exchange_orders').update({ last_polled_at: polledAt }).eq('id', order.id);
    return { ...order, last_polled_at: polledAt };
  }

  // A completion must carry the payout transaction; otherwise a human checks it.
  let to = update.status;
  if (to === 'completed' && !update.outTxHash) to = 'manual_review';

  const patch: Partial<ExchangeOrderRow> = { last_polled_at: polledAt, provider_status: update.providerStatus };
  if (update.outTxHash) patch.out_tx_hash = update.outTxHash;
  if (update.amountOut) patch.amount_out = update.amountOut;
  if (update.inTxHash && !order.in_tx_hash) patch.in_tx_hash = update.inTxHash;

  if (!canTransition(order.status, to)) {
    // Out-of-order or backwards report: keep the evidence, not the state.
    await supabase.from('exchange_orders').update({ last_polled_at: polledAt, provider_status: update.providerStatus }).eq('id', order.id);
    return { ...order, last_polled_at: polledAt, provider_status: update.providerStatus };
  }
  return transition(supabase, order, to, patch, {
    source: 'poll',
    providerStatus: update.providerStatus,
    dedupeKey: `poll:${to}:${update.providerStatus}:${update.outTxHash ?? ''}`,
    data: { outTxHash: update.outTxHash ?? null, amountOut: update.amountOut ?? null },
  });
}

/** Public shape: everything the wallet needs, nothing internal. */
export function presentOrder(o: ExchangeOrderRow) {
  const fromAsset = getAsset(o.from_asset);
  return {
    id: o.id,
    status: o.status,
    provider: o.provider,
    from: o.from_asset,
    to: o.to_asset,
    amountIn: String(o.amount_in),
    expectedAmountOut: o.expected_amount_out != null ? String(o.expected_amount_out) : null,
    amountOut: o.amount_out != null ? String(o.amount_out) : null,
    destinationAddress: o.destination_address,
    refundAddress: o.refund_address,
    nextAction: o.status === 'awaiting_user_action' ? o.plan : null,
    providerOrderId: o.provider_order_id,
    providerStatus: o.provider_status,
    inTxHash: o.in_tx_hash,
    outTxHash: o.out_tx_hash,
    expiresAt: o.expires_at,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    completedAt: o.completed_at,
    chain: fromAsset?.chain ?? null,
  };
}
