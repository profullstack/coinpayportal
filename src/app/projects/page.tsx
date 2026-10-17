'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface Business {
  id: string;
  name: string;
}
interface Client {
  id: string;
  name: string | null;
  company_name: string | null;
  email: string;
}
interface Project {
  id: string;
  name: string;
  client_id: string | null;
  hourly_rate: number | null;
  currency: string;
  budget_hours: number | null;
  status: 'active' | 'archived';
  clients: Client | null;
}

const input = 'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm';
const empty = { name: '', client_id: '', hourly_rate: '', budget_hours: '' };

export default function ProjectsPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const result = await authFetch('/api/businesses', {}, router);
      if (result?.data.success && result.data.businesses.length > 0) {
        setBusinesses(result.data.businesses);
        setBusinessId(result.data.businesses[0].id);
      }
      setLoading(false);
    })();
  }, [router]);

  const load = useCallback(async () => {
    if (!businessId) return;
    const [p, c] = await Promise.all([
      authFetch(`/api/projects?business_id=${businessId}`, {}, router),
      authFetch(`/api/clients?business_id=${businessId}`, {}, router),
    ]);
    setProjects(p?.data.success ? p.data.projects ?? [] : []);
    setClients(c?.data.success ? c.data.clients ?? [] : []);
  }, [businessId, router]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const result = await authFetch(
      '/api/projects',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          name: form.name,
          client_id: form.client_id || null,
          hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : null,
          budget_hours: form.budget_hours ? Number(form.budget_hours) : null,
        }),
      },
      router
    );
    if (!result?.data.success) {
      setError(result?.data.error || 'Failed to create project');
      return;
    }
    setForm(empty);
    router.push(`/projects/${result.data.project.id}`);
  };

  const fmt = (n: number | null, currency: string) =>
    n == null ? 'No rate' : `${new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n))}/hr`;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <Link href="/invoices" className="text-purple-400 hover:text-purple-300 text-sm mb-4 inline-block">
            ← Invoices
          </Link>
          <h1 className="text-3xl font-bold text-white">Projects &amp; Time</h1>
          <p className="mt-2 text-gray-400">Track hours against a project, then bill the unbilled time in one click.</p>
        </div>

        {businesses.length > 1 && (
          <select
            aria-label="Business"
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            className="px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
          >
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}

        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg">{error}</div>}

        <form onSubmit={create} className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <label className="text-sm text-gray-300 sm:col-span-2">
            Project name *
            <input required aria-label="Project name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${input} mt-1`} />
          </label>
          <label className="text-sm text-gray-300">
            Client
            <select aria-label="Project client" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} className={`${input} mt-1`}>
              <option value="">None</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name || c.name || c.email}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-300">
            Hourly rate
            <input aria-label="Hourly rate" type="number" step="0.01" min="0" value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} className={`${input} mt-1`} />
          </label>
          <label className="text-sm text-gray-300">
            Budget (hours)
            <input aria-label="Budget hours" type="number" step="0.5" min="0" value={form.budget_hours} onChange={(e) => setForm({ ...form, budget_hours: e.target.value })} className={`${input} mt-1`} />
          </label>
          <div className="sm:col-span-3 flex justify-end">
            <button type="submit" disabled={!businessId} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg disabled:opacity-50">
              New project
            </button>
          </div>
        </form>

        {projects.length === 0 ? (
          <p className="text-center text-gray-500 py-8">No projects yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="bg-gray-800/50 rounded-xl border border-gray-700 hover:border-purple-500 p-5 block">
                <h3 className="text-white font-medium">{p.name}</h3>
                <p className="text-sm text-gray-400">{p.clients?.company_name || p.clients?.name || 'No client'}</p>
                <p className="text-xs text-gray-500 mt-2">
                  {fmt(p.hourly_rate, p.currency)}
                  {p.budget_hours ? ` · ${p.budget_hours}h budget` : ''}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
