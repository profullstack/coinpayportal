'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface Project {
  id: string;
  name: string;
  hourly_rate: number | null;
  currency: string;
  budget_hours: number | null;
  clients: { name: string | null; company_name: string | null } | null;
}

interface Entry {
  id: string;
  description: string;
  started_at: string;
  minutes: number | null;
  billable: boolean;
  hourly_rate: number | null;
  invoice_id: string | null;
}
interface Stats {
  hours: number;
  billable_hours: number;
  unbilled_amount: number;
  billed_amount: number;
  paid_amount: number;
}

const input = 'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm';

const hm = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;

export default function ProjectPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [log, setLog] = useState({ description: '', hours: '', minutes: '', billable: true });
  const [timerNote, setTimerNote] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState<{ ok: boolean; text: string; href?: string } | null>(null);

  const load = useCallback(async () => {
    const [p, e] = await Promise.all([
      authFetch(`/api/projects/${id}`, {}, router),
      authFetch(`/api/time-entries?project_id=${id}`, {}, router),
    ]);
    if (p?.data.success) {
      setProject(p.data.project);
      setStats(p.data.stats);
    }
    setEntries(e?.data.success ? e.data.time_entries ?? [] : []);
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  const running = entries.find((e) => e.minutes == null);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const call = async (url: string, method: string, body?: unknown) => {
    setMessage(null);
    const result = await authFetch(
      url,
      { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) },
      router
    );
    if (!result?.data.success) {
      setMessage({ ok: false, text: result?.data.error || 'Request failed' });
      return null;
    }
    await load();
    return result.data;
  };

  const startTimer = () => call('/api/time-entries', 'POST', { project_id: id, start: true, description: timerNote });
  const stopTimer = () => running && call(`/api/time-entries/${running.id}`, 'PATCH', { stop: true });

  const logTime = async (e: React.FormEvent) => {
    e.preventDefault();
    const minutes = Math.round(Number(log.hours || 0) * 60 + Number(log.minutes || 0));
    if (minutes < 1) {
      setMessage({ ok: false, text: 'Enter some hours or minutes' });
      return;
    }
    const ok = await call('/api/time-entries', 'POST', {
      project_id: id,
      minutes,
      description: log.description,
      billable: log.billable,
    });
    if (ok) setLog({ description: '', hours: '', minutes: '', billable: true });
  };

  const invoice = async () => {
    const data = await call(`/api/projects/${id}/invoice`, 'POST', {});
    if (data) {
      setMessage({
        ok: true,
        text: `Draft ${data.invoice.invoice_number} created from ${data.entries_billed} entries.`,
        href: `/invoices/${data.invoice.id}`,
      });
    }
  };

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: project?.currency || 'USD' }).format(n);

  if (!project) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div>
      </div>
    );
  }

  const elapsed = running ? Math.max(0, Math.floor((now - new Date(running.started_at).getTime()) / 1000)) : 0;
  const overBudget = project.budget_hours && stats ? stats.hours > Number(project.budget_hours) : false;

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <Link href="/projects" className="text-purple-400 hover:text-purple-300 text-sm mb-4 inline-block">
            ← Projects
          </Link>
          <h1 className="text-3xl font-bold text-white">{project.name}</h1>
          <p className="mt-1 text-gray-400">
            {project.clients?.company_name || project.clients?.name || 'No client'}
            {project.hourly_rate != null ? ` · ${fmt(Number(project.hourly_rate))}/hr` : ' · no hourly rate set'}
          </p>
        </div>

        {message && (
          <div className={`px-4 py-3 rounded-lg border ${message.ok ? 'bg-green-500/10 border-green-500/30 text-green-300' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
            {message.text}{' '}
            {message.href && (
              <Link href={message.href} className="underline">
                Review and send it
              </Link>
            )}
          </div>
        )}

        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="project-stats">
            {[
              ['Hours', `${stats.hours}${project.budget_hours ? ` / ${project.budget_hours}` : ''}`],
              ['Unbilled', fmt(stats.unbilled_amount)],
              ['Billed', fmt(stats.billed_amount)],
              ['Paid', fmt(stats.paid_amount)],
            ].map(([label, value]) => (
              <div key={label} className="bg-gray-800/50 rounded-xl border border-gray-700 p-4">
                <p className="text-xs text-gray-400">{label}</p>
                <p className={`text-lg font-semibold ${label === 'Hours' && overBudget ? 'text-red-400' : 'text-white'}`}>{value}</p>
              </div>
            ))}
          </div>
        )}

        <section className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6 space-y-3">
          <h2 className="text-lg font-semibold text-white">Timer</h2>
          {running ? (
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-3xl font-mono text-white" data-testid="timer">
                {String(Math.floor(elapsed / 3600)).padStart(2, '0')}:{String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')}:
                {String(elapsed % 60).padStart(2, '0')}
              </span>
              <span className="text-gray-400 text-sm">{running.description}</span>
              <button onClick={stopTimer} className="ml-auto px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg">
                Stop
              </button>
            </div>
          ) : (
            <div className="flex gap-3">
              <input aria-label="Timer description" value={timerNote} onChange={(e) => setTimerNote(e.target.value)} placeholder="What are you working on?" className={input} />
              <button onClick={startTimer} className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-lg whitespace-nowrap">
                Start timer
              </button>
            </div>
          )}
        </section>

        <form onSubmit={logTime} className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6 grid grid-cols-2 sm:grid-cols-6 gap-3 items-end">
          <label className="text-sm text-gray-300 col-span-2 sm:col-span-3">
            Log time
            <input aria-label="Log description" value={log.description} onChange={(e) => setLog({ ...log, description: e.target.value })} placeholder="Description" className={`${input} mt-1`} />
          </label>
          <label className="text-sm text-gray-300">
            Hours
            <input aria-label="Log hours" type="number" min="0" step="1" value={log.hours} onChange={(e) => setLog({ ...log, hours: e.target.value })} className={`${input} mt-1`} />
          </label>
          <label className="text-sm text-gray-300">
            Minutes
            <input aria-label="Log minutes" type="number" min="0" max="59" value={log.minutes} onChange={(e) => setLog({ ...log, minutes: e.target.value })} className={`${input} mt-1`} />
          </label>
          <button type="submit" className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg">
            Add
          </button>
          <label className="col-span-2 sm:col-span-6 flex items-center gap-2 text-sm text-gray-400">
            <input type="checkbox" checked={log.billable} onChange={(e) => setLog({ ...log, billable: e.target.checked })} />
            Billable
          </label>
        </form>

        <section className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Time entries</h2>
            <button
              onClick={invoice}
              disabled={!stats || stats.unbilled_amount <= 0}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg disabled:opacity-40"
            >
              Invoice unbilled time
            </button>
          </div>
          {entries.length === 0 ? (
            <p className="text-sm text-gray-500">No time logged yet.</p>
          ) : (
            <ul className="divide-y divide-gray-700">
              {entries.map((e) => (
                <li key={e.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-white">{e.description || <span className="text-gray-500">No description</span>}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(e.started_at).toLocaleDateString()}
                      {!e.billable && ' · not billable'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-gray-200">{e.minutes == null ? 'running' : hm(e.minutes)}</span>
                    {e.invoice_id ? (
                      <Link href={`/invoices/${e.invoice_id}`} className="text-green-400 hover:text-green-300 text-xs">
                        invoiced
                      </Link>
                    ) : (
                      e.minutes != null && (
                        <button onClick={() => call(`/api/time-entries/${e.id}`, 'DELETE')} className="text-gray-500 hover:text-red-400 text-xs">
                          delete
                        </button>
                      )
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
