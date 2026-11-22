/**
 * ChangeNOW adapter: wraps the existing src/lib/swap/changenow client.
 *
 * ChangeNOW is custodial for the few minutes of a swap (the user sends to its
 * deposit address) and its AML/KYC policy is risk-based: it may hold a swap
 * and ask for verification. Quotes from it are marked
 * verification: 'provider_may_require' so the UI says so before the user sends.
 */

import { getAsset } from '../assets';
import {
  ExchangeError,
  type ExchangeAdapter,
  type ExchangeAsset,
  type ExchangeOrderStatus,
  type ExchangeQuote,
  type ExchangeQuoteRequest,
  type OrderRef,
  type ProviderOrder,
  type ProviderStatusUpdate,
} from '../types';
import { createSwap, getChangeNowClient, getSwapQuote, isSwapSupported } from '@/lib/swap/changenow';

// ChangeNOW estimates carry no expiry; treat them as good for 10 minutes and
// re-quote at order time anyway (createSwap uses a floating rate).
const QUOTE_TTL_MS = 10 * 60 * 1000;

/** Raw ChangeNOW v2 status words. */
const CN_STATUS_MAP: Record<string, ExchangeOrderStatus> = {
  new: 'awaiting_user_action',
  waiting: 'awaiting_user_action',
  confirming: 'pending',
  exchanging: 'pending',
  sending: 'pending',
  verifying: 'manual_review',
  finished: 'completed',
  failed: 'failed',
  refunded: 'refunded',
  expired: 'expired',
};

export class ChangeNowAdapter implements ExchangeAdapter {
  readonly id = 'changenow' as const;
  readonly label = 'ChangeNOW';

  isConfigured(): boolean {
    return !!process.env.CHANGENOW_API_KEY;
  }

  supports(from: ExchangeAsset, to: ExchangeAsset): boolean {
    return from !== to && isSwapSupported(from) && isSwapSupported(to) && !!getAsset(from) && !!getAsset(to);
  }

  async quote(req: ExchangeQuoteRequest): Promise<ExchangeQuote> {
    if (!this.supports(req.from, req.to)) {
      throw new ExchangeError(`ChangeNOW does not support ${req.from}->${req.to}`, 'unsupported');
    }
    let q;
    try {
      q = await getSwapQuote({ from: req.from, to: req.to, amount: req.amount });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ExchangeError(msg, /min|small|less/i.test(msg) ? 'below_minimum' : 'provider_unavailable', 502);
    }
    const warnings = ['ChangeNOW may pause a swap and request verification under its AML/KYC policy.'];
    if (q.minAmount && Number(req.amount) < q.minAmount) {
      warnings.unshift(`Below ChangeNOW's minimum of ${q.minAmount} ${req.from}.`);
    }
    return {
      provider: this.id,
      from: req.from,
      to: req.to,
      amountIn: req.amount,
      expectedAmountOut: q.settleAmount,
      fees: {}, // ChangeNOW folds its fee into the rate
      minAmountIn: q.minAmount ? String(q.minAmount) : undefined,
      expiresAt: Date.now() + QUOTE_TTL_MS,
      etaSeconds: null,
      verification: 'provider_may_require',
      warnings,
      route: { rate: q.rate, flow: 'standard' },
    };
  }

  async createOrder(
    _accepted: ExchangeQuote,
    req: ExchangeQuoteRequest & { destinationAddress: string }
  ): Promise<ProviderOrder> {
    const swap = await createSwap({
      quoteId: '',
      from: req.from,
      to: req.to,
      amount: req.amount,
      settleAddress: req.destinationAddress,
      refundAddress: req.refundAddress,
    });
    if (!swap.depositAddress) {
      throw new ExchangeError('ChangeNOW returned no deposit address', 'provider_unavailable', 502);
    }
    return {
      providerOrderId: swap.id,
      plan: {
        kind: 'send',
        chain: req.from,
        to: swap.depositAddress,
        amount: req.amount,
        expiresAt: null,
      },
      details: { depositAddress: swap.depositAddress, expectedAmountOut: swap.settleAmount },
    };
  }

  async getStatus(ref: OrderRef): Promise<ProviderStatusUpdate | null> {
    if (!ref.providerOrderId) return null;
    const tx = await getChangeNowClient().getTransaction(ref.providerOrderId);
    const word = String(tx.status);
    const status = CN_STATUS_MAP[word] ?? 'manual_review';
    if (status === 'completed') {
      // "finished" with no payout hash is a claim, not evidence: park it.
      if (!tx.payoutHash) return { status: 'manual_review', providerStatus: `${word}:no_payout_hash` };
      const out = tx.actualReceiveAmount ?? tx.amountTo;
      return { status, providerStatus: word, outTxHash: tx.payoutHash, amountOut: out != null ? String(out) : undefined };
    }
    return { status, providerStatus: word };
  }
}
