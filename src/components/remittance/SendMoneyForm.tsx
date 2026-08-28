'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Send-money quoting form.
 *
 * Shows what actually lands in the recipient's account, next to what the same
 * transfer costs through a traditional operator. The comparison is the point:
 * a remittance is normally sold on its fee, and the fee is the smaller half of
 * the cost.
 *
 * Sending is not wired up yet — the module quotes but cannot move money. The
 * form says so plainly rather than presenting a button that would lie.
 */

/**
 * Published corridor costs, for the comparison strip.
 *
 * Canada is deliberately not in the same league as the rest. Wise moves
 * USD→CAD for well under 1%, so quoting a 4.5%-style incumbent there would be
 * inventing a win. `mature` marks the corridors where the honest claim is speed
 * rather than price.
 */
const INCUMBENT_COST_PCT: Record<string, { pct: number; note: string; mature?: boolean }> = {
  MX: { pct: 4.5, note: 'Typical US→Mexico transfer' },
  PH: { pct: 6.0, note: 'Typical US→Philippines transfer' },
  NG: { pct: 5.5, note: 'Typical US→Nigeria transfer' },
  VN: { pct: 5.0, note: 'Typical US→Vietnam transfer' },
  CA: { pct: 0.75, note: 'Wise US→Canada, typical', mature: true },
};

const COUNTRY_NAME: Record<string, string> = {
  MX: 'Mexico',
  PH: 'Philippines',
  NG: 'Nigeria',
  VN: 'Vietnam',
  CA: 'Canada',
};

const METHOD_LABEL: Record<string, string> = {
  bank: 'Bank transfer',
  ewallet: 'Mobile wallet',
  cash_pickup: 'Cash pickup',
  debit_card: 'Debit card',
};

interface CorridorInfo {
  corridor: string;
  destinationCountry: string;
  payoutCurrency: string;
  methods: string[];
  networks: Record<string, string[] | undefined>;
  available: boolean;
  partners: string[];
}

interface QuoteFees {
  provider: number;
  network: number;
  payout: number;
  total: number;
}

interface Quote {
  provider: string;
  providerLabel: string;
  payoutCurrency: string;
  payoutMethod: string;
  payoutNetwork: string | null;
  receiveAmount: number;
  fees: QuoteFees;
  quotedFxRate: number | null;
  etaSeconds: number | null;
  allInCostPct: number | null;
  fxMarginPct: number | null;
  midMarketReceiveAmount: number | null;
  warnings: string[];
}

interface QuoteResponse {
  success?: boolean;
  error?: string;
  detail?: string;
  corridor?: string;
  payoutCurrency?: string;
  sendValueUsd?: number | null;
  midMarketFxRate?: number | null;
  best?: Quote | null;
  quotes?: Quote[];
  unavailable?: Array<{ source: string; reason: string }>;
}

function formatLocal(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: amount >= 1000 ? 0 : 2,
    }).format(amount);
  } catch {
    // Intl rejects an unknown currency code rather than degrading.
    return `${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`;
  }
}

