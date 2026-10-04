'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Live fraud/risk event log.
 *
 * One component for both `/admin/logs` (platform-wide, with buyer IPs) and
 * `/dashboard/logs` (the merchant's own businesses, without). The endpoint
 * decides the scope — this component never asks for "all", it just renders
 * whatever the route it was pointed at is willing to return.
 */

export type EventLogFinding = { code?: string; label?: string; score?: number };

export type EventLogRow = {
  id: string;
  kind: string | null;
  decision: string | null;
  score: number | null;
  email: string | null;
  emailDomain: string | null;
  ip: string | null;
  amount: number | null;
  currency: string | null;
  description: string | null;
  findings: EventLogFinding[];
  businessId: string | null;
  businessName: string | null;
  createdAt: string;
};

type EventLogResponse = {
  rows: EventLogRow[];
  summary: { kind: string; decision: string | null; count: number }[];
  total: number;
  generatedAt: string;
};

export type EventLogTableProps = {
  endpoint: string;
  /** Show the buyer IP column. Admin views only. */
  showIp?: boolean;
  /** Show which business each event belongs to. Pointless on a single-business view. */
  showBusiness?: boolean;
};

const POLL_MS = 15_000;
const KINDS = ['checkout_screen', 'card_declined', 'dispute'];
const DECISIONS = ['allow', 'verify', 'block'];

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function timeOfDay(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour12: false });
}

