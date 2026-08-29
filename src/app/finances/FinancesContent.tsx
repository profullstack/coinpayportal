'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePlaidLink } from './usePlaidLink';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { requireAuth } from '@/lib/auth/client';
import { formatMoney, formatCompact, formatDate, formatRelative, percentOf } from '@/lib/finances/format';
import { ACCOUNT_KINDS, categoryLabel, type AccountKind } from '@/lib/finances/classify';

/**
 * The /finances console.
 *
 * Deliberately one page: balances, accounts, spending and the ledger are the
 * same question asked at four zoom levels, and splitting them across routes
 * means reconciling four separately-stale views of the same money.
 *
 * Syncing is a button, never an effect. SimpleFIN permits roughly 24 requests
 * per day for the whole connection, so a sync-on-mount would spend the day's
 * budget on idle tab reloads.
 */

type Account = {
  id: string;
  name: string;
  org_name: string | null;
  currency: string;
  balance: number | null;
  available_balance: number | null;
  balance_date: string | null;
  effective_kind: AccountKind;
  kind_override: string | null;
  is_liability: boolean;
  display_balance: number | null;
  is_hidden: boolean;
};

type Transaction = {
  id: string;
  account_id: string;
  posted: string;
  amount: number;
  description: string | null;
  payee: string | null;
  memo: string | null;
  pending: boolean;
  category: string | null;
  account_name: string;
  org_name: string | null;
  currency: string;
};

type Summary = {
  windowDays: number;
  totals: Array<{ currency: string; assets: number; liabilities: number; net: number; accounts: number }>;
  primaryCurrency: string | null;
  byKind: Array<{ kind: AccountKind; currency: string; total: number; accounts: number }>;
  byInstitution: Array<{ org: string; currency: string; assets: number; liabilities: number; accounts: number }>;
  cashflow: { currency: string | null; moneyIn: number; moneyOut: number; net: number; transactions: number };
  topCategories: Array<{ category: string | null; spent: number; received: number; count: number }>;
  accountCount: number;
  hiddenCount: number;
  transactionCount: number;
  oldestTransaction: string | null;
  newestTransaction: string | null;
};

type Connection = {
  id: string;
  label: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  last_sync_accounts: number | null;
  last_sync_transactions: number | null;
};

const KIND_LABEL: Record<AccountKind, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit: 'Credit card',
  loan: 'Loan',
  investment: 'Investment',
  cash: 'Cash',
  unknown: 'Unclassified',
};

const KIND_BADGE: Record<AccountKind, string> = {
  checking: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  savings: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  credit: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  loan: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  investment: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  cash: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  unknown: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

const WINDOWS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '12 months' },
];

