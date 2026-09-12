'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { requireAuth } from '@/lib/auth/client';

/**
 * /finances/books — the bookkeeping desk.
 *
 * Every transaction arrives with a suggested category, tax category and
 * scope from a rule, the heuristics or the model. This page is where a
 * person agrees, corrects, and (with one checkbox) turns a correction into
 * a rule so the next sync gets it right on its own. The Tax summary tab
 * totals the reviewed books by tax category for a year or quarter and
 * exports the pack a CPA works from. Nothing here is tax advice, and the
 * export says how many rows are still unreviewed.
 */

interface Row {
  id: string;
  accountId: string;
  accountName: string;
  orgName: string | null;
  currency: string;
  posted: string | null;
  amount: string;
  payee: string | null;
  description: string | null;
  memo: string | null;
  category: string | null;
  categorySource: string;
  categoryConfidence: number | null;
  taxCategory: string | null;
  taxCategoryLabel: string;
  scope: string;
  accountScope: string;
  reviewedAt: string | null;
  note: string | null;
  suggestion: { category: string | null; taxCategory: string | null; confidence: number | null; by: string | null } | null;
}

interface Rule {
  id: string;
  match_field: string;
  match_type: string;
  pattern: string;
  category: string;
  tax_category: string | null;
  scope: string | null;
  hits: number;
}

interface SummaryLine {
  taxCategory: string;
  label: string;
  currency: string;
  total: string;
  rows: number;
  excluded: boolean;
  income: boolean;
}

type Tab = 'review' | 'rules' | 'summary';

