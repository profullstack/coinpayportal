'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

type SortKey =
  | 'email'
  | 'created_at'
  | 'last_login_at'
  | 'last_activity_at'
  | 'businesses_count'
  | 'payments_total'
  | 'payments_settled'
  | 'settled_volume_usd'
  | 'invoices_total'
  | 'invoices_paid_usd'
  | 'escrows_total'
  | 'stripe_volume_usd'
  | 'total_volume_usd';

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  authProvider: string | null;
  subscriptionPlanId: string | null;
  subscriptionStatus: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  lastActivityAt: string | null;
  businessesCount: number;
  activeBusinessesCount: number;
  paymentsTotal: number;
  paymentsSettled: number;
  settledVolumeUsd: number;
  invoicesTotal: number;
  invoicesPaid: number;
  invoicesPaidUsd: number;
  invoiceFeesUsd: number;
  escrowsTotal: number;
  escrowsSettled: number;
  escrowVolumeUsd: number;
  stripeTotal: number;
  stripeCompleted: number;
  stripeVolumeUsd: number;
  totalVolumeUsd: number;
};

type Summary = {
  usersTotal: number;
  usersNew7d: number;
  usersNew30d: number;
  usersActive30d: number;
  businessesTotal: number;
  businessesActive: number;
  paymentsTotal: number;
  paymentsSettled: number;
  paymentsVolumeUsd: number;
  invoicesTotal: number;
  invoicesPaid: number;
  invoicesPaidUsd: number;
  escrowsTotal: number;
  escrowsSettled: number;
  escrowVolumeUsd: number;
  stripeCompleted: number;
  stripeVolumeUsd: number;
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

function count(value: number): string {
  return value.toLocaleString('en-US');
}

function shortDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "3d ago" reads faster than a timestamp when scanning a column for staleness. */
function relative(value: string | null): string {
  if (!value) return 'never';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return 'never';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const COLUMNS: { key: SortKey; label: string; numeric: boolean; title?: string }[] = [
  { key: 'email', label: 'User', numeric: false },
  { key: 'created_at', label: 'Signed up', numeric: false },
  { key: 'last_activity_at', label: 'Last active', numeric: false, title: 'Most recent login, payment, invoice, escrow or Stripe charge' },
  { key: 'businesses_count', label: 'Biz', numeric: true, title: 'Businesses' },
  { key: 'payments_settled', label: 'Payments', numeric: true, title: 'Settled / total crypto payments' },
  { key: 'settled_volume_usd', label: 'Crypto', numeric: true, title: 'USD volume of settled crypto payments' },
  { key: 'invoices_total', label: 'Invoices', numeric: true, title: 'Paid / total invoices' },
  { key: 'stripe_volume_usd', label: 'Stripe', numeric: true, title: 'USD volume of completed Stripe charges' },
  { key: 'total_volume_usd', label: 'Total USD', numeric: true, title: 'Crypto + invoices + escrows + Stripe' },
];

const CSV_COLUMNS: { header: string; value: (u: UserRow) => string | number }[] = [
  { header: 'email', value: (u) => u.email },
  { header: 'name', value: (u) => u.name ?? '' },
  { header: 'is_admin', value: (u) => String(u.isAdmin) },
  { header: 'auth_provider', value: (u) => u.authProvider ?? '' },
  { header: 'plan', value: (u) => u.subscriptionPlanId ?? '' },
  { header: 'subscription_status', value: (u) => u.subscriptionStatus ?? '' },
  { header: 'signed_up', value: (u) => u.createdAt },
  { header: 'last_login_at', value: (u) => u.lastLoginAt ?? '' },
  { header: 'last_activity_at', value: (u) => u.lastActivityAt ?? '' },
  { header: 'businesses', value: (u) => u.businessesCount },
  { header: 'active_businesses', value: (u) => u.activeBusinessesCount },
  { header: 'payments_total', value: (u) => u.paymentsTotal },
  { header: 'payments_settled', value: (u) => u.paymentsSettled },
  { header: 'settled_volume_usd', value: (u) => u.settledVolumeUsd },
  { header: 'invoices_total', value: (u) => u.invoicesTotal },
  { header: 'invoices_paid', value: (u) => u.invoicesPaid },
  { header: 'invoices_paid_usd', value: (u) => u.invoicesPaidUsd },
  { header: 'invoice_fees_usd', value: (u) => u.invoiceFeesUsd },
  { header: 'escrows_total', value: (u) => u.escrowsTotal },
  { header: 'escrows_settled', value: (u) => u.escrowsSettled },
  { header: 'escrow_volume_usd', value: (u) => u.escrowVolumeUsd },
  { header: 'stripe_total', value: (u) => u.stripeTotal },
  { header: 'stripe_completed', value: (u) => u.stripeCompleted },
  { header: 'stripe_volume_usd', value: (u) => u.stripeVolumeUsd },
  { header: 'total_volume_usd', value: (u) => u.totalVolumeUsd },
];

export function toCsv(rows: UserRow[]): string {
  const escape = (v: string | number): string => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_COLUMNS.map((c) => c.header).join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((c) => escape(c.value(row))).join(','));
  }
  return lines.join('\n');
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

export default function UsersContent() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<SortKey>('last_activity_at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [authState, setAuthState] = useState<'unknown' | 'unauthenticated' | 'forbidden' | 'ok'>('unknown');
  const [error, setError] = useState<string | null>(null);

  // Debounce the search box so typing an email is one request, not eight.
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
      if (over.summary) params.set('summary', over.summary);
      return params.toString();
    },
    [sort, dir, offset, search],
  );

  // A slow request for an earlier sort must not overwrite a newer one.
  const requestId = useRef(0);

  const fetchUsers = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users?${queryString()}`, { headers: authHeaders() });
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
        setError('Failed to load users');
        return;
      }
      const data = await res.json();
      if (id !== requestId.current) return;
      setUsers(data.users ?? []);
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
    void fetchUsers();
  }, [fetchUsers]);

  const toggleSort = (key: SortKey) => {
    if (key === sort) {
      setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSort(key);
      // Names read best A-Z; every metric reads best biggest-first.
      setDir(key === 'email' ? 'asc' : 'desc');
    }
    setOffset(0);
  };

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      // Exports everything matching the current search, not just this page —
      // 500 is the server's ceiling.
      const res = await fetch(`/api/admin/users?${queryString({ limit: 500, offset: 0, summary: '0' })}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        setError('Export failed');
        return;
      }
      const data = await res.json();
      const rows: UserRow[] = data.users ?? [];
      const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `coinpay-users-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (data.total > rows.length) {
        setError(`Exported the first ${rows.length} of ${data.total} users — narrow the search for the rest.`);
      }
    } catch {
      setError('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const pageEnd = useMemo(() => Math.min(offset + users.length, total), [offset, users.length, total]);

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
      <h1 className="text-3xl font-bold text-white mb-2">Users</h1>
      <p className="text-gray-400 mb-8">
        Every merchant account, with their activity and USD volume across crypto payments, invoices, escrows and Stripe.
      </p>

      {summary && (
        <section className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Users" value={count(summary.usersTotal)} sub={`+${count(summary.usersNew7d)} in 7d · +${count(summary.usersNew30d)} in 30d`} />
          <StatTile label="Logged in 30d" value={count(summary.usersActive30d)} sub={`of ${count(summary.usersTotal)}`} />
          <StatTile label="Businesses" value={count(summary.businessesTotal)} sub={`${count(summary.businessesActive)} active`} />
          <StatTile label="Crypto volume" value={usd(summary.paymentsVolumeUsd)} sub={`${count(summary.paymentsSettled)} of ${count(summary.paymentsTotal)} settled`} />
          <StatTile label="Stripe volume" value={usd(summary.stripeVolumeUsd)} sub={`${count(summary.stripeCompleted)} completed`} />
          <StatTile label="Invoiced" value={usd(summary.invoicesPaidUsd)} sub={`${count(summary.invoicesPaid)} of ${count(summary.invoicesTotal)} paid`} />
        </section>
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
          placeholder="Search email or name…"
          className="min-w-[16rem] flex-1 rounded bg-slate-950 px-3 py-2 text-sm text-white border border-slate-700 focus:border-purple-500 focus:outline-none"
        />
        <button
          onClick={handleExport}
          disabled={exporting}
          className="rounded bg-purple-600/20 px-4 py-2 text-sm text-purple-300 hover:bg-purple-600/30 border border-purple-500/20 disabled:opacity-50"
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
        <button
          onClick={() => void fetchUsers()}
          disabled={loading}
          className="text-sm text-gray-400 hover:text-purple-300 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-900/50">
        <table className="w-full min-w-[56rem] text-sm">
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
            {users.length === 0 && !loading && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-gray-400">
                  {search.trim() ? `No users match “${search.trim()}”.` : 'No users yet.'}
                </td>
              </tr>
            )}
            {users.map((u) => {
              const isOpen = expanded === u.id;
              return (
                <tr
                  key={u.id}
                  onClick={() => setExpanded(isOpen ? null : u.id)}
                  className="cursor-pointer border-b border-slate-800 last:border-0 hover:bg-slate-800/40"
                >
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-white">{u.name || u.email.split('@')[0]}</span>
                      {u.isAdmin && (
                        <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-purple-300">
                          admin
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400">{u.email}</div>
                    {isOpen && (
                      <div className="mt-2 space-y-0.5 text-xs text-gray-400">
                        <div>Plan: {u.subscriptionPlanId ?? '—'} ({u.subscriptionStatus ?? '—'})</div>
                        <div>Auth: {u.authProvider ?? '—'}</div>
                        <div>Businesses: {count(u.activeBusinessesCount)} active of {count(u.businessesCount)}</div>
                        <div>Escrows: {count(u.escrowsSettled)} settled of {count(u.escrowsTotal)} · {usd(u.escrowVolumeUsd)}</div>
                        <div>Invoices: {usd(u.invoicesPaidUsd)} paid · {usd(u.invoiceFeesUsd)} fees</div>
                        <div>Stripe: {count(u.stripeCompleted)} of {count(u.stripeTotal)} completed</div>
                        <div>Last login: {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'never'}</div>
                        <div className="font-mono text-[10px] text-gray-600">{u.id}</div>
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-gray-300">{shortDate(u.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-gray-300" title={u.lastActivityAt ?? ''}>
                    {relative(u.lastActivityAt)}
                  </td>
                  <td className="px-3 py-3 text-right text-gray-300">{count(u.businessesCount)}</td>
                  <td className="px-3 py-3 text-right text-gray-300">
                    {count(u.paymentsSettled)}
                    <span className="text-gray-500"> / {count(u.paymentsTotal)}</span>
                  </td>
                  <td className="px-3 py-3 text-right text-gray-300">{usd(u.settledVolumeUsd)}</td>
                  <td className="px-3 py-3 text-right text-gray-300">
                    {count(u.invoicesPaid)}
                    <span className="text-gray-500"> / {count(u.invoicesTotal)}</span>
                  </td>
                  <td className="px-3 py-3 text-right text-gray-300">{usd(u.stripeVolumeUsd)}</td>
                  <td className="px-3 py-3 text-right font-medium text-white">{usd(u.totalVolumeUsd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
        <span>
          {total === 0 ? 'No users' : `${count(offset + 1)}–${count(pageEnd)} of ${count(total)}`}
          {search.trim() && ' (filtered)'}
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
        USD columns cover settled crypto payments, paid USD-denominated invoices, settled escrows and completed Stripe
        charges. Invoices priced in crypto are counted but not added to USD totals, and platform fees on crypto payments
        are held in chain units, so they are not summed here.
      </p>
    </div>
  );
}
