/**
 * THORChain adapter: native cross-chain swaps signed by the user's wallet.
 *
 * Quote:  GET {THORNODE}/thorchain/quote/swap
 * Order:  re-quote (THORChain says "Do not cache this response"), check the
 *         inbound vault is not halted, and hand the wallet a send-with-memo.
 * Status: GET {THORNODE}/thorchain/tx/status/{inTxHash}
 *
 * THORChain amounts are always integers with 8 decimals regardless of the
 * asset's own decimals.
 *
 * No key is needed. Affiliate fees are only added when THORCHAIN_AFFILIATE
 * (a registered THORName) and THORCHAIN_AFFILIATE_BPS are both set.
 */

import { getAsset } from '../assets';
import { fromBaseUnits, toBaseUnits } from '../decimal';
import {
  ExchangeError,
  type ExchangeAdapter,
  type ExchangeAsset,
  type ExchangeQuote,
  type ExchangeQuoteRequest,
  type OrderRef,
  type ProviderOrder,
  type ProviderStatusUpdate,
} from '../types';

// ninerealms (the old default) stopped resolving in 2026; liquify's gateway is
// the public endpoint that answered on 2026-11-22.
const DEFAULT_THORNODE = 'https://gateway.liquify.com/chain/thorchain_api';
const THOR_DECIMALS = 8;
const TIMEOUT_MS = 8000;

function thornode(): string {
  return (process.env.THORNODE_URL || DEFAULT_THORNODE).replace(/\/+$/, '');
}

interface ThorQuote {
  inbound_address?: string;
  router?: string;
  memo?: string;
  expiry?: number;
  expected_amount_out?: string;
  recommended_min_amount_in?: string;
  dust_threshold?: string;
  total_swap_seconds?: number;
  warning?: string;
  notes?: string;
  fees?: {
    asset?: string;
    affiliate?: string;
    outbound?: string;
    liquidity?: string;
    total?: string;
    total_bps?: number;
  };
  error?: string;
  message?: string;
}

interface ThorInbound {
  chain: string;
  address: string;
  router?: string;
  halted: boolean;
  global_trading_paused?: boolean;
  chain_trading_paused?: boolean;
}

