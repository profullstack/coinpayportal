'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

// Recharts is heavy and client-only; keep it out of the initial bundle, same
// as the merchant dashboard does.
const DashboardCharts = dynamic(() => import('@/components/dashboard/DashboardCharts'), {
  ssr: false,
  loading: () => (
    <div className="mb-8 h-64 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
      Loading charts…
    </div>
  ),
});

type SeriesPoint = {
  label: string;
  crypto_volume_usd: number;
  card_volume_usd: number;
  total_volume_usd: number;
  crypto_count: number;
  card_count: number;
  total_count: number;
  crypto_commission_usd: number;
  card_commission_usd: number;
  total_commission_usd: number;
};

type CommissionSummary = {
  cryptoAccruedUsd: number;
  cryptoCollectedUsd: number;
  cryptoSweepCount: number;
  cardCommissionUsd: number;
  cardZeroFeeCount: number;
  cardZeroFeeVolumeUsd: number;
  cardCompletedCount: number;
  invoiceFeesUsd: number;
  escrowCollectedUsd: number;
  totalCollectedUsd: number;
};

type PlatformStats = {
  windowDays: number;
  generatedAt: string;
  series: { granularity: string; points: SeriesPoint[] };
  methodSplit: { cryptoVolume: number; cardVolume: number };
  statusBreakdown: { succeeded: number; failed: number; pending: number };
  commission: CommissionSummary;
};

const POLL_MS = 15_000;
const WINDOWS = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 365, label: '1y' },
];

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function usd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function count(value: number): string {
  return value.toLocaleString('en-US');
}

function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'warn' | 'good';
}) {
  const valueTone =
    tone === 'warn'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'good'
        ? 'text-green-600 dark:text-green-400'
        : 'text-gray-900 dark:text-white';
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${valueTone}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</div>}
    </div>
  );
}

export default function StatsContent() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<PlatformStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(
    async (showSpinner: boolean) => {
      const seq = ++requestSeq.current;
      if (showSpinner) setLoading(true);
      try {
        const res = await fetch(`/api/admin/stats?days=${days}`, {
          headers: authHeaders(),
          cache: 'no-store',
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        const json = (await res.json()) as PlatformStats;
        if (seq !== requestSeq.current) return;
        setData(json);
        setError(null);
        setLastUpdated(new Date().toLocaleTimeString('en-US', { hour12: false }));
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load stats');
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [days]
  );

  useEffect(() => {
    load(true);
  }, [load]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load(false);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [live, load]);

  const c = data?.commission;
  // What the fee columns claim was earned on crypto vs what has an on-chain
  // sweep behind it. The gap is the number worth staring at.
  //
  // Clamped at zero: the two figures come from different tables
  // (`payments.fee_amount` vs `payment_addresses.commission_amount`) and can
  // disagree in either direction — some swept addresses belong to payments
  // whose fee_amount was never written. A negative "unswept" reads as a bug.
  const cryptoGap = c ? Math.max(0, Number((c.cryptoAccruedUsd - c.cryptoCollectedUsd).toFixed(2))) : 0;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Platform stats</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Every business, every rail. Charts follow the selected window; commission is lifetime.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/logs"
              className="rounded bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200"
            >
              Event log →
            </Link>
            <button
              type="button"
              onClick={() => setLive((v) => !v)}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                live
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
              }`}
              aria-pressed={live}
            >
              <span
                className={`inline-block w-2 h-2 rounded-full mr-2 ${live ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}
              />
              {live ? 'Live' : 'Paused'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => setDays(w.days)}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                days === w.days
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700'
              }`}
            >
              {w.label}
            </button>
          ))}
          <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
            {lastUpdated ? `Updated ${lastUpdated}` : 'Loading…'}
            {live ? ` · every ${POLL_MS / 1000}s` : ''}
          </span>
        </div>

        {error && (
          <div className="mb-4 rounded bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {loading && !data && (
          <div className="text-sm text-gray-500 dark:text-gray-400">Loading platform stats…</div>
        )}

        {c && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <StatCard
                label="Commission collected (lifetime)"
                value={usd(c.totalCollectedUsd)}
                hint="Only fees with a transaction behind them"
                tone="good"
              />
              <StatCard
                label="Card commission"
                value={usd(c.cardCommissionUsd)}
                hint={`${count(c.cardCompletedCount)} completed charges`}
              />
              <StatCard
                label="Invoice fees"
                value={usd(c.invoiceFeesUsd)}
                hint="Paid USD invoices"
              />
              <StatCard
                label="Escrow fees"
                value={usd(c.escrowCollectedUsd)}
                hint="Settled escrows with a fee tx"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              <StatCard
                label="Crypto commission swept"
                value={usd(c.cryptoCollectedUsd)}
                hint={`${count(c.cryptoSweepCount)} on-chain sweeps`}
              />
              <StatCard
                label="Crypto commission unswept"
                value={usd(cryptoGap)}
                hint="Recorded against settled payments but never swept"
                tone={cryptoGap > 1 ? 'warn' : 'default'}
              />
              <StatCard
                label="Charges with no platform fee"
                value={count(c.cardZeroFeeCount)}
                hint={`${usd(c.cardZeroFeeVolumeUsd)} of completed volume charged $0 commission`}
                tone={c.cardZeroFeeCount > 0 ? 'warn' : 'default'}
              />
            </div>
          </>
        )}

        {data && (
          <DashboardCharts
            series={data.series as any}
            methodSplit={data.methodSplit}
            statusBreakdown={data.statusBreakdown}
          />
        )}
      </div>
    </div>
  );
}
