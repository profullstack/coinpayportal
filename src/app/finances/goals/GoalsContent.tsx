'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { requireAuth } from '@/lib/auth/client';

/**
 * /finances/goals — what the owner is saving toward or paying off.
 *
 * Each goal has a target and a deadline. Linked accounts (bank, card and
 * loan feeds) and CoinPay web wallets move progress on their own; manual
 * contributions cover the rest. The report tabs show the trailing day, week,
 * month or quarter: what changed, whether it kept pace, and what each goal
 * needs per month from here. The goals report email is opt-in, at the same
 * four cadences. Nothing here moves money and none of it is advice.
 */

type Period = 'daily' | 'weekly' | 'monthly' | 'quarterly';
type Status = 'achieved' | 'on_track' | 'behind' | 'overdue';

interface Snapshot {
  progress: number;
  remaining: number;
  percent: number;
  expectedByNow: number;
  status: Status;
  daysLeft: number;
  required: { perDay: number; perWeek: number; perMonth: number; perQuarter: number };
  recentPerMonth: number | null;
  projectedDate: string | null;
  exact: boolean;
}

interface GoalRow {
  id: string;
  name: string;
  kind: string;
  targetAmount: number;
  currency: string;
  startDate: string;
  deadline: string;
  startingAmount: number | null;
  linkedAccountIds: string[];
  linkedWalletIds: string[];
  notes: string | null;
  archivedAt: string | null;
  direction: 'save' | 'payoff';
  snapshot: Snapshot;
  sources?: Source[];
  linked: { accounts: Array<{ id: string; name: string; balance: number | null }>; walletsUsd: number; walletsPriced: boolean };
}

interface Source {
  type: 'account' | 'wallets' | 'contributions' | 'starting';
  id: string | null;
  name: string;
  institution: string | null;
  kind: string | null;
  amount: number;
  asOf: string | null;
  stale: boolean;
  counted: boolean;
}

interface GoalForm {
  name: string;
  kind: string;
  targetAmount: string;
  deadline: string;
  startDate: string;
  startingAmount: string;
  notes: string;
  accounts: string[];
  wallets: string[];
}

const EMPTY_FORM: GoalForm = { name: '', kind: 'house', targetAmount: '', deadline: '', startDate: '', startingAmount: '', notes: '', accounts: [], wallets: [] };

interface ReportLine {
  goal: { id: string; name: string; currency: string };
  change: number;
  neededThisPeriod: number;
  pace: 'ahead' | 'on_pace' | 'short' | 'done';
  snapshot: Snapshot;
}

interface Sources {
  accounts: Array<{ id: string; name: string; institution: string | null; liability: boolean; currency: string; balance: number | null; asOf?: string | null; hidden?: boolean }>;
  wallets: Array<{ walletId: string; label: string | null }>;
}

interface Schedule {
  active: boolean;
  cadence?: Period;
  hour: number;
  recipients: string[];
  nextRunAt: string | null;
}