async function thorGet<T>(path: string): Promise<T> {
  const res = await fetch(`${thornode()}${path}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ExchangeError(`THORNode returned non-JSON (${res.status})`, 'provider_unavailable', 502);
  }
  if (!res.ok) {
    const msg = (body as { message?: string })?.message || `THORNode error ${res.status}`;
    // Below-minimum is a user error, everything else is the provider's.
    if (/dust|less than|too small|not enough/i.test(msg)) {
      throw new ExchangeError(msg, 'below_minimum', 400);
    }
    throw new ExchangeError(msg, 'provider_unavailable', 502);
  }
  return body as T;
}

function thorAsset(symbol: ExchangeAsset): string {
  const a = getAsset(symbol)?.thorchain;
  if (!a) throw new ExchangeError(`THORChain does not support ${symbol}`, 'unsupported');
  return a;
}

/** "BTC.BTC" -> "BTC", "BASE.USDC-0X..." -> "BASE" */
function thorChainOf(asset: string): string {
  return asset.split('.')[0];
}

export class ThorchainAdapter implements ExchangeAdapter {
  readonly id = 'thorchain' as const;
  readonly label = 'THORChain';

  isConfigured(): boolean {
    return true; // public endpoint, no key
  }

  supports(from: ExchangeAsset, to: ExchangeAsset): boolean {
    return from !== to && !!getAsset(from)?.thorchain && !!getAsset(to)?.thorchain;
  }

  private async rawQuote(req: ExchangeQuoteRequest): Promise<ThorQuote> {
    const fromAsset = thorAsset(req.from);
    const toAsset = thorAsset(req.to);
    const amount = toBaseUnits(req.amount, THOR_DECIMALS);
    if (amount <= 0n) throw new ExchangeError('Amount too small', 'below_minimum');

    const qs = new URLSearchParams({
      from_asset: fromAsset,
      to_asset: toAsset,
      amount: amount.toString(),
      // Streaming lets THORChain split large swaps to cut slippage.
      streaming_interval: '1',
      streaming_quantity: '0',
    });
    if (req.destinationAddress) qs.set('destination', req.destinationAddress);
    if (req.refundAddress) qs.set('refund_address', req.refundAddress);
    const affiliate = process.env.THORCHAIN_AFFILIATE;
    const bps = Number(process.env.THORCHAIN_AFFILIATE_BPS);
    if (affiliate && Number.isInteger(bps) && bps > 0 && bps <= 100) {
      qs.set('affiliate', affiliate);
      qs.set('affiliate_bps', String(bps));
    }

    const q = await thorGet<ThorQuote>(`/thorchain/quote/swap?${qs}`);
    if (q.error) throw new ExchangeError(q.error, 'provider_unavailable', 502);
    if (!q.expected_amount_out) {
      throw new ExchangeError('THORChain returned no output amount', 'provider_unavailable', 502);
    }
    return q;
  }

  async quote(req: ExchangeQuoteRequest): Promise<ExchangeQuote> {
    const q = await this.rawQuote(req);
    const fromUnits = (v?: string) => (v ? fromBaseUnits(v, THOR_DECIMALS) : undefined);
    const minIn = fromUnits(q.recommended_min_amount_in);
    const warnings: string[] = [];
    if (minIn && toBaseUnits(req.amount, THOR_DECIMALS) < BigInt(q.recommended_min_amount_in!)) {
      warnings.push(`Below THORChain's recommended minimum of ${minIn} ${req.from}; fees may consume the swap.`);
    }

    return {
      provider: this.id,
      from: req.from,
      to: req.to,
      amountIn: req.amount,
      expectedAmountOut: fromBaseUnits(q.expected_amount_out!, THOR_DECIMALS),
      fees: {
        network: fromUnits(q.fees?.outbound),
        liquidity: fromUnits(q.fees?.liquidity),
        affiliate: fromUnits(q.fees?.affiliate),
        total: fromUnits(q.fees?.total),
        totalBps: q.fees?.total_bps,
      },
      minAmountIn: minIn,
      expiresAt: q.expiry ? q.expiry * 1000 : null,
      etaSeconds: q.total_swap_seconds ?? null,
      verification: 'none',
      warnings,
      route: {
        fromAsset: thorAsset(req.from),
        toAsset: thorAsset(req.to),
        // memo/inbound are only bound once a destination is given; the order
        // step always re-quotes, so these are informational here.
        inboundAddress: q.inbound_address ?? null,
        router: q.router ?? null,
      },
    };
  }

  async createOrder(
    _accepted: ExchangeQuote,
    req: ExchangeQuoteRequest & { destinationAddress: string }
  ): Promise<ProviderOrder> {
    const q = await this.rawQuote(req);
    if (!q.inbound_address || !q.memo) {
      throw new ExchangeError('THORChain quote had no inbound address or memo', 'provider_unavailable', 502);
    }

    // The quote's inbound address must be the chain's current, un-halted vault.
    const chain = thorChainOf(thorAsset(req.from));
    const inbounds = await thorGet<ThorInbound[]>('/thorchain/inbound_addresses');
    const vault = inbounds.find((i) => i.chain === chain);
    if (!vault || vault.halted || vault.global_trading_paused || vault.chain_trading_paused) {
      throw new ExchangeError(`THORChain ${chain} inbound is halted`, 'provider_unavailable', 503);
    }
    if (vault.address.toLowerCase() !== q.inbound_address.toLowerCase()) {
      throw new ExchangeError('THORChain vault rotated during quoting; retry', 'provider_unavailable', 503);
    }
    if (q.router && vault.router && q.router.toLowerCase() !== vault.router.toLowerCase()) {
      throw new ExchangeError('THORChain router mismatch; retry', 'provider_unavailable', 503);
    }

    return {
      providerOrderId: null, // THORChain identifies the swap by the inbound tx hash
      plan: {
        kind: 'send_with_memo',
        chain: req.from,
        to: q.inbound_address,
        amount: req.amount,
        memo: q.memo,
        router: q.router ?? undefined,
        expiresAt: q.expiry ? q.expiry * 1000 : null,
      },
      details: {
        memo: q.memo,
        inboundAddress: q.inbound_address,
        router: q.router ?? null,
        expectedAmountOut: fromBaseUnits(q.expected_amount_out!, THOR_DECIMALS),
        dustThreshold: q.dust_threshold ?? null,
        notes: q.notes ?? null,
      },
    };
  }

  async getStatus(ref: OrderRef): Promise<ProviderStatusUpdate | null> {
    if (!ref.inTxHash) return null;
    const hash = ref.inTxHash.replace(/^0x/i, '').toUpperCase();
    if (!/^[0-9A-F]{64}$/.test(hash)) return null;

    let s: {
      tx?: { id?: string };
      stages?: {
        inbound_observed?: { completed?: boolean };
        swap_finalised?: { completed?: boolean };
        outbound_signed?: { completed?: boolean };
      };
      out_txs?: Array<{ id?: string; coins?: Array<{ asset: string; amount: string }>; memo?: string }>;
    };
    try {
      s = await thorGet(`/thorchain/tx/status/${hash}`);
    } catch (e) {
      // THORNode 404s a tx it has not observed yet: that is "still pending".
      if (e instanceof ExchangeError && /not found|unknown/i.test(e.message)) {
        return { status: 'submitted', providerStatus: 'not_observed' };
      }
      throw e;
    }

    const st = s.stages ?? {};
    const out = s.out_txs?.[0];
    const refunded = !!out?.memo?.toUpperCase().startsWith('REFUND');
    if (st.outbound_signed?.completed && out?.id) {
      const coin = out.coins?.[0];
      return {
        status: refunded ? 'refunded' : 'completed',
        providerStatus: refunded ? 'refunded' : 'outbound_signed',
        outTxHash: out.id,
        amountOut: coin ? fromBaseUnits(coin.amount, THOR_DECIMALS) : undefined,
      };
    }
    if (refunded) return { status: 'refund_pending', providerStatus: 'refund_scheduled' };
    if (st.inbound_observed?.completed) {
      return { status: 'pending', providerStatus: st.swap_finalised?.completed ? 'swap_finalised' : 'inbound_observed' };
    }
    return { status: 'submitted', providerStatus: 'not_observed' };
  }
}