const PAGE_SIZE = 50;

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = { ...(extra as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export default function FinancesContent() {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [windowDays, setWindowDays] = useState(30);
  const [showHidden, setShowHidden] = useState(false);

  const [syncing, setSyncing] = useState(false);

  // Ledger state, paged and filtered server-side.
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [txOffset, setTxOffset] = useState(0);
  const [txLoading, setTxLoading] = useState(false);
  const [accountFilter, setAccountFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const [setupToken, setSetupToken] = useState('');
  const [linking, setLinking] = useState(false);
  const [showLink, setShowLink] = useState(false);
  // Whether this deployment offers Plaid alongside SimpleFIN. Server-decided:
  // Plaid bills per connected account, so the button appears only where the
  // deployment has opted in.
  const [plaidEnabled, setPlaidEnabled] = useState(false);

  const loadOverview = useCallback(async () => {
    // Bounces to /login when there is no session, the same way /dashboard does.
    if (!requireAuth(router)) return;

    setError(null);
    try {
      const query = `days=${windowDays}${showHidden ? '&hidden=1' : ''}`;
      const [summaryRes, accountsRes, connectionsRes] = await Promise.all([
        fetch(`/api/finances/summary?${query}`, { headers: authHeaders() }),
        fetch(`/api/finances/accounts${showHidden ? '?hidden=1' : ''}`, { headers: authHeaders() }),
        fetch('/api/finances/connections', { headers: authHeaders() }),
      ]);

      if (summaryRes.status === 401 || summaryRes.status === 403) {
        setError('Your session has expired. Please log in again.');
        return;
      }
      if (!summaryRes.ok || !accountsRes.ok) {
        setError('Failed to load finances.');
        return;
      }

      setSummary((await summaryRes.json()).summary);
      setAccounts((await accountsRes.json()).accounts ?? []);
      if (connectionsRes.ok) {
        const connectionsData = await connectionsRes.json();
        setConnections(connectionsData.connections ?? []);
        setPlaidEnabled(connectionsData.plaidEnabled === true);
      }
    } catch {
      setError('Network error loading finances.');
    } finally {
      setLoading(false);
    }
  }, [windowDays, showHidden, router]);

  const loadTransactions = useCallback(async () => {
    setTxLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(txOffset) });
      if (accountFilter) params.set('account', accountFilter);
      if (categoryFilter) params.set('category', categoryFilter);
      if (search) params.set('search', search);

      const res = await fetch(`/api/finances/transactions?${params}`, { headers: authHeaders() });
      if (!res.ok) return;

      const data = await res.json();
      setTransactions(data.rows ?? []);
      setTxTotal(data.total ?? 0);
    } catch {
      // The ledger failing is not worth blanking the balance sheet above it.
    } finally {
      setTxLoading(false);
    }
  }, [txOffset, accountFilter, categoryFilter, search]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  // Debounce the search box so typing does not fire a query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setTxOffset(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/finances/sync', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        // No `days`: the server's default window is the largest one SimpleFIN
        // accepts without capping the request.
        body: JSON.stringify({}),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Sync failed.');
        return;
      }

      const t = data.totals ?? { accounts: 0, transactionsNew: 0 };
      setNotice(
        `Synced ${t.accounts} account${t.accounts === 1 ? '' : 's'} · ${t.transactionsNew} new transaction${
          t.transactionsNew === 1 ? '' : 's'
        }${data.status === 'partial' ? ' · some institutions reported errors' : ''}`,
      );

      // Advisories are informational, so they are shown separately from the
      // error banner rather than dressed up as a failure.
      const advisories: string[] = (data.results ?? []).flatMap(
        (r: { notices?: string[] }) => r.notices ?? [],
      );
      if (advisories.length > 0) console.info('[finances] SimpleFIN advisories:', advisories);

      await loadOverview();
      await loadTransactions();
    } catch {
      setError('Network error during sync.');
    } finally {
      setSyncing(false);
    }
  };

  const handleLink = async () => {
    if (!setupToken.trim()) return;
    setLinking(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/finances/connections', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ setupToken: setupToken.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not link the connection.');
        return;
      }
      setSetupToken('');
      setShowLink(false);
      setNotice('Connection linked. Run a sync to pull balances.');
      await loadOverview();
    } catch {
      setError('Network error linking the connection.');
    } finally {
      setLinking(false);
    }
  };

  const handlePlaidLinked = useCallback(
    async (institutionName: string | null) => {
      setShowLink(false);
      setError(null);
      setNotice(
        institutionName
          ? `${institutionName} connected. Run a sync to pull balances.`
          : 'Connection linked. Run a sync to pull balances.',
      );
      await loadOverview();
    },
    [loadOverview],
  );

  const { open: openPlaid, starting: plaidStarting } = usePlaidLink({
    authHeaders,
    onLinked: handlePlaidLinked,
    onError: setError,
  });

  const updateAccount = async (id: string, patch: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/finances/accounts/${id}`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        setError('Could not update the account.');
        return;
      }
      await loadOverview();
    } catch {
      setError('Network error updating the account.');
    }
  };

  const currency = summary?.primaryCurrency ?? 'USD';
  const headline = summary?.totals.find((t) => t.currency === currency) ?? null;

  /** Accounts grouped by institution, in the order the API returned them. */
  const byInstitution = useMemo(() => {
    const groups = new Map<string, Account[]>();
    for (const account of accounts) {
      const key = account.org_name ?? 'Unknown institution';
      groups.set(key, [...(groups.get(key) ?? []), account]);
    }
    return [...groups.entries()];
  }, [accounts]);

  const spendTotal = useMemo(
    () => (summary?.topCategories ?? []).reduce((sum, c) => sum + c.spent, 0),
    [summary],
  );

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of summary?.topCategories ?? []) if (c.category) set.add(c.category);
    return [...set].sort();
  }, [summary]);

  if (loading) {
    return <div className="container mx-auto px-4 py-16 text-center text-gray-400">Loading finances…</div>;
  }

  if (error && !summary) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <p className="text-red-400 mb-2">{error}</p>
        <Link href="/dashboard" className="text-purple-400 hover:underline">
          Back to dashboard →
        </Link>
      </div>
    );
  }

  const connection = connections[0] ?? null;
  const hasData = (summary?.accountCount ?? 0) > 0;

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-2">
        <div>
          <h1 className="text-3xl font-bold text-white">Finances</h1>
          <p className="text-gray-400 mt-1">
            Bank accounts and credit cards, read-only via SimpleFIN.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button
            onClick={() => setShowLink((v) => !v)}
            className="rounded border border-slate-600 px-4 py-2 text-sm text-gray-300 hover:bg-slate-800"
          >
            Link institution
          </button>
        </div>
      </div>

      {connection && (
        <p className="text-xs text-gray-500 mb-6">
          Last synced {formatRelative(connection.last_synced_at)}
          {connection.last_sync_status === 'error' && (
            <span className="text-red-400"> · last sync failed: {connection.last_sync_error}</span>
          )}
          {connection.last_sync_status === 'partial' && (
            <span className="text-amber-400"> · some institutions reported errors</span>
          )}
        </p>
      )}

      {notice && (
        <div className="mb-6 rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-6 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {showLink && (
        <section className="mb-8 rounded-lg border border-slate-700 bg-slate-900/50 p-6">
          <h2 className="text-lg font-semibold text-white mb-2">Link an institution</h2>
          <PlaidOption enabled={plaidEnabled} starting={plaidStarting} onOpen={openPlaid} />
          <p className="text-sm text-gray-400 mb-4">
            Paste a SimpleFIN setup token from{' '}
            <a
              href="https://beta-bridge.simplefin.org/"
              target="_blank"
              rel="noreferrer noopener"
              className="text-purple-400 hover:underline"
            >
              beta-bridge.simplefin.org
            </a>
            . Setup tokens are single-use — once claimed, the same token cannot be used again.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
              placeholder="base64 setup token"
              className="flex-1 rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-gray-600"
            />
            <button
              onClick={handleLink}
              disabled={linking || !setupToken.trim()}
              className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
            >
              {linking ? 'Claiming…' : 'Claim token'}
            </button>
          </div>
        </section>
      )}

      {!hasData && connections.length > 0 && (
        <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-8 text-center">
          <p className="text-gray-300 mb-2">Connected, but nothing imported yet.</p>
          <p className="text-sm text-gray-500">
            Press <span className="text-gray-300">Sync now</span> to pull balances and recent
            transactions from your linked institutions.
          </p>
        </section>
      )}

      {!hasData && connections.length === 0 && (
        <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-8">
          <h2 className="text-lg font-semibold text-white mb-2">Connect your accounts</h2>
          <p className="text-sm text-gray-400 mb-6">
            CoinPay reads your balances and transactions through an independent service that
            holds the bank connection. Access is read-only — nothing here can move money.
          </p>

          <PlaidOption enabled={plaidEnabled} starting={plaidStarting} onOpen={openPlaid} />

          {plaidEnabled && (
            <p className="text-sm text-gray-400 mb-4">
              Or connect through SimpleFIN instead, if your bank is not listed:
            </p>
          )}

          <ol className="space-y-4 text-sm text-gray-300 mb-6">
            <li className="flex gap-3">
              <span className="text-purple-400 font-semibold">1.</span>
              <span>
                Create an account at{' '}
                <a
                  href="https://beta-bridge.simplefin.org/"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-purple-400 hover:underline"
                >
                  SimpleFIN Bridge
                </a>{' '}
                and link your banks and cards there.{' '}
                <span className="text-gray-500">
                  The Bridge is a paid service — $1.50/month or $15/year, billed by them, not by
                  CoinPay.
                </span>
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-400 font-semibold">2.</span>
              <span>
                On the Bridge, choose <span className="text-gray-200">Connect to an app</span> to
                generate a <span className="text-gray-200">Setup Token</span> — a long block of
                base64 text.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-400 font-semibold">3.</span>
              <span>
                Paste it below. We exchange it once for a read-only credential and store that
                encrypted.{' '}
                <span className="text-gray-500">
                  Setup tokens are single-use, so generate a fresh one if you need to reconnect.
                </span>
              </span>
            </li>
          </ol>

          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
              placeholder="Paste your SimpleFIN setup token"
              className="flex-1 rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-gray-600"
            />
            <button
              onClick={handleLink}
              disabled={linking || !setupToken.trim()}
              className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
            >
              {linking ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </section>
      )}

      {hasData && summary && (
        <>
          {/* ---------------- headline tiles ---------------- */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
            <Tile
              label="Net position"
              value={formatCompact(headline?.net ?? 0, currency)}
              tone={(headline?.net ?? 0) >= 0 ? 'positive' : 'negative'}
              detail={`${summary.accountCount} account${summary.accountCount === 1 ? '' : 's'}`}
            />
            <Tile
              label="Cash & savings"
              value={formatCompact(headline?.assets ?? 0, currency)}
              tone="positive"
              detail="Across all deposit accounts"
            />
            <Tile
              label="Owed"
              value={formatCompact(headline?.liabilities ?? 0, currency)}
              tone="negative"
              detail="Credit cards and loans"
            />
            <Tile
              label={`Net flow · ${summary.windowDays}d`}
              value={formatCompact(summary.cashflow.net, currency)}
              tone={summary.cashflow.net >= 0 ? 'positive' : 'negative'}
              detail={`${formatCompact(summary.cashflow.moneyIn, currency)} in · ${formatCompact(
                summary.cashflow.moneyOut,
                currency,
              )} out`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-8">
            <span className="text-xs uppercase tracking-wide text-gray-500">Window</span>
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                onClick={() => setWindowDays(w.days)}
                className={`rounded px-3 py-1 text-xs border ${
                  windowDays === w.days
                    ? 'border-purple-500/40 bg-purple-600/20 text-purple-200'
                    : 'border-slate-700 text-gray-400 hover:bg-slate-800'
                }`}
              >
                {w.label}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
                className="accent-purple-500"
              />
              Show hidden accounts{summary.hiddenCount > 0 ? ` (${summary.hiddenCount})` : ''}
            </label>
          </div>

          {/* ---------------- accounts ---------------- */}
          <section className="mb-10">
            <h2 className="text-lg font-semibold text-white mb-4">Accounts</h2>
            <div className="space-y-6">
              {byInstitution.map(([org, rows]) => (
                <div key={org} className="rounded-lg border border-slate-700 bg-slate-900/50 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                    <h3 className="text-sm font-semibold text-white">{org}</h3>
                    <span className="text-xs text-gray-500">
                      {rows.length} account{rows.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {rows.map((account) => (
                          <tr
                            key={account.id}
                            className={`border-b border-slate-800/60 last:border-0 ${
                              account.is_hidden ? 'opacity-50' : ''
                            }`}
                          >
                            <td className="px-4 py-3">
                              <div className="text-gray-200">{account.name}</div>
                              <div className="text-xs text-gray-500">
                                Balance as of {formatDate(account.balance_date)}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-block rounded border px-2 py-0.5 text-xs ${
                                  KIND_BADGE[account.effective_kind]
                                }`}
                              >
                                {KIND_LABEL[account.effective_kind]}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div
                                className={
                                  account.is_liability
                                    ? 'text-rose-300 font-medium'
                                    : 'text-emerald-300 font-medium'
                                }
                              >
                                {formatMoney(account.display_balance, account.currency)}
                                {account.is_liability && (
                                  <span className="ml-1 text-xs text-gray-500">owed</span>
                                )}
                              </div>
                              {account.available_balance !== null &&
                                account.available_balance !== account.balance && (
                                  <div className="text-xs text-gray-500">
                                    {formatMoney(account.available_balance, account.currency)} available
                                  </div>
                                )}
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <select
                                value={account.kind_override ?? ''}
                                onChange={(e) =>
                                  updateAccount(account.id, {
                                    kind_override: e.target.value || null,
                                  })
                                }
                                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-gray-300"
                                aria-label={`Account type for ${account.name}`}
                              >
                                <option value="">Auto ({KIND_LABEL[account.effective_kind]})</option>
                                {ACCOUNT_KINDS.filter((k) => k !== 'unknown').map((k) => (
                                  <option key={k} value={k}>
                                    {KIND_LABEL[k]}
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() =>
                                  updateAccount(account.id, { is_hidden: !account.is_hidden })
                                }
                                className="ml-2 text-xs text-gray-500 hover:text-gray-300"
                              >
                                {account.is_hidden ? 'Unhide' : 'Hide'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ---------------- spending ---------------- */}
          {summary.topCategories.length > 0 && (
            <section className="mb-10">
              <h2 className="text-lg font-semibold text-white mb-4">
                Spending · last {summary.windowDays} days
              </h2>
              <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4 space-y-3">
                {summary.topCategories
                  .filter((c) => c.spent > 0)
                  .map((c) => (
                    <button
                      key={c.category ?? 'uncategorised'}
                      onClick={() => {
                        setCategoryFilter(c.category ?? 'uncategorised');
                        setTxOffset(0);
                      }}
                      className="block w-full text-left"
                    >
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-300">{categoryLabel(c.category)}</span>
                        <span className="text-gray-400">
                          {formatMoney(c.spent, currency)}
                          <span className="ml-2 text-xs text-gray-600">{c.count}</span>
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded bg-slate-800">
                        <div
                          className="h-1.5 rounded bg-purple-500/70"
                          style={{ width: `${percentOf(c.spent, spendTotal)}%` }}
                        />
                      </div>
                    </button>
                  ))}
              </div>
            </section>
          )}

          {/* ---------------- ledger ---------------- */}
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-semibold text-white">Transactions</h2>
              <span className="text-xs text-gray-500">
                {summary.transactionCount.toLocaleString()} imported
                {summary.oldestTransaction && ` · since ${formatDate(summary.oldestTransaction)}`}
              </span>
            </div>

            <div className="flex flex-wrap gap-3 mb-4">
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search description, payee or memo"
                className="flex-1 min-w-[220px] rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-gray-600"
              />
              <select
                value={accountFilter}
                onChange={(e) => {
                  setAccountFilter(e.target.value);
                  setTxOffset(0);
                }}
                className="rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-gray-300"
                aria-label="Filter by account"
              >
                <option value="">All accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.org_name ? `${a.org_name} — ` : ''}
                    {a.name}
                  </option>
                ))}
              </select>
              <select
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setTxOffset(0);
                }}
                className="rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-gray-300"
                aria-label="Filter by category"
              >
                <option value="">All categories</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
                <option value="uncategorised">Uncategorised</option>
              </select>
            </div>

            <div className="rounded-lg border border-slate-700 bg-slate-900/50 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 font-medium">Account</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {txLoading && transactions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                        Loading…
                      </td>
                    </tr>
                  )}
                  {!txLoading && transactions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                        No transactions match these filters.
                      </td>
                    </tr>
                  )}
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="border-b border-slate-800/60 last:border-0">
                      <td className="px-4 py-3 whitespace-nowrap text-gray-400">
                        {formatDate(tx.posted)}
                        {tx.pending && (
                          <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-300">
                            pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-200">
                        {tx.payee || tx.description || '—'}
                        {tx.payee && tx.description && tx.description !== tx.payee && (
                          <div className="text-xs text-gray-600 truncate max-w-md">{tx.description}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{tx.account_name}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{categoryLabel(tx.category)}</td>
                      <td
                        className={`px-4 py-3 text-right whitespace-nowrap font-medium ${
                          tx.amount >= 0 ? 'text-emerald-300' : 'text-gray-200'
                        }`}
                      >
                        {formatMoney(tx.amount, tx.currency, { signed: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {txTotal > PAGE_SIZE && (
              <div className="flex items-center justify-between mt-4 text-sm">
                <button
                  onClick={() => setTxOffset(Math.max(txOffset - PAGE_SIZE, 0))}
                  disabled={txOffset === 0}
                  className="rounded border border-slate-700 px-3 py-1 text-gray-300 disabled:opacity-40"
                >
                  ← Newer
                </button>
                <span className="text-xs text-gray-500">
                  {txOffset + 1}–{Math.min(txOffset + PAGE_SIZE, txTotal)} of {txTotal.toLocaleString()}
                </span>
                <button
                  onClick={() => setTxOffset(txOffset + PAGE_SIZE)}
                  disabled={txOffset + PAGE_SIZE >= txTotal}
                  className="rounded border border-slate-700 px-3 py-1 text-gray-300 disabled:opacity-40"
                >
                  Older →
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/**
 * The Plaid path, offered ahead of the SimpleFIN token because it is the one a
 * merchant can finish without leaving the page.
 *
 * Renders nothing at all when Plaid is off for this deployment — an inert or
 * explanatory button would just be an invitation to a dead end.
 */
function PlaidOption({
  enabled,
  starting,
  onOpen,
}: {
  enabled: boolean;
  starting: boolean;
  onOpen: () => void;
}) {
  if (!enabled) return null;

  return (
    <div className="mb-6 rounded border border-slate-600 bg-slate-950/60 p-4">
      <button
        onClick={onOpen}
        disabled={starting}
        className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
      >
        {starting ? 'Opening…' : 'Connect a bank or card'}
      </button>
      <p className="mt-3 text-sm text-gray-400">
        Sign in to your bank in a secure window. Works with most US banks and credit cards, and
        takes about a minute. Access is read-only.
      </p>
    </div>
  );
}

function Tile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone: 'positive' | 'negative';
}) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold ${
          tone === 'positive' ? 'text-emerald-300' : 'text-rose-300'
        }`}
      >
        {value}
      </div>
      {detail && <div className="mt-1 text-xs text-gray-500">{detail}</div>}
    </div>
  );
}
