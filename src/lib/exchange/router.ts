/**
 * Quote router: ask every eligible adapter in parallel, normalise, rank.
 *
 * Ranking is by expected amount delivered (exact decimal compare), not by any
 * disclosed fee: a provider that quotes "no fee" but a worse rate delivers
 * less, and that is the only number the user keeps. Ties prefer providers
 * that need no verification.
 */

import { compareDecimal } from './decimal';
import { evaluatePolicy } from './policy';
import { ChangeNowAdapter } from './providers/changenow';
import { ThorchainAdapter } from './providers/thorchain';
import {
  ExchangeError,
  type ExchangeAdapter,
  type ExchangeProviderId,
  type ExchangeQuote,
  type ExchangeQuoteRequest,
} from './types';

const PER_PROVIDER_TIMEOUT_MS = 10_000;

let registry: ExchangeAdapter[] | null = null;

export function getAdapters(): ExchangeAdapter[] {
  registry ??= [new ThorchainAdapter(), new ChangeNowAdapter()];
  return registry;
}

export function getAdapter(id: string): ExchangeAdapter | undefined {
  return getAdapters().find((a) => a.id === id);
}

/** Test seam. */
export function setAdapters(adapters: ExchangeAdapter[] | null): void {
  registry = adapters;
}

export interface QuoteFailure {
  provider: ExchangeProviderId;
  reason: string;
  code: string;
}

export interface RoutedQuotes {
  quotes: ExchangeQuote[];
  unavailable: QuoteFailure[];
  policyVersion: string;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new ExchangeError('Provider timed out', 'provider_unavailable', 504)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function routeQuotes(req: ExchangeQuoteRequest): Promise<RoutedQuotes> {
  const base = evaluatePolicy({ rail: 'crypto_crypto', from: req.from, to: req.to, country: req.country });
  if (!base.allow) throw new ExchangeError(`Exchange not available: ${base.reason}`, 'policy_denied', 403);

  const unavailable: QuoteFailure[] = [];
  const eligible: ExchangeAdapter[] = [];
  for (const a of getAdapters()) {
    if (!a.supports(req.from, req.to)) continue;
    const d = evaluatePolicy({ rail: 'crypto_crypto', from: req.from, to: req.to, country: req.country, provider: a.id });
    if (!d.allow) { unavailable.push({ provider: a.id, reason: d.reason, code: 'policy_denied' }); continue; }
    if (!a.isConfigured()) { unavailable.push({ provider: a.id, reason: 'not_configured', code: 'provider_unavailable' }); continue; }
    eligible.push(a);
  }

  if (eligible.length === 0 && unavailable.length === 0) {
    throw new ExchangeError(`No provider supports ${req.from} -> ${req.to}`, 'unsupported', 400);
  }

  const settled = await Promise.allSettled(eligible.map((a) => withTimeout(a.quote(req), PER_PROVIDER_TIMEOUT_MS)));
  const quotes: ExchangeQuote[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') quotes.push(r.value);
    else {
      const e = r.reason;
      unavailable.push({
        provider: eligible[i].id,
        reason: e instanceof Error ? e.message : String(e),
        code: e instanceof ExchangeError ? e.code : 'provider_unavailable',
      });
    }
  });

  quotes.sort((a, b) => {
    const byOut = compareDecimal(b.expectedAmountOut, a.expectedAmountOut);
    if (byOut !== 0) return byOut;
    if (a.verification !== b.verification) return a.verification === 'none' ? -1 : 1;
    return 0;
  });

  return { quotes, unavailable, policyVersion: base.version };
}