const GUESSED_TZ = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = { ...(extra as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function readError(data: unknown, fallback: string): string {
  const err = (data as { error?: unknown } | null)?.error;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') return (err as { message: string }).message;
  return fallback;
}

export default function BooksContent() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('review');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // review queue
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [unreviewed, setUnreviewed] = useState(0);
  const [status, setStatus] = useState<'unreviewed' | 'reviewed' | 'all'>('unreviewed');
  const [scope, setScope] = useState<'all' | 'business' | 'personal'>('all');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [taxCategories, setTaxCategories] = useState<Array<{ id: string; label: string }>>([]);
  const [modelEnabled, setModelEnabled] = useState(false);
  const [edits, setEdits] = useState<Record<string, { category: string; taxCategory: string; scope: string; always: boolean }>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [categorizing, setCategorizing] = useState(false);
  const [job, setJob] = useState<{ id: string; status: string; result?: Record<string, unknown> | null } | null>(null);

  // rules
  const [rules, setRules] = useState<Rule[]>([]);

  // summary
  const currentYear = new Date().getFullYear();
  const [period, setPeriod] = useState(String(currentYear));
  const [summaryScope, setSummaryScope] = useState<'business' | 'personal' | 'all'>('business');
  const [summary, setSummary] = useState<{ lines: SummaryLine[]; totals: Array<{ currency: string; income: string; expenses: string; net: string; excluded: string }>; rows: number; unreviewed: number; uncategorized: number; notice: string; period: { label: string } } | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const PAGE = 50;

  const loadQueue = useCallback(async () => {
    if (!requireAuth(router)) return;
    const params = new URLSearchParams({ status, scope, limit: String(PAGE), offset: String(offset) });
    if (search.trim()) params.set('search', search.trim());
    const res = await fetch(`/api/finances/books/queue?${params.toString()}`, { headers: authHeaders(), cache: 'no-store' });
    const data = await res.json();
    if (res.status === 401 || res.status === 403) {
      setError('Your session has expired. Please log in again.');
      return;
    }
    if (!res.ok) throw new Error(readError(data, 'Could not load the queue'));
    setRows(data.rows);
    setTotal(data.total);
    setUnreviewed(data.unreviewed);
    setCategories(data.categories);
    setTaxCategories(data.taxCategories);
    setModelEnabled(data.modelEnabled === true);
    setEdits({});
    setSelected(new Set());
  }, [router, status, scope, search, offset]);

  const loadRules = useCallback(async () => {
    const res = await fetch('/api/finances/books/rules', { headers: authHeaders(), cache: 'no-store' });
    const data = await res.json();
    if (res.ok) setRules(data.rules ?? []);
  }, []);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const params = new URLSearchParams({ period, scope: summaryScope, timezone: GUESSED_TZ });
      const res = await fetch(`/api/finances/books/summary?${params.toString()}`, { headers: authHeaders(), cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(readError(data, 'Could not load the summary'));
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the summary');
    } finally {
      setSummaryLoading(false);
    }
  }, [period, summaryScope]);

  useEffect(() => {
    setLoading(true);
    loadQueue()
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the queue'))
      .finally(() => setLoading(false));
  }, [loadQueue]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  useEffect(() => {
    if (tab === 'summary') void loadSummary();
  }, [tab, loadSummary]);

  // Poll a running categorisation job.
  useEffect(() => {
    if (!job || ['completed', 'failed', 'cancelled', 'partial'].includes(job.status)) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/finances/jobs/${job.id}`, { headers: authHeaders(), cache: 'no-store' });
      const data = await res.json();
      if (res.ok) {
        setJob(data.job);
        if (['completed', 'failed'].includes(data.job.status)) {
          const r = data.job.result ?? {};
          setNotice(data.job.status === 'completed' ? `Categorisation finished: ${r.examined ?? 0} examined, ${r.fromRules ?? 0} by rule, ${r.fromModel ?? 0} by model, ${r.autoAccepted ?? 0} accepted, ${r.queued ?? 0} for review.` : `Categorisation failed: ${data.job.errorMessage ?? 'unknown error'}`);
          setCategorizing(false);
          void loadQueue();
        }
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [job, loadQueue]);

  const editFor = (r: Row) =>
    edits[r.id] ?? {
      category: r.category ?? r.suggestion?.category ?? '',
      taxCategory: r.taxCategory ?? r.suggestion?.taxCategory ?? 'uncategorized',
      scope: r.scope,
      always: false,
    };

  const setEdit = (id: string, patch: Partial<{ category: string; taxCategory: string; scope: string; always: boolean }>) => {
    setEdits((prev) => {
      const row = rows.find((r) => r.id === id);
      const base = row ? editFor(row) : { category: '', taxCategory: 'uncategorized', scope: 'personal', always: false };
      return { ...prev, [id]: { ...base, ...(prev[id] ?? {}), ...patch } };
    });
  };

  const confirm = async (r: Row) => {
    const e = editFor(r);
    setBusy(r.id);
    setError(null);
    try {
      const res = await fetch(`/api/finances/books/transactions/${r.id}`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ category: e.category || null, taxCategory: e.taxCategory, scope: e.scope, createRule: e.always }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(readError(data, 'Could not save'));
      setRows((prev) => (status === 'unreviewed' ? prev.filter((x) => x.id !== r.id) : prev.map((x) => (x.id === r.id ? data.transaction : x))));
      setUnreviewed((n) => Math.max(0, n - (r.reviewedAt ? 0 : 1)));
      if (e.always) void loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  const confirmSelected = async () => {
    if (selected.size === 0) return;
    setBusy('bulk');
    setError(null);
    try {
      const res = await fetch('/api/finances/books/bulk', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ids: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(readError(data, 'Could not save'));
      setNotice(`Confirmed ${data.reviewed} row(s) as suggested.`);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  const categorize = async () => {
    setCategorizing(true);
    setError(null);
    try {
      const res = await fetch('/api/finances/books/categorize', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ useModel: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(readError(data, 'Could not start categorisation'));
      setJob(data.job);
      setNotice(data.modelEnabled ? 'Auto-categorisation started (rules, heuristics, then the model).' : 'Auto-categorisation started with rules and heuristics. Set ANTHROPIC_API_KEY on the server to add the model pass.');
    } catch (err) {
      setCategorizing(false);
      setError(err instanceof Error ? err.message : 'Could not start categorisation');
    }
  };

  const deleteRule = async (rule: Rule) => {
    if (!window.confirm(`Delete the rule "${rule.pattern}" → ${rule.category}? Rows it already categorised keep their values.`)) return;
    const res = await fetch(`/api/finances/books/rules/${rule.id}`, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) setError(readError(await res.json().catch(() => null), 'Could not delete the rule'));
    await loadRules();
  };

  const download = async (format: string) => {
    try {
      const params = new URLSearchParams({ period, scope: summaryScope, timezone: GUESSED_TZ, format });
      const res = await fetch(`/api/finances/books/export?${params.toString()}`, { headers: authHeaders(), cache: 'no-store' });
      if (!res.ok) throw new Error(readError(await res.json().catch(() => null), `Export failed (HTTP ${res.status})`));
      const blob = await res.blob();
      const match = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = match ? match[1] : `books-${period}.${format}`;
      a.style.visibility = 'hidden';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const inputClass = 'rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-gray-200';
  const btnPrimary = 'rounded bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50';
  const btnSecondary = 'rounded border border-slate-600 px-3 py-2 text-sm text-gray-300 hover:bg-slate-800 disabled:opacity-50';
  const money = (v: string, c: string) => `${v} ${c}`;

  const confidenceTone = (r: Row) => {
    const c = r.categoryConfidence ?? r.suggestion?.confidence ?? 0;
    return c >= 0.9 ? 'text-emerald-300' : c >= 0.6 ? 'text-amber-300' : 'text-red-300';
  };

  const periodOptions = useMemo(() => {
    const opts: string[] = [];
    for (let y = currentYear; y >= currentYear - 3; y -= 1) {
      opts.push(String(y));
      for (let q = 4; q >= 1; q -= 1) opts.push(`${y}-Q${q}`);
    }
    return opts;
  }, [currentYear]);

  if (loading) return <div className="container mx-auto px-4 py-16 text-center text-gray-400">Loading the books…</div>;

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Books</h1>
          <p className="text-gray-400 mt-1">
            Every transaction gets a suggested category, tax bucket and business/personal scope. You confirm; a checkbox turns a correction into a rule.{' '}
            <Link href="/finances" className="text-purple-300 hover:underline">Back to finances</Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={categorize} disabled={categorizing} className={btnPrimary} title={modelEnabled ? 'Rules, heuristics, then the model' : 'Rules and heuristics (no model key configured)'}>
            {categorizing ? 'Categorising…' : 'Auto-categorise unreviewed'}
          </button>
        </div>
      </div>

      {notice && <div className="mb-4 rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div>}
      {error && <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      <div className="flex gap-1 mb-4">
        {(['review', 'rules', 'summary'] as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`rounded px-3 py-1 text-sm ${tab === t ? 'bg-purple-600 text-white' : 'border border-slate-700 text-gray-300'}`}>
            {t === 'review' ? `Review (${unreviewed} to go)` : t === 'rules' ? `Rules (${rules.length})` : 'Tax summary'}
          </button>
        ))}
      </div>

      {tab === 'review' && (
        <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <select value={status} onChange={(e) => { setOffset(0); setStatus(e.target.value as typeof status); }} className={inputClass}>
              <option value="unreviewed">Needs review</option>
              <option value="reviewed">Reviewed</option>
              <option value="all">All</option>
            </select>
            <select value={scope} onChange={(e) => { setOffset(0); setScope(e.target.value as typeof scope); }} className={inputClass}>
              <option value="all">Business and personal</option>
              <option value="business">Business accounts</option>
              <option value="personal">Personal accounts</option>
            </select>
            <input type="search" placeholder="Search payee, description" value={search} onChange={(e) => { setOffset(0); setSearch(e.target.value); }} className={`${inputClass} w-56`} />
            <span className="text-xs text-gray-500">{total.toLocaleString()} rows</span>
            <div className="ml-auto flex gap-2">
              <button type="button" className={btnSecondary} disabled={selected.size === 0 || busy === 'bulk'} onClick={confirmSelected}>
                Confirm {selected.size} selected as suggested
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-gray-400">
                <tr className="border-b border-slate-800">
                  <th className="px-2 py-2 text-left"><input type="checkbox" checked={selected.size > 0 && selected.size === rows.length} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
                  <th className="px-2 py-2 text-left">Date</th>
                  <th className="px-2 py-2 text-left">Payee / description</th>
                  <th className="px-2 py-2 text-left">Account</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="px-2 py-2 text-left">Category</th>
                  <th className="px-2 py-2 text-left">Tax category</th>
                  <th className="px-2 py-2 text-left">Scope</th>
                  <th className="px-2 py-2 text-left">Source</th>
                  <th className="px-2 py-2 text-left"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={10} className="px-2 py-6 text-center text-gray-500">{status === 'unreviewed' ? 'Nothing waiting for review.' : 'No rows.'}</td></tr>
                )}
                {rows.map((r) => {
                  const e = editFor(r);
                  return (
                    <tr key={r.id} className="border-b border-slate-800/60 align-top">
                      <td className="px-2 py-2"><input type="checkbox" checked={selected.has(r.id)} onChange={(ev) => { const next = new Set(selected); if (ev.target.checked) next.add(r.id); else next.delete(r.id); setSelected(next); }} /></td>
                      <td className="px-2 py-2 whitespace-nowrap text-gray-300">{(r.posted ?? '').slice(0, 10)}</td>
                      <td className="px-2 py-2 text-gray-100">
                        {r.payee || r.description || '(no description)'}
                        {r.payee && r.description && <div className="text-gray-500">{r.description}</div>}
                        {r.note && <div className="text-gray-500 italic">{r.note}</div>}
                      </td>
                      <td className="px-2 py-2 text-gray-400">{r.accountName}<div className="text-gray-600">{r.orgName}</div></td>
                      <td className={`px-2 py-2 text-right whitespace-nowrap ${r.amount.startsWith('-') ? 'text-gray-200' : 'text-emerald-300'}`}>{money(r.amount, r.currency)}</td>
                      <td className="px-2 py-2">
                        <select value={e.category} onChange={(ev) => setEdit(r.id, { category: ev.target.value })} className={inputClass}>
                          <option value="">(none)</option>
                          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <select value={e.taxCategory} onChange={(ev) => setEdit(r.id, { taxCategory: ev.target.value })} className={inputClass}>
                          {taxCategories.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <select value={e.scope} onChange={(ev) => setEdit(r.id, { scope: ev.target.value })} className={inputClass}>
                          <option value="business">business</option>
                          <option value="personal">personal</option>
                        </select>
                      </td>
                      <td className={`px-2 py-2 whitespace-nowrap ${confidenceTone(r)}`}>
                        {r.reviewedAt ? 'you' : (r.suggestion?.by ?? r.categorySource)} {r.reviewedAt ? '' : `${Math.round(((r.categoryConfidence ?? r.suggestion?.confidence ?? 0) as number) * 100)}%`}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        <label className="mr-2 text-gray-400"><input type="checkbox" className="mr-1" checked={e.always} onChange={(ev) => setEdit(r.id, { always: ev.target.checked })} disabled={!r.payee} title={r.payee ? `Always categorise "${r.payee}" this way` : 'No payee to build a rule from'} />always</label>
                        <button type="button" className="rounded bg-purple-600 px-2 py-1 text-xs text-white disabled:opacity-50" disabled={busy === r.id} onClick={() => confirm(r)}>
                          {busy === r.id ? '…' : r.reviewedAt ? 'Update' : 'Confirm'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {total > PAGE && (
            <div className="flex items-center justify-between mt-3 text-xs text-gray-400">
              <button type="button" className={btnSecondary} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>← Newer</button>
              <span>{offset + 1}–{Math.min(offset + PAGE, total)} of {total.toLocaleString()}</span>
              <button type="button" className={btnSecondary} disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Older →</button>
            </div>
          )}
        </section>
      )}

      {tab === 'rules' && (
        <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
          <p className="text-xs text-gray-500 mb-3">A rule matches the payee (or description) and sets the category, tax category and scope on every future sync. Created from the review queue with the "always" checkbox.</p>
          {rules.length === 0 && <p className="text-xs text-gray-500">No rules yet.</p>}
          <table className="w-full text-xs">
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b border-slate-800/60">
                  <td className="px-2 py-2 text-gray-300">{rule.match_field} {rule.match_type} <span className="text-gray-100">“{rule.pattern}”</span></td>
                  <td className="px-2 py-2 text-gray-300">{rule.category}</td>
                  <td className="px-2 py-2 text-gray-400">{rule.tax_category ?? '—'}</td>
                  <td className="px-2 py-2 text-gray-400">{rule.scope ?? 'account scope'}</td>
                  <td className="px-2 py-2 text-right"><button type="button" className="rounded border border-red-500/30 px-2 py-1 text-xs text-red-300" onClick={() => deleteRule(rule)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'summary' && (
        <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className={inputClass}>
              {periodOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={summaryScope} onChange={(e) => setSummaryScope(e.target.value as typeof summaryScope)} className={inputClass}>
              <option value="business">Business</option>
              <option value="personal">Personal</option>
              <option value="all">All</option>
            </select>
            <span className="text-xs text-gray-500">{GUESSED_TZ}</span>
            <div className="ml-auto flex gap-2">
              {['csv', 'pdf', 'html', 'json'].map((f) => (
                <button key={f} type="button" className={btnSecondary} onClick={() => download(f)}>{f.toUpperCase()}</button>
              ))}
            </div>
          </div>
          {summaryLoading && <p className="text-xs text-gray-500">Adding up…</p>}
          {summary && !summaryLoading && (
            <>
              <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 mb-3">{summary.notice}</div>
              <div className="grid gap-3 md:grid-cols-4 mb-4">
                {summary.totals.map((t) => (
                  <div key={t.currency} className="rounded border border-slate-800 p-3 text-sm">
                    <div className="text-gray-400 text-xs">{t.currency}</div>
                    <div className="text-emerald-300">Income {t.income}</div>
                    <div className="text-gray-200">Expenses {t.expenses}</div>
                    <div className="text-white font-semibold">Net {t.net}</div>
                    <div className="text-gray-500 text-xs">Excluded {t.excluded}</div>
                  </div>
                ))}
                {summary.totals.length === 0 && <div className="text-xs text-gray-500">No posted rows in this period and scope.</div>}
              </div>
              <table className="w-full text-xs">
                <thead className="text-gray-400"><tr className="border-b border-slate-800"><th className="px-2 py-2 text-left">Tax category</th><th className="px-2 py-2 text-left">Currency</th><th className="px-2 py-2 text-right">Total</th><th className="px-2 py-2 text-right">Rows</th></tr></thead>
                <tbody>
                  {summary.lines.map((l) => (
                    <tr key={`${l.taxCategory}-${l.currency}`} className={`border-b border-slate-800/60 ${l.excluded ? 'text-gray-500' : 'text-gray-200'}`}>
                      <td className="px-2 py-2">{l.label}</td>
                      <td className="px-2 py-2">{l.currency}</td>
                      <td className="px-2 py-2 text-right">{l.total}</td>
                      <td className="px-2 py-2 text-right">{l.rows}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-gray-500 mt-3">{summary.rows} rows · {summary.unreviewed} unreviewed · {summary.uncategorized} uncategorised. Confirm the queue to tighten these numbers before exporting.</p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
