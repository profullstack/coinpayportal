'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';
import { type Role, can } from '@/lib/auth/permissions';

interface Org {
  id: string;
  name: string;
  role: Role;
  isOwner: boolean;
}
interface Biz {
  id: string;
  name: string;
  organization_id: string | null;
}

export default function OrganizationsPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [businesses, setBusinesses] = useState<Biz[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    const [orgRes, bizRes] = await Promise.all([
      authFetch('/api/organizations', {}, router),
      authFetch('/api/businesses', {}, router),
    ]);
    if (!orgRes || !bizRes) return;
    if (!orgRes.response.ok || !orgRes.data.success) {
      setError(orgRes.data.error || 'Failed to load organizations');
      setLoading(false);
      return;
    }
    setOrgs(orgRes.data.organizations ?? []);
    setBusinesses(
      (bizRes.data?.businesses ?? []).map((b: any) => ({
        id: b.id,
        name: b.name,
        organization_id: b.organization_id ?? null,
      })),
    );
    setLoading(false);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const manageableOrgs = orgs.filter((o) => can(o.role, 'settings.manage'));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const res = await authFetch(
        '/api/organizations',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName.trim() }) },
        router,
      );
      if (!res) return;
      if (!res.response.ok || !res.data.success) {
        setError(res.data.error || 'Failed to create organization');
        return;
      }
      setNewName('');
      setSuccess('Organization created');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const rename = async (org: Org) => {
    const name = prompt('Rename organization', org.name);
    if (!name || name.trim() === org.name) return;
    setError('');
    const res = await authFetch(
      `/api/organizations/${org.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) },
      router,
    );
    if (!res) return;
    if (!res.response.ok || !res.data.success) {
      setError(res.data.error || 'Failed to rename');
      return;
    }
    await load();
  };

  const remove = async (org: Org) => {
    if (!confirm(`Delete organization "${org.name}"? This cannot be undone.`)) return;
    setError('');
    const res = await authFetch(`/api/organizations/${org.id}`, { method: 'DELETE' }, router);
    if (!res) return;
    if (!res.response.ok || !res.data.success) {
      setError(res.data.error || 'Failed to delete');
      return;
    }
    await load();
  };

  const moveBusiness = async (bizId: string, organizationId: string) => {
    setError('');
    const res = await authFetch(
      `/api/businesses/${bizId}/organization`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organization_id: organizationId }) },
      router,
    );
    if (!res) return;
    if (!res.response.ok || !res.data.success) {
      setError(res.data.error || 'Failed to move business');
      return;
    }
    await load();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <Link href="/settings" className="text-sm text-purple-600 hover:text-purple-700">
            ← Back to settings
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">Organizations</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-300">
            Organizations group your businesses. Team members added to an organization get their role
            across every business in it.
          </p>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-lg">
            {success}
          </div>
        )}

        <form onSubmit={create} className="mb-8 flex gap-3 items-end bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              New organization
            </label>
            <input
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Acme Holdings"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:outline-none"
            />
          </div>
          <button type="submit" disabled={busy} className="bg-purple-600 hover:bg-purple-700 text-white font-medium px-4 py-2 rounded-lg disabled:opacity-50">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </form>

        {loading ? (
          <div className="text-gray-500 dark:text-gray-400">Loading…</div>
        ) : (
          <div className="space-y-4">
            {orgs.map((org) => {
              const orgBusinesses = businesses.filter((b) => b.organization_id === org.id);
              const canManage = can(org.role, 'settings.manage');
              return (
                <div key={org.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                        {org.name}
                        <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">({org.role})</span>
                      </h2>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <Link href={`/settings/team?org=${org.id}`} className="text-purple-600 hover:text-purple-700">
                        Team
                      </Link>
                      {canManage && (
                        <button onClick={() => rename(org)} className="text-gray-600 dark:text-gray-300 hover:text-gray-900">
                          Rename
                        </button>
                      )}
                      {org.isOwner && (
                        <button onClick={() => remove(org)} className="text-red-600 hover:text-red-700">
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                      Businesses ({orgBusinesses.length})
                    </div>
                    {orgBusinesses.length === 0 ? (
                      <div className="text-sm text-gray-400">No businesses in this organization.</div>
                    ) : (
                      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                        {orgBusinesses.map((b) => (
                          <li key={b.id} className="flex items-center justify-between py-2 text-sm">
                            <span className="text-gray-900 dark:text-white">{b.name}</span>
                            {canManage && manageableOrgs.length > 1 && (
                              <select
                                value={org.id}
                                onChange={(e) => moveBusiness(b.id, e.target.value)}
                                className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                title="Move to another organization"
                              >
                                {manageableOrgs.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.name}
                                  </option>
                                ))}
                              </select>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
