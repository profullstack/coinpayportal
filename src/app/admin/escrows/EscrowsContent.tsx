'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

type SortKey =
  | 'created_at'
  | 'funded_at'
  | 'settled_at'
  | 'expires_at'
  | 'amount_usd'
  | 'chain'
  | 'status'
  | 'escrow_model'
  | 'business_name'
  | 'settle_attempts'
  | 'hours_to_fund'
  | 'hours_to_settle';

type EscrowRow = {
  id: string;
  chain: string;
  status: string;
  escrowModel: string;
  amount: string;
  amountUsd: number;
  depositedAmount: string | null;
  feeAmount: string | null;
  escrowAddress: string;
  depositorAddress: string;
  beneficiaryAddress: string;
  arbiterAddress: string | null;
  depositorEmail: string | null;
  beneficiaryEmail: string | null;
  depositTxHash: string | null;
  settlementTxHash: string | null;
  disputeStatus: string | null;
  disputeReason: string | null;
  inSeries: boolean;
  allowAutoRelease: boolean;
  settleAttempts: number;
  businessId: string | null;
  businessName: string | null;
  merchantEmail: string | null;
  createdAt: string;
  fundedAt: string | null;
  releasedAt: string | null;
  settledAt: string | null;
  disputedAt: string | null;
  refundedAt: string | null;
  expiresAt: string | null;
  hoursToFund: number | null;
  hoursToSettle: number | null;
  isHeld: boolean;
  isStranded: boolean;
};

type StatusBucket = { status: string; total: number; valueUsd: number };
type ChainBucket = { chain: string; total: number; settled: number; settledUsd: number; heldUsd: number };
type ModelBucket = { escrowModel: string; total: number; settled: number };
type MonthBucket = { month: string; created: number; funded: number; settled: number; settledUsd: number };

type Summary = {
  escrowsTotal: number;
  firstCreatedAt: string | null;
  lastCreatedAt: string | null;
  everFunded: number;
  everDisbursed: number;
  everReleased: number;
  everDisputed: number;
  statusSettled: number;
  statusRefunded: number;
  expired: number;
  heldCount: number;
  strandedCount: number;
  disputesOpen: number;
  inSeries: number;
  autoRelease: number;
  withBusiness: number;
  businesses: number;
  created30d: number;
  settled30d: number;
  createdValueUsd: number;
  fundedValueUsd: number;
  disbursedValueUsd: number;
  releasedValueUsd: number;
  refundedValueUsd: number;
  heldValueUsd: number;
  largestUsd: number;
  medianUsd: number;
  medianHoursToFund: number | null;
  medianHoursToSettle: number | null;
  byStatus: StatusBucket[];
  byChain: ChainBucket[];
  byModel: ModelBucket[];
  months: MonthBucket[];
};

const PAGE_SIZE = 50;

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = { ...(extra as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function usd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Compact form for the tiles, where a 12-digit figure would break the layout. */
function usdCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `$${value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 })}`;
  }
  return usd(value);
}

function count(value: number): string {
  return value.toLocaleString('en-US');
}