const KINDS: Array<[string, string]> = [
  ['house', 'Buy a house'],
  ['car', 'Buy a car'],
  ['emergency_fund', 'Emergency fund'],
  ['debt_payoff', 'Pay off debt'],
  ['custom', 'Custom'],
];
const KIND_LABEL = Object.fromEntries(KINDS);
const STATUS: Record<Status, { label: string; cls: string; bar: string }> = {
  achieved: { label: 'Achieved', cls: 'text-emerald-400', bar: 'bg-emerald-500' },
  on_track: { label: 'On track', cls: 'text-emerald-400', bar: 'bg-emerald-500' },
  behind: { label: 'Behind', cls: 'text-amber-400', bar: 'bg-amber-500' },
  overdue: { label: 'Past deadline', cls: 'text-red-400', bar: 'bg-red-500' },
};
const PACE: Record<ReportLine['pace'], string> = { ahead: 'Ahead of pace', on_pace: 'On pace', short: 'Short of pace', done: 'Done' };
const PERIODS: Period[] = ['daily', 'weekly', 'monthly', 'quarterly'];
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

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${Math.round(n)} ${currency}`;
  }
}

const inputCls = 'w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white';

export default function GoalsContent() {
  const router = useRouter();
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [disclaimer, setDisclaimer] = useState('');
  const [period, setPeriod] = useState<Period>('monthly');
  const [report, setReport] = useState<{ from: string; to: string; goals: ReportLine[] } | null>(null);
  const [sources, setSources] = useState<Sources>({ accounts: [], wallets: [] });
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<GoalRow | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [openSources, setOpenSources] = useState<string | null>(null);
  const [form, setForm] = useState<GoalForm>(EMPTY_FORM);
  const [contribFor, setContribFor] = useState<string | null>(null);
  const [contrib, setContrib] = useState({ amount: '', note: '' });
  const [cadence, setCadence] = useState<Period>('weekly');

  const load = useCallback(async () => {
    if (!requireAuth(router)) return;
    setError('');
    const res = await fetch(`/api/finances/goals${showArchived ? '?archived=1' : ''}`, { headers: authHeaders(), cache: 'no-store' });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(readError(data, 'Could not load goals'));
      setLoading(false);
      return;
    }
    setGoals(data.goals ?? []);
    setDisclaimer(data.disclaimer ?? '');
    setLoading(false);
  }, [router, showArchived]);

  const loadReport = useCallback(async (p: Period) => {
    const res = await fetch(`/api/finances/goals/report?period=${p}`, { headers: authHeaders(), cache: 'no-store' });
    const data = await res.json().catch(() => null);
    if (res.ok) setReport(data.report);
  }, []);

  useEffect(() => {
    load();
    fetch('/api/finances/goals/sources', { headers: authHeaders(), cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSources(d))
      .catch(() => null);
    fetch('/api/finances/email-schedules?kind=goals_digest', { headers: authHeaders(), cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.schedule) {
          setSchedule(d.schedule);
          if (d.schedule.cadence) setCadence(d.schedule.cadence);
        }
      })
      .catch(() => null);
  }, [load]);

  useEffect(() => {
    loadReport(period);
  }, [period, loadReport, goals]);

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  function openEdit(g: GoalRow) {
    setEditing(g);
    setShowForm(true);
    setForm({
      name: g.name,
      kind: g.kind,
      targetAmount: String(g.targetAmount),
      deadline: g.deadline,
      startDate: g.startDate,
      startingAmount: g.startingAmount === null ? '' : String(g.startingAmount),
      notes: g.notes ?? '',
      accounts: g.linkedAccountIds,
      wallets: g.linkedWalletIds,
    });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveGoal(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    const body: Record<string, unknown> = {
      name: form.name,
      kind: form.kind,
      deadline: form.deadline,
      linkedAccountIds: form.accounts,
      linkedWalletIds: form.kind === 'debt_payoff' ? [] : form.wallets,
      notes: form.notes.trim() || null,
    };
    if (form.targetAmount) body.targetAmount = form.targetAmount;
    if (form.startingAmount) body.startingAmount = form.startingAmount;
    else if (editing) body.startingAmount = null;
    if (editing && form.startDate) body.startDate = form.startDate;
    const res = editing
      ? await fetch(`/api/finances/goals/${editing.id}`, { method: 'PATCH', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) })
      : await fetch('/api/finances/goals', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) return setError(readError(data, editing ? 'Could not save the goal' : 'Could not create the goal'));
    if (editing) setNotice(`Saved "${form.name}".`);
    closeForm();
    await load();
  }

  async function setArchived(goal: GoalRow, archived: boolean) {
    setError('');
    const res = await fetch(`/api/finances/goals/${goal.id}`, { method: 'PATCH', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ archived }) });
    if (!res.ok) return setError(readError(await res.json().catch(() => null), archived ? 'Could not archive' : 'Could not unarchive'));
    setNotice(archived ? `Archived "${goal.name}". It is hidden and left out of reports.` : `"${goal.name}" is active again.`);
    await load();
  }

  async function addContribution(goalId: string) {
    setError('');
    const res = await fetch(`/api/finances/goals/${goalId}/contributions`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ amount: contrib.amount, note: contrib.note || undefined }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return setError(readError(data, 'Could not record that'));
    setContribFor(null);
    setContrib({ amount: '', note: '' });
    await load();
  }

  async function removeGoal(goal: GoalRow) {
    if (!confirm(`Delete "${goal.name}" and its recorded contributions?`)) return;
    const res = await fetch(`/api/finances/goals/${goal.id}`, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) return setError(readError(await res.json().catch(() => null), 'Could not delete'));
    await load();
  }

  async function saveSchedule(active: boolean) {
    setError('');
    setNotice('');
    const res = active
      ? await fetch('/api/finances/email-schedules', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ kind: 'goals_digest', cadence, timezone: GUESSED_TZ, active: true }) })
      : await fetch('/api/finances/email-schedules?kind=goals_digest', { method: 'DELETE', headers: authHeaders() });
    const data = await res.json().catch(() => null);
    if (!res.ok) return setError(readError(data, 'Could not save the email setting'));
    setSchedule(active ? data.schedule : null);
    setNotice(active ? `Goals report on: ${cadence}.` : 'Goals report off.');
  }

  async function sendNow() {
    setNotice('');
    const res = await fetch('/api/finances/email-schedules/send-now?kind=goals_digest', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: '{}' });
    const data = await res.json().catch(() => null);
    if (!res.ok) return setError(readError(data, 'Could not send'));
    setNotice(`Sent to ${(data.sent ?? []).join(', ')}.`);
  }

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  // Hidden accounts only appear when this goal already counts them, so they can be unticked.
  const linkable = sources.accounts.filter((a) => (form.kind === 'debt_payoff' ? a.liability : !a.liability) && (!a.hidden || form.accounts.includes(a.id)));
  const linkableWallets = form.kind === 'debt_payoff' ? [] : sources.wallets;
  const allChecked = linkable.length + linkableWallets.length > 0 && linkable.every((a) => form.accounts.includes(a.id)) && linkableWallets.every((w) => form.wallets.includes(w.walletId));
  const checkAll = (on: boolean) => setForm({ ...form, accounts: on ? linkable.map((a) => a.id) : [], wallets: on ? linkableWallets.map((w) => w.walletId) : [] });
  const selectedTotal = linkable.filter((a) => form.accounts.includes(a.id) && a.balance !== null && a.currency === 'USD').reduce((s, a) => s + (a.balance ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 text-gray-200">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/finances" className="text-sm text-gray-400 hover:text-white">&larr; Finances</Link>
          <h1 className="text-2xl font-bold text-white">Goals</h1>
          <p className="text-sm text-gray-400">Save for a house or a car, build an emergency fund, pay off a debt. Progress follows linked balances or what you record.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-sm text-gray-300">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
          <button onClick={() => (showForm ? closeForm() : setShowForm(true))} className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500">
            {showForm ? 'Cancel' : 'New goal'}
          </button>
        </div>
      </div>

      {error && <p className="mb-4 rounded border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
      {notice && <p className="mb-4 rounded border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-300">{notice}</p>}

      {showForm && (
        <form onSubmit={saveGoal} className="mb-8 grid gap-3 rounded border border-slate-700 bg-slate-800/50 p-4 sm:grid-cols-2">
          <h2 className="font-semibold text-white sm:col-span-2">{editing ? `Edit "${editing.name}"` : 'New goal'}</h2>
          <label className="text-sm">Name<input className={inputCls} required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Down payment" /></label>
          <label className="text-sm">Kind
            <select className={inputCls} value={form.kind} onChange={(e) => setForm((e.target.value === 'debt_payoff') === (form.kind === 'debt_payoff') ? { ...form, kind: e.target.value } : { ...form, kind: e.target.value, accounts: [], wallets: [] })}>
              {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="text-sm">{form.kind === 'debt_payoff' ? 'Debt to pay off (blank: what linked accounts owe now)' : 'Target amount (USD)'}
            <input className={inputCls} inputMode="decimal" value={form.targetAmount} onChange={(e) => setForm({ ...form, targetAmount: e.target.value })} placeholder="60000" required={form.kind !== 'debt_payoff'} />
          </label>
          {editing && <label className="text-sm">Start date<input className={inputCls} type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>}
          <label className="text-sm">Deadline<input className={inputCls} type="date" required value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></label>
          {form.accounts.length === 0 && form.wallets.length === 0 && form.kind !== 'debt_payoff' && (
            <label className="text-sm">Already saved (optional)<input className={inputCls} inputMode="decimal" value={form.startingAmount} onChange={(e) => setForm({ ...form, startingAmount: e.target.value })} placeholder="0" /></label>
          )}
          <fieldset className="text-sm sm:col-span-2">
            <legend className="mb-1 text-gray-400">{form.kind === 'debt_payoff' ? 'Link the debt accounts (cards, loans)' : 'Link accounts or wallets that hold this money'} (optional). Only ticked ones count.</legend>
            {linkable.length === 0 && linkableWallets.length === 0 && <p className="text-xs text-gray-500">Nothing to link yet; progress will come from what you record.</p>}
            {linkable.length + linkableWallets.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1 rounded border border-slate-500 px-2 py-1 font-medium">
                  <input type="checkbox" aria-label="Check all" checked={allChecked} onChange={(e) => checkAll(e.target.checked)} /> Check all
                </label>
                <button type="button" onClick={() => checkAll(false)} className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-700">None</button>
                <span className="text-gray-400">{form.accounts.length + form.wallets.length} selected{form.accounts.length ? ` · accounts ${money(selectedTotal, 'USD')}${form.kind === 'debt_payoff' ? ' owed' : ''}` : ''}</span>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {linkable.map((a) => (
                <label key={a.id} className="flex items-center gap-1 rounded border border-slate-600 px-2 py-1">
                  <input type="checkbox" checked={form.accounts.includes(a.id)} onChange={() => setForm({ ...form, accounts: toggle(form.accounts, a.id) })} />
                  {a.institution ? `${a.institution} · ` : ''}{a.name}{a.balance !== null ? ` (${money(a.balance, a.currency)})` : ''}{a.hidden ? ' · hidden' : ''}
                </label>
              ))}
              {linkableWallets.map((w) => (
                <label key={w.walletId} className="flex items-center gap-1 rounded border border-slate-600 px-2 py-1">
                  <input type="checkbox" checked={form.wallets.includes(w.walletId)} onChange={() => setForm({ ...form, wallets: toggle(form.wallets, w.walletId) })} />
                  Wallet {w.label ?? w.walletId.slice(0, 8)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="text-sm sm:col-span-2">Notes (optional)<textarea className={inputCls} maxLength={500} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500">{editing ? 'Save changes' : 'Create goal'}</button>
            {editing && <button type="button" onClick={closeForm} className="rounded border border-slate-600 px-4 py-2 text-sm hover:bg-slate-700">Cancel</button>}
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : goals.length === 0 ? (
        <p className="rounded border border-slate-700 p-6 text-center text-gray-400">No goals yet. Create one to see daily, weekly, monthly and quarterly progress.</p>
      ) : (
        <div className="mb-8 grid gap-4 md:grid-cols-2">
          {goals.map((g) => {
            const s = g.snapshot;
            const st = STATUS[s.status];
            return (
              <div key={g.id} className={`rounded border border-slate-700 bg-slate-800/50 p-4${g.archivedAt ? ' opacity-70' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-semibold text-white">{g.name}{g.archivedAt && <span className="ml-2 rounded bg-slate-700 px-1.5 py-0.5 text-xs font-normal text-gray-300">Archived</span>}</h2>
                    <p className="text-xs text-gray-400">{KIND_LABEL[g.kind] ?? g.kind} · by {g.deadline} · {s.daysLeft >= 0 ? `${s.daysLeft} days left` : `${-s.daysLeft} days past`}</p>
                  </div>
                  <span className={`text-sm font-medium ${st.cls}`}>{st.label}</span>
                </div>
                <div className="mt-3 h-2 w-full rounded bg-slate-700"><div className={`h-2 rounded ${st.bar}`} style={{ width: `${s.percent}%` }} /></div>
                <p className="mt-2 text-sm">{money(s.progress, g.currency)} of {money(g.targetAmount, g.currency)} <span className="text-gray-400">({s.percent}%{g.direction === 'payoff' ? ' paid off' : ''})</span></p>
                {s.status !== 'achieved' && (
                  <p className="text-sm text-gray-300">To finish on time: <strong>{money(s.required.perMonth, g.currency)}/month</strong> · {money(s.required.perWeek, g.currency)}/week</p>
                )}
                {s.recentPerMonth !== null && (
                  <p className="text-xs text-gray-400">Last 90 days: {money(s.recentPerMonth, g.currency)}/month{s.projectedDate ? `, lands ${s.projectedDate} at that pace` : ''}</p>
                )}
                {g.sources && g.sources.length > 0 && (
                  <div className="mt-2 text-xs">
                    <button type="button" onClick={() => setOpenSources(openSources === g.id ? null : g.id)} className="text-gray-400 underline decoration-dotted hover:text-white" aria-expanded={openSources === g.id}>
                      {openSources === g.id ? 'Hide' : 'Show'} what makes up {money(s.progress, g.currency)} ({g.sources.length} source{g.sources.length === 1 ? '' : 's'}{g.sources.some((x) => x.stale) ? ', some balances out of date' : ''})
                    </button>
                    {openSources === g.id && (
                      <table className="mt-1 w-full">
                        <tbody>
                          {g.sources.map((src, i) => (
                            <tr key={`${src.type}-${src.id ?? i}`} className="border-t border-slate-700/60">
                              <td className="py-0.5 pr-2 text-gray-300">{src.institution && src.type === 'account' ? `${src.institution} · ` : ''}{src.name}{src.kind && src.type === 'account' ? <span className="text-gray-500"> ({src.kind})</span> : null}</td>
                              <td className={`py-0.5 pr-2 text-right ${src.amount < 0 ? 'text-red-300' : 'text-gray-200'}`}>{src.counted ? money(src.amount, g.currency) : 'not counted'}</td>
                              <td className="py-0.5 text-right text-amber-400">{src.stale && src.asOf ? `as of ${src.asOf.slice(0, 10)}` : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {!g.archivedAt && <button onClick={() => setContribFor(contribFor === g.id ? null : g.id)} className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-700">{g.direction === 'payoff' ? 'Record a payment' : 'Record a contribution'}</button>}
                  <button onClick={() => openEdit(g)} className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-700">Edit</button>
                  <button onClick={() => setArchived(g, !g.archivedAt)} className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-700">{g.archivedAt ? 'Unarchive' : 'Archive'}</button>
                  <button onClick={() => removeGoal(g)} className="rounded border border-slate-600 px-2 py-1 text-red-300 hover:bg-slate-700">Delete</button>
                </div>
                {contribFor === g.id && (
                  <div className="mt-2 flex gap-2">
                    <input className={inputCls} inputMode="decimal" placeholder="Amount (negative = withdrawal)" value={contrib.amount} onChange={(e) => setContrib({ ...contrib, amount: e.target.value })} />
                    <input className={inputCls} placeholder="Note" value={contrib.note} onChange={(e) => setContrib({ ...contrib, note: e.target.value })} />
                    <button onClick={() => addContribution(g.id)} className="rounded bg-purple-600 px-3 text-sm text-white">Save</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <section className="mb-8 rounded border border-slate-700 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Progress report</h2>
          <div className="flex gap-1" role="tablist">
            {PERIODS.map((p) => (
              <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)} className={`rounded px-3 py-1 text-sm capitalize ${period === p ? 'bg-purple-600 text-white' : 'border border-slate-600 text-gray-300 hover:bg-slate-800'}`}>{p}</button>
            ))}
          </div>
        </div>
        {report && <p className="mb-2 text-xs text-gray-400">{report.from} to {report.to}</p>}
        {report && report.goals.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-400"><th className="py-1 pr-2">Goal</th><th className="pr-2">Change</th><th className="pr-2">Needed</th><th className="pr-2">Pace</th><th>Status</th></tr></thead>
              <tbody>
                {report.goals.map((l) => (
                  <tr key={l.goal.id} className="border-t border-slate-700">
                    <td className="py-1 pr-2">{l.goal.name}</td>
                    <td className="pr-2">{l.change >= 0 ? '+' : ''}{money(l.change, l.goal.currency)}</td>
                    <td className="pr-2">{money(l.neededThisPeriod, l.goal.currency)}</td>
                    <td className="pr-2">{PACE[l.pace]}</td>
                    <td className={STATUS[l.snapshot.status].cls}>{STATUS[l.snapshot.status].label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No goals to report on yet.</p>
        )}
      </section>

      <section id="goals-report" className="mb-6 rounded border border-slate-700 p-4">
        <h2 className="text-lg font-semibold text-white">Goals report by email</h2>
        <p className="mb-3 text-sm text-gray-400">Off unless you turn it on. Goes to your account email; each one has a one-click unsubscribe.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select className="rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm" value={cadence} onChange={(e) => setCadence(e.target.value as Period)}>
            {PERIODS.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>
          <button onClick={() => saveSchedule(true)} className="rounded bg-purple-600 px-4 py-2 text-sm text-white hover:bg-purple-500">{schedule?.active ? 'Save' : 'Turn on'}</button>
          {schedule?.active && <button onClick={() => saveSchedule(false)} className="rounded border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800">Turn off</button>}
          {schedule?.active && <button onClick={sendNow} className="rounded border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800">Send one now</button>}
        </div>
        {schedule?.active && schedule.nextRunAt && <p className="mt-2 text-xs text-gray-400">Next: {new Date(schedule.nextRunAt).toLocaleString()} ({schedule.cadence})</p>}
      </section>

      <p className="text-xs text-gray-500">{disclaimer}</p>
    </div>
  );
}