function dayLabel(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function money(amount: number | null, currency: string | null): string {
  if (amount === null) return '—';
  // fraud_events.amount is major units already — do not divide by 100.
  const code = (currency || 'usd').toUpperCase();
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return code === 'USD' ? `$${formatted}` : `${formatted} ${code}`;
}

const DECISION_STYLES: Record<string, string> = {
  allow: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  verify: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  block: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

const KIND_STYLES: Record<string, string> = {
  checkout_screen: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  card_declined: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  dispute: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

function Pill({ text, className }: { text: string; className: string }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}>
      {text}
    </span>
  );
}

/** Risk score colouring: higher is worse. Thresholds match the screening rules. */
function scoreClass(score: number | null): string {
  if (score === null) return 'text-gray-400';
  if (score >= 60) return 'text-red-600 dark:text-red-400 font-semibold';
  if (score >= 30) return 'text-yellow-600 dark:text-yellow-400 font-medium';
  return 'text-gray-600 dark:text-gray-400';
}

export default function EventLogTable({
  endpoint,
  showIp = false,
  showBusiness = true,
}: EventLogTableProps) {
  const [data, setData] = useState<EventLogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);
  const [kind, setKind] = useState('');
  const [decision, setDecision] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Ignore a slow response that lands after a newer one has already rendered.
  const requestSeq = useRef(0);

  const load = useCallback(
    async (showSpinner: boolean) => {
      const seq = ++requestSeq.current;
      if (showSpinner) setLoading(true);
      try {
        const params = new URLSearchParams();
        if (kind) params.set('kind', kind);
        if (decision) params.set('decision', decision);
        if (search.trim()) params.set('search', search.trim());
        params.set('limit', '100');

        const res = await fetch(`${endpoint}?${params.toString()}`, {
          headers: authHeaders(),
          cache: 'no-store',
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        const json = (await res.json()) as EventLogResponse;
        if (seq !== requestSeq.current) return;
        setData(json);
        setError(null);
        setLastUpdated(new Date().toLocaleTimeString('en-US', { hour12: false }));
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load events');
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [endpoint, kind, decision, search]
  );

  // Refetch when a filter changes, debounced so typing in search does not
  // fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => load(true), search ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, search]);

  // Poll while live and the tab is visible. A background tab polling every
  // 15s for a page nobody is looking at is just load.
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load(false);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [live, load]);

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm"
          aria-label="Filter by event kind"
        >
          <option value="">All kinds</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k.replace(/_/g, ' ')}
            </option>
          ))}
        </select>

        <select
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm"
          aria-label="Filter by decision"
        >
          <option value="">All decisions</option>
          {DECISIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search email or description…"
          className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm flex-1 min-w-[200px]"
          aria-label="Search events"
        />

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
          <span className={`inline-block w-2 h-2 rounded-full mr-2 ${live ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
          {live ? 'Live' : 'Paused'}
        </button>

        <button
          type="button"
          onClick={() => load(true)}
          className="rounded bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200"
        >
          Refresh
        </button>
      </div>

      {data && data.summary.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.summary.map((s) => (
            <span
              key={`${s.kind}-${s.decision ?? ''}`}
              className="rounded bg-gray-100 dark:bg-gray-700 px-2 py-1 text-xs text-gray-700 dark:text-gray-200"
            >
              {s.kind.replace(/_/g, ' ')}
              {s.decision ? ` · ${s.decision}` : ''}
              <span className="ml-1 font-semibold">{s.count.toLocaleString('en-US')}</span>
            </span>
          ))}
        </div>
      )}

      <div className="text-xs text-gray-500 dark:text-gray-400">
        {lastUpdated ? `Updated ${lastUpdated}` : 'Loading…'}
        {data ? ` · ${rows.length.toLocaleString('en-US')} shown of ${data.total.toLocaleString('en-US')}` : ''}
        {live ? ` · refreshing every ${POLL_MS / 1000}s` : ''}
      </div>

      {error && (
        <div className="rounded bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg shadow-md">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr className="text-left text-gray-600 dark:text-gray-300">
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">Decision</th>
              <th className="px-3 py-2 font-medium text-right">Score</th>
              {showBusiness && <th className="px-3 py-2 font-medium">Business</th>}
              <th className="px-3 py-2 font-medium">Buyer</th>
              {showIp && <th className="px-3 py-2 font-medium">IP</th>}
              <th className="px-3 py-2 font-medium text-right">Amount</th>
              <th className="px-3 py-2 font-medium">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={showIp && showBusiness ? 9 : 8} className="px-3 py-8 text-center text-gray-500 dark:text-gray-400">
                  No events match these filters
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const isOpen = expanded === row.id;
              return (
                <tr
                  key={row.id}
                  onClick={() => setExpanded(isOpen ? null : row.id)}
                  className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 align-top"
                >
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-300">
                    <div>{timeOfDay(row.createdAt)}</div>
                    <div className="text-xs text-gray-400">{dayLabel(row.createdAt)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Pill
                      text={(row.kind ?? 'unknown').replace(/_/g, ' ')}
                      className={KIND_STYLES[row.kind ?? ''] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {row.decision ? (
                      <Pill
                        text={row.decision}
                        className={DECISION_STYLES[row.decision] ?? 'bg-gray-100 text-gray-700'}
                      />
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right ${scoreClass(row.score)}`}>
                    {row.score ?? '—'}
                  </td>
                  {showBusiness && (
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-200">
                      {row.businessName ?? <span className="text-gray-400">—</span>}
                    </td>
                  )}
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-200">
                    {row.email ?? row.emailDomain ?? <span className="text-gray-400">no email</span>}
                  </td>
                  {showIp && (
                    <td className="px-3 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">
                      {row.ip ?? '—'}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right whitespace-nowrap text-gray-700 dark:text-gray-200">
                    {money(row.amount, row.currency)}
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                    <div className={isOpen ? '' : 'truncate max-w-[240px]'}>
                      {row.description ?? '—'}
                    </div>
                    {isOpen && row.findings.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {row.findings.map((f, i) => (
                          <li key={`${row.id}-f${i}`} className="text-xs text-gray-500 dark:text-gray-400">
                            <span className="font-mono">{f.code ?? '?'}</span>
                            {f.label ? ` — ${f.label}` : ''}
                            {typeof f.score === 'number' ? ` (+${f.score})` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                    {isOpen && row.findings.length === 0 && (
                      <div className="mt-2 text-xs text-gray-400">No findings recorded</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
