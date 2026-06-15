'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';
import { TeamManager } from '@/components/team/TeamManager';
import type { Role } from '@/lib/auth/permissions';

interface Org {
  id: string;
  name: string;
  role: Role;
  isOwner: boolean;
}

export default function OrgTeamPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const result = await authFetch('/api/organizations', {}, router);
      if (!result) return;
      const { response, data } = result;
      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to load organizations');
        setLoading(false);
        return;
      }
      const list: Org[] = data.organizations ?? [];
      setOrgs(list);
      // Honor ?org=<id> deep links (from the Organizations page); otherwise prefer an
      // org the user can manage, then the first one.
      const requested =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('org')
          : null;
      const requestedOrg = requested ? list.find((o) => o.id === requested) : undefined;
      const manageable = list.find((o) => o.role === 'owner' || o.role === 'admin');
      setSelected((requestedOrg ?? manageable ?? list[0])?.id ?? '');
      setLoading(false);
    })();
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <Link href="/settings" className="text-sm text-purple-600 hover:text-purple-700">
            ← Back to settings
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">Organization Team</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-300">
            Invite teammates to your organization. Org members get their role across every business in
            the organization.
          </p>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-gray-500 dark:text-gray-400">Loading…</div>
        ) : orgs.length === 0 ? (
          <div className="text-gray-500 dark:text-gray-400">No organizations found.</div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            {orgs.length > 1 && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Organization
                </label>
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                >
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {selected && <TeamManager scope="org" scopeId={selected} />}
          </div>
        )}
      </div>
    </div>
  );
}
