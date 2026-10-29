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

  return <main className="max-w-6xl mx-auto px-4 py-8">
    <div className="flex justify-between items-start mb-8"><div><h1 className="text-3xl font-bold">Agent Spend Wallets</h1><p className="text-gray-500 mt-2">Mercury-style capped wallets for bots and agent fleets.</p></div><Link href="/dashboard" className="px-4 py-2 border rounded-lg">← Dashboard</Link></div>
    {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 p-3">{error}</div>}
    {businesses.length > 1 && <select value={businessId} onChange={(e) => setBusinessId(e.target.value)} className="mb-6 border rounded-lg px-3 py-2">{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
    <form onSubmit={create} className="bg-white border rounded-xl p-6 mb-8 grid gap-4 md:grid-cols-4"><input required placeholder="Agent name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border rounded-lg px-3 py-2" /><input required placeholder="EVM wallet address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="border rounded-lg px-3 py-2 md:col-span-2" /><button className="bg-blue-600 text-white rounded-lg px-4 py-2">Create capped wallet</button><label className="text-sm">Per payment<input type="number" min="0.01" step="0.01" value={form.perPaymentLimitUsd} onChange={(e) => setForm({ ...form, perPaymentLimitUsd: e.target.value })} className="block border rounded-lg px-3 py-2 w-full" /></label><label className="text-sm">Monthly<input type="number" min="0.01" step="0.01" value={form.monthlyLimitUsd} onChange={(e) => setForm({ ...form, monthlyLimitUsd: e.target.value })} className="block border rounded-lg px-3 py-2 w-full" /></label><label className="text-sm">Lifetime maximum<input type="number" min="0.01" step="0.01" value={form.totalLimitUsd} onChange={(e) => setForm({ ...form, totalLimitUsd: e.target.value })} className="block border rounded-lg px-3 py-2 w-full" /></label></form>
    {loading ? <p>Loading…</p> : <div className="space-y-4">{agents.map((agent) => <div key={agent.id} className="border rounded-xl p-5 bg-white"><div className="flex justify-between gap-4"><div><h2 className="font-semibold">{agent.name}</h2><p className="text-xs text-gray-500 break-all">{agent.address}</p></div><span className="text-sm">{agent.status} · remaining {agent.remainingUsd == null ? 'unlimited' : `$${agent.remainingUsd.toFixed(2)}`}</span></div><div className="mt-4 flex gap-2">{agent.status === 'active' ? <button onClick={() => setStatus(agent, 'paused')} className="border rounded px-3 py-1">Pause</button> : agent.status === 'paused' && <button onClick={() => setStatus(agent, 'active')} className="border rounded px-3 py-1">Resume</button>} {agent.status !== 'revoked' && <button onClick={() => setStatus(agent, 'revoked')} className="border border-red-300 text-red-600 rounded px-3 py-1">Revoke</button>}</div></div>)}</div>}
  </main>;
}
