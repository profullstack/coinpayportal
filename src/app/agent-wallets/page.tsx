'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

const periods = ['hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'total'] as const;
type Agent = { id: string; name: string; address: string; status: string; limits: Record<string, number | null>; spent: Record<string, number>; remainingUsd: number | null };

export default function AgentWalletsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [businesses, setBusinesses] = useState<{ id: string; name: string }[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [form, setForm] = useState({ name: '', address: '', perPaymentLimitUsd: '25', monthlyLimitUsd: '100', totalLimitUsd: '100' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const result = await authFetch(`/api/dashboard/agent-wallets${businessId ? `?business_id=${businessId}` : ''}`, {}, router);
    if (!result) return;
    if (!result.response.ok) setError(result.data.error || 'Could not load agent wallets');
    else { setAgents(result.data.agents || []); setBusinesses(result.data.businesses || []); setBusinessId((v) => v || result.data.businessId || ''); }
    setLoading(false);
  }, [businessId, router]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setError('');
    const body: Record<string, unknown> = { businessId, name: form.name, address: form.address, status: 'active', perPaymentLimitUsd: Number(form.perPaymentLimitUsd), monthlyLimitUsd: Number(form.monthlyLimitUsd), totalLimitUsd: Number(form.totalLimitUsd) };
    const result = await authFetch('/api/dashboard/agent-wallets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, router);
    if (!result) return;
    if (!result.response.ok) setError(result.data.error || 'Could not create agent wallet'); else { setForm({ ...form, name: '', address: '' }); load(); }
  }

  async function setStatus(agent: Agent, status: string) {
    await authFetch(`/api/dashboard/agent-wallets/${agent.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }, router); load();
  }

  return <main className="min-h-screen bg-gray-50 px-4 py-8 text-gray-900 dark:bg-gray-950 dark:text-gray-100 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-purple-600 dark:text-purple-400">Spend controls</div><h1 className="text-3xl font-bold tracking-tight">Agent Spend Wallets</h1><p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-400">Issue each bot a capped spending identity. Your parent account stays protected if an agent key is compromised.</p></div>
        <Link href="/dashboard" className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">← Dashboard</Link>
      </div>
      {error && <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
      {businesses.length > 1 && <label className="mb-6 block max-w-sm text-sm font-medium text-gray-700 dark:text-gray-300">Business<select value={businessId} onChange={(e) => setBusinessId(e.target.value)} className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm shadow-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
      <form onSubmit={create} className="mb-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-6">
        <div className="mb-5"><h2 className="text-lg font-semibold">Create a capped wallet</h2><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Set the maximum damage this agent can cause. Limits are enforced before settlement.</p></div>
        <div className="grid gap-4 md:grid-cols-3"><label className="text-sm font-medium text-gray-700 dark:text-gray-300">Agent name<input required placeholder="research-bot-01" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 font-normal text-gray-900 outline-none placeholder:text-gray-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" /></label><label className="text-sm font-medium text-gray-700 dark:text-gray-300 md:col-span-2">EVM wallet address<input required placeholder="0x..." value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 font-mono text-sm font-normal text-gray-900 outline-none placeholder:text-gray-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" /></label></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3"><label className="text-sm font-medium text-gray-700 dark:text-gray-300">Per transaction<input type="number" min="0.01" step="0.01" value={form.perPaymentLimitUsd} onChange={(e) => setForm({ ...form, perPaymentLimitUsd: e.target.value })} className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 font-normal dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" /></label><label className="text-sm font-medium text-gray-700 dark:text-gray-300">Monthly maximum<input type="number" min="0.01" step="0.01" value={form.monthlyLimitUsd} onChange={(e) => setForm({ ...form, monthlyLimitUsd: e.target.value })} className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 font-normal dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" /></label><label className="text-sm font-medium text-gray-700 dark:text-gray-300">Lifetime maximum<input type="number" min="0.01" step="0.01" value={form.totalLimitUsd} onChange={(e) => setForm({ ...form, totalLimitUsd: e.target.value })} className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 font-normal dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" /></label></div>
        <div className="mt-5 flex justify-end"><button className="rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500/40">Create capped wallet</button></div>
      </form>
      {loading ? <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">Loading agent wallets…</div> : agents.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center dark:border-gray-700"><div className="text-3xl">🛡️</div><h2 className="mt-3 font-semibold">No capped wallets yet</h2><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Create one above before giving an agent access to money.</p></div> : <div className="space-y-4">{agents.map((agent) => <div key={agent.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex items-center gap-3"><h2 className="truncate font-semibold">{agent.name}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${agent.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : agent.status === 'paused' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>{agent.status}</span></div><p className="mt-2 break-all font-mono text-xs text-gray-500 dark:text-gray-400">{agent.address}</p></div><div className="text-left sm:text-right"><div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Available allowance</div><div className="mt-1 text-xl font-bold text-purple-700 dark:text-purple-300">{agent.remainingUsd == null ? 'Unlimited' : `$${agent.remainingUsd.toFixed(2)}`}</div></div></div><div className="mt-5 flex flex-wrap gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">{agent.status === 'active' ? <button onClick={() => setStatus(agent, 'paused')} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">Pause wallet</button> : agent.status === 'paused' && <button onClick={() => setStatus(agent, 'active')} className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40">Resume wallet</button>}{agent.status !== 'revoked' && <button onClick={() => setStatus(agent, 'revoked')} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40">Revoke wallet</button>}</div></div>)}</div>}
    </div>
  </main>;
}