function formatEta(seconds: number | null): string {
  if (seconds === null) return 'Not stated';
  if (seconds < 120) return 'Seconds';
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86_400)} days`;
}

export function SendMoneyForm() {
  const [corridors, setCorridors] = useState<CorridorInfo[]>([]);
  const [country, setCountry] = useState('MX');
  const [amount, setAmount] = useState('500');
  const [asset, setAsset] = useState('USDC');
  const [method, setMethod] = useState<string>('');
  const [network, setNetwork] = useState<string>('');

  const [result, setResult] = useState<QuoteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingCorridors, setLoadingCorridors] = useState(true);

  // Guards against an older in-flight quote landing after a newer one and
  // overwriting it — easy to hit when typing an amount.
  const requestSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/remittance/corridors')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setCorridors(data.corridors ?? []);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load destinations.');
      })
      .finally(() => {
        if (!cancelled) setLoadingCorridors(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selected = corridors.find((c) => c.destinationCountry === country);

  // Reset the rail pickers whenever the destination changes: a Philippine
  // e-wallet is not a valid choice for Mexico.
  useEffect(() => {
    setMethod('');
    setNetwork('');
  }, [country]);

  const fetchQuote = useCallback(async () => {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setResult(null);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ asset, amount: String(numeric), to: country });
      if (method) params.set('method', method);
      if (network) params.set('network', network);

      const response = await fetch(`/api/remittance/quote?${params}`);
      const data: QuoteResponse = await response.json();

      if (seq !== requestSeq.current) return;

      if (!response.ok || !data.success) {
        setResult(null);
        setError(data.detail || data.error || 'Could not get a quote.');
        return;
      }

      setResult(data);
    } catch {
      if (seq === requestSeq.current) {
        setResult(null);
        setError('Could not reach the quote service.');
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [amount, asset, country, method, network]);

  // Debounced so typing an amount does not fire a request per keystroke; each
  // one fans out across every partner on the corridor.
  useEffect(() => {
    const timer = setTimeout(fetchQuote, 400);
    return () => clearTimeout(timer);
  }, [fetchQuote]);

  const best = result?.best ?? null;
  const incumbent = INCUMBENT_COST_PCT[country];

  // The fee we actually charge, as a share of what was sent.
  const feePct =
    best && result?.sendValueUsd ? (best.fees.total / result.sendValueUsd) * 100 : null;

  /**
   * The cost we quote.
   *
   * `allInCostPct` measures the payout against an external FX reference, and a
   * partner trading on a real venue can legitimately beat that reference — the
   * two are different markets. When that happens the all-in figure dips below
   * the fee we charged, which would have us advertising a cost lower than our
   * own fee. So the headline never goes below the fee: on a product sold on
   * honest pricing, the number that flatters us is the wrong one to show.
   */
  const headlineCostPct =
    feePct !== null && best?.allInCostPct != null
      ? Math.max(feePct, best.allInCostPct)
      : (best?.allInCostPct ?? feePct);

  const savingsPct =
    headlineCostPct != null && incumbent ? incumbent.pct - headlineCostPct : null;

  /** A negative margin is our reference disagreeing with the venue, not a discount. */
  const rateBeatsReference = best?.fxMarginPct != null && best.fxMarginPct < 0;

  return (
    <div className="space-y-6">
      {/* Destination */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <label className="block text-sm font-medium text-gray-300 mb-3">Where is it going?</label>

        {loadingCorridors ? (
          <p className="text-sm text-gray-500">Loading destinations…</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {corridors.map((c) => (
              <button
                key={c.corridor}
                type="button"
                onClick={() => setCountry(c.destinationCountry)}
                className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                  country === c.destinationCountry
                    ? 'border-purple-500 bg-purple-500/15'
                    : 'border-white/10 bg-black/20 hover:border-white/30'
                }`}
              >
                <div className="text-sm font-semibold text-white">
                  {COUNTRY_NAME[c.destinationCountry] ?? c.destinationCountry}
                </div>
                <div className="text-xs text-gray-400">{c.payoutCurrency}</div>
                {!c.available && (
                  <div className="mt-1 text-[11px] text-amber-400">No partner yet</div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Amount and asset */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
        <div>
          <label htmlFor="amount" className="block text-sm font-medium text-gray-300 mb-2">
            You send
          </label>
          <div className="flex gap-2">
            <input
              id="amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-lg text-white tabular-nums focus:border-purple-500 focus:outline-none"
            />
            <select
              aria-label="Stablecoin to send"
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-3 text-white focus:border-purple-500 focus:outline-none"
            >
              <option value="USDC">USDC</option>
              <option value="USDC_POL">USDC (Polygon)</option>
              <option value="USDC_SOL">USDC (Solana)</option>
              <option value="USDT">USDT</option>
              <option value="USDT_POL">USDT (Polygon)</option>
              <option value="USDT_SOL">USDT (Solana)</option>
            </select>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Funded from stablecoin you already hold. There is no bank account to connect.
          </p>
        </div>

        {selected && selected.methods.length > 1 && (
          <div>
            <label htmlFor="method" className="block text-sm font-medium text-gray-300 mb-2">
              How they collect it
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setMethod('');
                  setNetwork('');
                }}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  method === ''
                    ? 'border-purple-500 bg-purple-500/15 text-white'
                    : 'border-white/10 bg-black/20 text-gray-300 hover:border-white/30'
                }`}
              >
                Best available
              </button>
              {selected.methods.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMethod(m);
                    setNetwork('');
                  }}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    method === m
                      ? 'border-purple-500 bg-purple-500/15 text-white'
                      : 'border-white/10 bg-black/20 text-gray-300 hover:border-white/30'
                  }`}
                >
                  {METHOD_LABEL[m] ?? m}
                </button>
              ))}
            </div>

            {method && (selected.networks[method]?.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {selected.networks[method]!.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNetwork(network === n ? '' : n)}
                    className={`rounded-md border px-2.5 py-1 text-xs uppercase tracking-wide transition-colors ${
                      network === n
                        ? 'border-purple-500 bg-purple-500/15 text-white'
                        : 'border-white/10 bg-black/20 text-gray-400 hover:border-white/30'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Result */}
      {error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
          <p className="text-sm text-amber-200">{error}</p>
          {selected && !selected.available && (
            <p className="mt-2 text-xs text-amber-300/70">
              {COUNTRY_NAME[country]} has no payout partner configured yet.
            </p>
          )}
        </div>
      )}

      {best && (
        <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-6">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-gray-300">They receive</span>
            {loading && <span className="text-xs text-gray-500">updating…</span>}
          </div>

          <div className="mt-1 text-4xl font-bold text-white tabular-nums">
            {formatLocal(best.receiveAmount, best.payoutCurrency)}
          </div>

          <div className="mt-1 text-sm text-gray-400">
            via {best.providerLabel}
            {best.payoutNetwork ? ` · ${best.payoutNetwork.toUpperCase()}` : ''} ·{' '}
            {formatEta(best.etaSeconds)}
          </div>

          <div className="mt-5 space-y-2 border-t border-white/10 pt-4 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Rate</span>
              <span className="text-white tabular-nums">
                {best.quotedFxRate
                  ? `1 USD = ${best.quotedFxRate.toLocaleString('en-US', {
                      maximumFractionDigits: 4,
                    })} ${best.payoutCurrency}`
                  : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Fee</span>
              <span className="text-white tabular-nums">
                ${best.fees.total.toFixed(2)}
                {feePct !== null && (
                  <span className="text-gray-500"> ({feePct.toFixed(2)}%)</span>
                )}
              </span>
            </div>
            {best.fxMarginPct !== null && !rateBeatsReference && (
              <div className="flex justify-between">
                <span className="text-gray-400">Rate margin</span>
                <span className="text-white tabular-nums">{best.fxMarginPct.toFixed(2)}%</span>
              </div>
            )}
            {headlineCostPct != null && (
              <div className="flex justify-between font-semibold">
                <span className="text-gray-300">Total cost</span>
                <span className="text-green-400 tabular-nums">
                  {headlineCostPct.toFixed(2)}%
                </span>
              </div>
            )}
          </div>

          {rateBeatsReference && (
            <p className="mt-3 text-xs text-gray-500">
              {best.providerLabel}&apos;s rate is currently better than our reference rate by{' '}
              {Math.abs(best.fxMarginPct!).toFixed(2)}%. They are different markets, so we quote
              the fee as the cost rather than counting that difference as a discount.
            </p>
          )}

          {/* The comparison that is the whole argument */}
          {incumbent && headlineCostPct != null && (
            <div className="mt-5 rounded-lg bg-black/30 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">{incumbent.note}</span>
                <span className="text-gray-300 tabular-nums">≈ {incumbent.pct.toFixed(2)}%</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-gray-400">This transfer</span>
                <span
                  className={`tabular-nums ${
                    savingsPct !== null && savingsPct > 0 ? 'text-green-400' : 'text-gray-300'
                  }`}
                >
                  {headlineCostPct.toFixed(2)}%
                </span>
              </div>

              {/* On a mature corridor the honest claim is speed, not price. */}
              {incumbent.mature ? (
                <p className="mt-3 text-xs text-gray-500">
                  {COUNTRY_NAME[country]} is already well served — the established options are
                  cheap here, so this is about matching them on price and settling from
                  stablecoin in minutes, not about undercutting them.
                </p>
              ) : savingsPct !== null && savingsPct > 0 ? (
                <p className="mt-3 text-xs text-gray-500">
                  About {savingsPct.toFixed(1)} percentage points cheaper, or roughly $
                  {((savingsPct / 100) * (Number(amount) || 0)).toFixed(2)} more reaching them on
                  this transfer.
                </p>
              ) : (
                <p className="mt-3 text-xs text-gray-500">
                  This transfer is not cheaper than the usual route on this corridor.
                </p>
              )}
            </div>
          )}

          {best.warnings.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {best.warnings.map((w) => (
                <li key={w} className="text-xs text-amber-300/90">
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Every other quote, so the ranking is visible rather than asserted */}
      {result?.quotes && result.quotes.length > 1 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Other partners</h3>
          <div className="space-y-2">
            {result.quotes.slice(1).map((q, i) => (
              <div
                key={`${q.provider}-${q.payoutMethod}-${i}`}
                className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-sm"
              >
                <div>
                  <span className="text-gray-300">{q.providerLabel}</span>
                  <span className="ml-2 text-xs text-gray-500">
                    {METHOD_LABEL[q.payoutMethod] ?? q.payoutMethod}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-white tabular-nums">
                    {formatLocal(q.receiveAmount, q.payoutCurrency)}
                  </div>
                  {q.allInCostPct !== null && (
                    <div className="text-xs text-gray-500 tabular-nums">
                      {q.allInCostPct.toFixed(2)}% cost
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result?.unavailable && result.unavailable.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Not quoting right now</h3>
          <ul className="space-y-1">
            {result.unavailable.map((u) => (
              <li key={u.source} className="text-xs text-gray-500">
                <span className="text-gray-400">{u.source}</span> — {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Honest about what this cannot do yet */}
      <div className="rounded-xl border border-white/10 bg-black/20 p-5">
        <p className="text-sm text-gray-400">
          These are live quotes, but sending is not switched on yet. Actually paying someone needs
          the recipient&apos;s details and a payout agreement with the partner.
        </p>
      </div>
    </div>
  );
}