function pct(part: number, whole: number): string {
  if (!whole) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

/** Chain amounts are numeric(30,18); drop the trailing zeros but keep precision. */
function chainAmount(value: string | null): string {
  if (!value) return '—';
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

function shortDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Escrows settle in minutes or sit for months, so the unit has to adapt. */
function duration(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return '—';
  if (hours < 1 / 60) return '<1m';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours / 24)}d`;
}

const STATUS_STYLES: Record<string, string> = {
  settled: 'bg-green-500/10 text-green-300',
  released: 'bg-green-500/10 text-green-300',
  refunded: 'bg-amber-500/10 text-amber-300',
  disputed: 'bg-red-500/10 text-red-300',
  settle_failed: 'bg-red-500/10 text-red-300',
  expired: 'bg-slate-600/20 text-gray-400',
  funded: 'bg-blue-500/10 text-blue-300',
  pending: 'bg-blue-500/10 text-blue-300',
  created: 'bg-blue-500/10 text-blue-300',
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? 'bg-slate-600/20 text-gray-300';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${style}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

const COLUMNS: { key: SortKey; label: string; numeric: boolean; title?: string }[] = [
  { key: 'created_at', label: 'Escrow', numeric: false, title: 'Escrow id and chain, newest first' },
  { key: 'status', label: 'Status', numeric: false },
  { key: 'amount_usd', label: 'Amount', numeric: true, title: 'USD at creation, with the chain amount beneath' },
  { key: 'business_name', label: 'Business', numeric: false, title: 'Merchant the escrow belongs to, if any' },
  { key: 'funded_at', label: 'Funded', numeric: false },
  { key: 'hours_to_settle', label: 'To settle', numeric: true, title: 'Time from funding to the settlement transaction' },
  { key: 'expires_at', label: 'Expires', numeric: false },
];

const CSV_COLUMNS: { header: string; value: (e: EscrowRow) => string | number }[] = [
  { header: 'id', value: (e) => e.id },
  { header: 'chain', value: (e) => e.chain },
  { header: 'status', value: (e) => e.status },
  { header: 'escrow_model', value: (e) => e.escrowModel },
  { header: 'amount', value: (e) => e.amount },
  { header: 'amount_usd', value: (e) => e.amountUsd },
  { header: 'deposited_amount', value: (e) => e.depositedAmount ?? '' },
  { header: 'fee_amount', value: (e) => e.feeAmount ?? '' },
  { header: 'escrow_address', value: (e) => e.escrowAddress },
  { header: 'depositor_address', value: (e) => e.depositorAddress },
  { header: 'beneficiary_address', value: (e) => e.beneficiaryAddress },
  { header: 'arbiter_address', value: (e) => e.arbiterAddress ?? '' },
  { header: 'depositor_email', value: (e) => e.depositorEmail ?? '' },
  { header: 'beneficiary_email', value: (e) => e.beneficiaryEmail ?? '' },
  { header: 'deposit_tx_hash', value: (e) => e.depositTxHash ?? '' },
  { header: 'settlement_tx_hash', value: (e) => e.settlementTxHash ?? '' },
  { header: 'dispute_status', value: (e) => e.disputeStatus ?? '' },
  { header: 'in_series', value: (e) => String(e.inSeries) },
  { header: 'allow_auto_release', value: (e) => String(e.allowAutoRelease) },
  { header: 'settle_attempts', value: (e) => e.settleAttempts },
  { header: 'business_name', value: (e) => e.businessName ?? '' },
  { header: 'merchant_email', value: (e) => e.merchantEmail ?? '' },
  { header: 'created_at', value: (e) => e.createdAt },
  { header: 'funded_at', value: (e) => e.fundedAt ?? '' },
  { header: 'released_at', value: (e) => e.releasedAt ?? '' },
  { header: 'settled_at', value: (e) => e.settledAt ?? '' },
  { header: 'disputed_at', value: (e) => e.disputedAt ?? '' },
  { header: 'refunded_at', value: (e) => e.refundedAt ?? '' },
  { header: 'expires_at', value: (e) => e.expiresAt ?? '' },
  { header: 'held', value: (e) => String(e.isHeld) },
  { header: 'stranded', value: (e) => String(e.isStranded) },
];

export function toCsv(rows: EscrowRow[]): string {
  const escape = (v: string | number): string => {
    const raw = String(v);
    // Neutralise spreadsheet formulas — addresses and dispute text are attacker-supplied.
    const safe = typeof v === 'string' && /^[\u0000-\u0020]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [CSV_COLUMNS.map((c) => c.header).join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((c) => escape(c.value(row))).join(','));
  }
  return lines.join('\n');
}

function StatTile({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'warn';
  title?: string;
}) {
  const border = tone === 'warn' ? 'border-amber-500/40' : 'border-slate-700';
  return (
    <div className={`rounded-lg border ${border} bg-slate-900/50 p-4`} title={title}>
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

export default function EscrowsContent() {
  const [escrows, setEscrows] = useState<EscrowRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<SortKey>('created_at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [chain, setChain] = useState('');
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [authState, setAuthState] = useState<'unknown' | 'unauthenticated' | 'forbidden' | 'ok'>('unknown');
  const [error, setError] = useState<string | null>(null);

  // Debounce the search box so typing an address is one request, not thirty.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const queryString = useCallback(
    (over: Partial<{ limit: number; offset: number; summary: string }> = {}) => {
      const params = new URLSearchParams({
        sort,
        dir,
        limit: String(over.limit ?? PAGE_SIZE),
        offset: String(over.offset ?? offset),
      });
      if (search.trim()) params.set('search', search.trim());
      if (status) params.set('status', status);
      if (chain) params.set('chain', chain);
      if (model) params.set('model', model);
      if (over.summary) params.set('summary', over.summary);
      return params.toString();
    },
    [sort, dir, offset, search, status, chain, model],
  );

  // A slow request for an earlier filter must not overwrite a newer one.
  const requestId = useRef(0);

  const fetchEscrows = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/escrows?${queryString()}`, { headers: authHeaders() });
      if (id !== requestId.current) return;
      if (res.status === 401) {
        setAuthState('unauthenticated');
        return;
      }
      if (res.status === 403) {
        setAuthState('forbidden');
        return;
      }
      if (!res.ok) {
        setError('Failed to load escrows');
        return;
      }
      const data = await res.json();
      if (id !== requestId.current) return;
      setEscrows(data.escrows ?? []);
      setTotal(data.total ?? 0);
      if (data.summary) setSummary(data.summary);
      setAuthState('ok');
    } catch {
      if (id === requestId.current) setError('Network error');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void fetchEscrows();
  }, [fetchEscrows]);

  const toggleSort = (key: SortKey) => {
    if (key === sort) {
      setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSort(key);
      // Names and statuses read best A-Z; dates and amounts read best newest/biggest first.
      setDir(key === 'business_name' || key === 'status' || key === 'chain' ? 'asc' : 'desc');
    }
    setOffset(0);
  };

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      // Exports everything matching the current filters, not just this page —
      // 500 is the server's ceiling.
      const res = await fetch(`/api/admin/escrows?${queryString({ limit: 500, offset: 0, summary: '0' })}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        setError('Export failed');
        return;
      }
      const data = await res.json();
      const rows: EscrowRow[] = data.escrows ?? [];
      const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `coinpay-escrows-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (data.total > rows.length) {
        setError(`Exported the first ${rows.length} of ${data.total} escrows — narrow the filters for the rest.`);
      }
    } catch {
      setError('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const resetFilters = () => {
    setStatus('');
    setChain('');
    setModel('');
    setSearchInput('');
    setOffset(0);
  };

  const filtered = Boolean(search.trim() || status || chain || model);
  const pageEnd = useMemo(() => Math.min(offset + escrows.length, total), [offset, escrows.length, total]);

  if (authState === 'unauthenticated') {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <p className="text-gray-300 mb-4">You need to log in.</p>
        <Link href="/login" className="text-purple-400 hover:underline">Log in →</Link>
      </div>
    );
  }

  if (authState === 'forbidden') {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <p className="text-red-400 mb-2">403 — Forbidden</p>
        <p className="text-gray-400 mb-4">This area is restricted to administrators.</p>
        <Link href="/dashboard" className="text-purple-400 hover:underline">Back to dashboard →</Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mb-2 flex items-baseline gap-3">
        <Link href="/admin" className="text-sm text-gray-400 hover:text-purple-300">← Admin</Link>
      </div>
      <h1 className="text-3xl font-bold text-white mb-2">Escrows</h1>
      <p className="text-gray-400 mb-8">
        Every escrow ever created, where each one stopped in the lifecycle, and how much is in platform custody right
        now.
        {summary?.firstCreatedAt && (
          <> All time, from {shortDate(summary.firstCreatedAt)} to {shortDate(summary.lastCreatedAt)}.</>
        )}
      </p>

      {summary && (
        <>
          <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <StatTile
              label="Held now"
              value={usdCompact(summary.heldValueUsd)}
              sub={
                summary.strandedCount > 0
                  ? `${count(summary.heldCount)} escrows · ${count(summary.strandedCount)} past expiry`
                  : `${count(summary.heldCount)} escrows in custody`
              }
              tone={summary.strandedCount > 0 ? 'warn' : 'default'}
              title="Funded, and neither settled nor refunded — the money the platform is still holding"
            />
            <StatTile
              label="Released"
              value={usdCompact(summary.releasedValueUsd)}
              sub={`${count(summary.statusSettled)} to beneficiaries`}
              title="Escrows with status 'settled' — funds reached the beneficiary"
            />
            <StatTile
              label="Refunded"
              value={usdCompact(summary.refundedValueUsd)}
              sub={`${count(summary.statusRefunded)} back to depositors`}
            />
            <StatTile
              label="Disbursed"
              value={usdCompact(summary.disbursedValueUsd)}
              sub="released + refunded"
              title="Every escrow that sent a settlement transaction, in either direction"
            />
            <StatTile
              label="Escrows"
              value={count(summary.escrowsTotal)}
              sub={`${count(summary.created30d)} in the last 30d`}
            />
            <StatTile
              label="Funded"
              value={`${count(summary.everFunded)} / ${count(summary.escrowsTotal)}`}
              sub={`${pct(summary.everFunded, summary.escrowsTotal)} of escrows ever funded`}
            />
          </section>

          <section className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <StatTile
              label="Quoted"
              value={usdCompact(summary.createdValueUsd)}
              sub="incl. never funded"
              title="Total value quoted at creation. Most escrows expire unfunded, so this is demand, not money moved — never add it to the disbursed figure."
            />
            <StatTile label="Median escrow" value={usdCompact(summary.medianUsd)} sub={`largest ${usdCompact(summary.largestUsd)}`} />
            <StatTile label="Time to fund" value={duration(summary.medianHoursToFund)} sub="median, create → fund" />
            <StatTile label="Time to settle" value={duration(summary.medianHoursToSettle)} sub="median, fund → settle" />
            <StatTile
              label="Disputes"
              value={count(summary.everDisputed)}
              sub={summary.disputesOpen > 0 ? `${count(summary.disputesOpen)} open` : 'none open'}
              tone={summary.disputesOpen > 0 ? 'warn' : 'default'}
            />
            <StatTile
              label="Merchant-linked"
              value={`${count(summary.withBusiness)} / ${count(summary.escrowsTotal)}`}
              sub={`${count(summary.businesses)} businesses · ${count(summary.inSeries)} in a series`}
            />
          </section>

          <div className="mb-8 grid gap-4 lg:grid-cols-3">
            <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
              <h2 className="mb-3 text-xs uppercase tracking-wide text-gray-400">By status</h2>
              <table className="w-full text-sm">
                <tbody>
                  {summary.byStatus.map((s) => (
                    <tr key={s.status} className="border-b border-slate-800 last:border-0">
                      <td className="py-1.5">
                        <button onClick={() => { setStatus(s.status); setOffset(0); }} className="hover:opacity-80">
                          <StatusBadge status={s.status} />
                        </button>
                      </td>
                      <td className="py-1.5 text-right text-gray-300">{count(s.total)}</td>
                      <td className="py-1.5 text-right text-gray-500">{usdCompact(s.valueUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
              <h2 className="mb-3 text-xs uppercase tracking-wide text-gray-400">By chain</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-gray-500">
                    <th className="pb-1 text-left font-medium">Chain</th>
                    <th className="pb-1 text-right font-medium">All</th>
                    <th className="pb-1 text-right font-medium">Settled</th>
                    <th className="pb-1 text-right font-medium">Held</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byChain.map((c) => (
                    <tr key={c.chain} className="border-b border-slate-800 last:border-0">
                      <td className="py-1.5">
                        <button
                          onClick={() => { setChain(c.chain); setOffset(0); }}
                          className="text-gray-300 hover:text-purple-300"
                        >
                          {c.chain}
                        </button>
                      </td>
                      <td className="py-1.5 text-right text-gray-300">{count(c.total)}</td>
                      <td className="py-1.5 text-right text-gray-500">{usdCompact(c.settledUsd)}</td>
                      <td className="py-1.5 text-right text-gray-500">{c.heldUsd ? usdCompact(c.heldUsd) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
              <h2 className="mb-3 text-xs uppercase tracking-wide text-gray-400">Monthly history</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-gray-500">
                    <th className="pb-1 text-left font-medium">Month</th>
                    <th className="pb-1 text-right font-medium">Created</th>
                    <th className="pb-1 text-right font-medium">Funded</th>
                    <th className="pb-1 text-right font-medium">Settled</th>
                    <th className="pb-1 text-right font-medium">USD</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.months.map((m) => (
                    <tr key={m.month} className="border-b border-slate-800 last:border-0">
                      <td className="py-1.5 text-gray-300">{m.month}</td>
                      <td className="py-1.5 text-right text-gray-300">{m.created || '—'}</td>
                      <td className="py-1.5 text-right text-gray-500">{m.funded || '—'}</td>
                      <td className="py-1.5 text-right text-gray-500">{m.settled || '—'}</td>
                      <td className="py-1.5 text-right text-gray-500">
                        {m.settledUsd ? usdCompact(m.settledUsd) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}

      {error && (
        <div className="mb-4 rounded border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search id, address, email, tx hash or business…"
          className="min-w-[18rem] flex-1 rounded bg-slate-950 px-3 py-2 text-sm text-white border border-slate-700 focus:border-purple-500 focus:outline-none"
        />
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setOffset(0); }}
          className="rounded bg-slate-950 px-3 py-2 text-sm text-white border border-slate-700 focus:border-purple-500 focus:outline-none"
        >
          <option value="">All statuses</option>
          {summary?.byStatus.map((s) => (
            <option key={s.status} value={s.status}>{s.status} ({s.total})</option>
          ))}
        </select>
        <select
          value={chain}
          onChange={(e) => { setChain(e.target.value); setOffset(0); }}
          className="rounded bg-slate-950 px-3 py-2 text-sm text-white border border-slate-700 focus:border-purple-500 focus:outline-none"
        >
          <option value="">All chains</option>
          {summary?.byChain.map((c) => (
            <option key={c.chain} value={c.chain}>{c.chain} ({c.total})</option>
          ))}
        </select>
        {summary && summary.byModel.length > 1 && (
          <select
            value={model}
            onChange={(e) => { setModel(e.target.value); setOffset(0); }}
            className="rounded bg-slate-950 px-3 py-2 text-sm text-white border border-slate-700 focus:border-purple-500 focus:outline-none"
          >
            <option value="">All models</option>
            {summary.byModel.map((m) => (
              <option key={m.escrowModel} value={m.escrowModel}>{m.escrowModel} ({m.total})</option>
            ))}
          </select>
        )}
        {filtered && (
          <button onClick={resetFilters} className="text-sm text-gray-400 hover:text-purple-300">
            Clear
          </button>
        )}
        <button
          onClick={handleExport}
          disabled={exporting}
          className="rounded bg-purple-600/20 px-4 py-2 text-sm text-purple-300 hover:bg-purple-600/30 border border-purple-500/20 disabled:opacity-50"
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
        <button
          onClick={() => void fetchEscrows()}
          disabled={loading}
          className="text-sm text-gray-400 hover:text-purple-300 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-900/50">
        <table className="w-full min-w-[60rem] text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-xs uppercase tracking-wide text-gray-400">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  title={col.title}
                  className={`px-3 py-3 font-medium ${col.numeric ? 'text-right' : 'text-left'}`}
                >
                  <button
                    onClick={() => toggleSort(col.key)}
                    className={`hover:text-purple-300 ${sort === col.key ? 'text-purple-300' : ''}`}
                  >
                    {col.label}
                    {sort === col.key && <span className="ml-1">{dir === 'desc' ? '↓' : '↑'}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {escrows.length === 0 && !loading && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-gray-400">
                  {filtered ? 'No escrows match these filters.' : 'No escrows yet.'}
                </td>
              </tr>
            )}
            {escrows.map((e) => {
              const isOpen = expanded === e.id;
              return (
                <tr
                  key={e.id}
                  onClick={() => setExpanded(isOpen ? null : e.id)}
                  className="cursor-pointer border-b border-slate-800 last:border-0 hover:bg-slate-800/40"
                >
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-white">{e.id.slice(0, 8)}</span>
                      <span className="rounded bg-slate-700/40 px-1.5 py-0.5 text-[10px] text-gray-300">{e.chain}</span>
                      {e.escrowModel !== 'custodial' && (
                        <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] uppercase text-purple-300">
                          {e.escrowModel}
                        </span>
                      )}
                      {e.isStranded && (
                        <span
                          className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase text-amber-300"
                          title="Funded, unsettled and past its expiry"
                        >
                          stranded
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400">{shortDate(e.createdAt)}</div>
                    {isOpen && (
                      <div className="mt-2 space-y-0.5 text-xs text-gray-400">
                        <div className="font-mono text-[10px] text-gray-600">{e.id}</div>
                        <div>Escrow address: <span className="font-mono">{e.escrowAddress}</span></div>
                        <div>Depositor: <span className="font-mono">{e.depositorAddress}</span>{e.depositorEmail && ` · ${e.depositorEmail}`}</div>
                        <div>Beneficiary: <span className="font-mono">{e.beneficiaryAddress}</span>{e.beneficiaryEmail && ` · ${e.beneficiaryEmail}`}</div>
                        {e.arbiterAddress && <div>Arbiter: <span className="font-mono">{e.arbiterAddress}</span></div>}
                        <div>
                          Amount: {chainAmount(e.amount)} {e.chain}
                          {e.depositedAmount && ` · deposited ${chainAmount(e.depositedAmount)}`}
                          {e.feeAmount && ` · fee ${chainAmount(e.feeAmount)}`}
                        </div>
                        {e.depositTxHash && <div>Deposit tx: <span className="font-mono">{e.depositTxHash}</span></div>}
                        {e.settlementTxHash && <div>Settlement tx: <span className="font-mono">{e.settlementTxHash}</span></div>}
                        <div>
                          Funded {e.fundedAt ? new Date(e.fundedAt).toLocaleString() : '—'} · released{' '}
                          {e.releasedAt ? new Date(e.releasedAt).toLocaleString() : '—'} · settled{' '}
                          {e.settledAt ? new Date(e.settledAt).toLocaleString() : '—'}
                        </div>
                        {(e.disputedAt || e.disputeReason) && (
                          <div className="text-amber-300/80">
                            Disputed {e.disputedAt ? new Date(e.disputedAt).toLocaleString() : ''}
                            {e.disputeStatus && ` (${e.disputeStatus})`}
                            {e.disputeReason && `: ${e.disputeReason}`}
                          </div>
                        )}
                        <div>
                          {e.inSeries ? 'Part of a recurring series · ' : ''}
                          {e.allowAutoRelease ? 'auto-release on · ' : ''}
                          {e.settleAttempts > 0 ? `${count(e.settleAttempts)} settle attempts` : ''}
                        </div>
                        {e.merchantEmail && <div>Merchant: {e.merchantEmail}</div>}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={e.status} />
                    {e.isHeld && !e.isStranded && (
                      <div className="mt-1 text-[10px] uppercase tracking-wide text-blue-300">held</div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="text-gray-200">{usd(e.amountUsd)}</div>
                    <div className="text-xs text-gray-500">{chainAmount(e.amount)} {e.chain}</div>
                  </td>
                  <td className="px-3 py-3 text-gray-300">
                    {e.businessName ?? <span className="text-gray-600">—</span>}
                    {e.merchantEmail && <div className="text-xs text-gray-500">{e.merchantEmail}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-gray-300" title={e.fundedAt ?? ''}>
                    {e.fundedAt ? shortDate(e.fundedAt) : <span className="text-gray-600">never</span>}
                  </td>
                  <td className="px-3 py-3 text-right text-gray-300">{duration(e.hoursToSettle)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-gray-300" title={e.expiresAt ?? ''}>
                    {shortDate(e.expiresAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
        <span>
          {total === 0 ? 'No escrows' : `${count(offset + 1)}–${count(pageEnd)} of ${count(total)}`}
          {filtered && ' (filtered)'}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setOffset((o) => Math.max(o - PAGE_SIZE, 0))}
            disabled={offset === 0 || loading}
            className="rounded border border-slate-700 px-3 py-1 hover:text-purple-300 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            disabled={pageEnd >= total || loading}
            className="rounded border border-slate-700 px-3 py-1 hover:text-purple-300 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <p className="mt-6 text-xs text-gray-500">
        USD figures come from the amount priced at creation. “Quoted” covers every escrow including those that never
        funded, so it is demand rather than money moved and is never added to “Disbursed”. Chain amounts are shown
        per-escrow and never summed across chains. “Held” is funded and neither settled nor refunded; “stranded”
        narrows that to escrows already past their expiry. Release tokens are deliberately not exposed here.
      </p>
    </div>
  );
}
