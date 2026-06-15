'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import {
  type Role,
  can,
  canAssignRole,
  INVITABLE_ROLES,
  ROLE_RANK,
} from '@/lib/auth/permissions';

type Scope = 'org' | 'business';

interface Member {
  id: string;
  merchantId: string;
  email: string | null;
  name: string | null;
  role: Role;
  createdAt: string;
}

interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
}

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  writer: 'Writer (need-to-know writes)',
  readonly: 'Read only',
};

export function TeamManager({ scope, scopeId }: { scope: Scope; scopeId: string }) {
  const router = useRouter();
  const base = `/api/${scope === 'org' ? 'organizations' : 'businesses'}/${scopeId}`;

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('readonly');

  const load = useCallback(async () => {
    setError('');
    const result = await authFetch(`${base}/members`, {}, router);
    if (!result) return;
    const { response, data } = result;
    if (!response.ok || !data.success) {
      setError(data.error || 'Failed to load team');
      setLoading(false);
      return;
    }
    setMembers(data.members ?? []);
    setInvitations(data.invitations ?? []);
    setMyRole(data.role ?? null);
    setLoading(false);
  }, [base, router]);

  useEffect(() => {
    load();
  }, [load]);

  const canManage = can(myRole, 'team.manage');
  // Roles this actor is allowed to grant (strictly below their own rank).
  const assignableRoles = myRole
    ? INVITABLE_ROLES.filter((r) => canAssignRole(myRole, r))
    : [];

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      const result = await authFetch(
        `${base}/members`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
        },
        router,
      );
      if (!result) return;
      const { response, data } = result;
      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to send invitation');
        return;
      }
      setSuccess(`Invitation sent to ${inviteEmail.trim()}`);
      setInviteEmail('');
      setInviteRole('readonly');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleRoleChange = async (memberId: string, role: Role) => {
    setError('');
    setSuccess('');
    const result = await authFetch(
      `${base}/members/${memberId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      },
      router,
    );
    if (!result) return;
    const { response, data } = result;
    if (!response.ok || !data.success) {
      setError(data.error || 'Failed to update role');
      return;
    }
    await load();
  };

  const handleRemove = async (memberId: string, label: string) => {
    if (!confirm(`Remove ${label} from this ${scope === 'org' ? 'organization' : 'business'}?`)) return;
    setError('');
    const result = await authFetch(`${base}/members/${memberId}`, { method: 'DELETE' }, router);
    if (!result) return;
    const { response, data } = result;
    if (!response.ok || !data.success) {
      setError(data.error || 'Failed to remove member');
      return;
    }
    await load();
  };

  const handleRevoke = async (invitationId: string) => {
    setError('');
    const result = await authFetch(`${base}/invitations/${invitationId}`, { method: 'DELETE' }, router);
    if (!result) return;
    const { response, data } = result;
    if (!response.ok || !data.success) {
      setError(data.error || 'Failed to revoke invitation');
      return;
    }
    await load();
  };

  if (loading) {
    return <div className="text-gray-500 dark:text-gray-400">Loading team…</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-lg">
          {success}
        </div>
      )}

      {canManage && (
        <form
          onSubmit={handleInvite}
          className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg"
        >
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Invite by email
            </label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@example.com"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Role
            </label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:outline-none"
            >
              {assignableRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="bg-purple-600 hover:bg-purple-700 text-white font-medium px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send invite'}
          </button>
        </form>
      )}

      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Members</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-4">Member</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const label = m.name || m.email || m.merchantId;
                const editable =
                  canManage &&
                  m.role !== 'owner' &&
                  !!myRole &&
                  ROLE_RANK[myRole] > ROLE_RANK[m.role];
                return (
                  <tr key={m.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-3 pr-4">
                      <div className="font-medium text-gray-900 dark:text-white">{m.name || m.email}</div>
                      {m.name && m.email && (
                        <div className="text-gray-500 dark:text-gray-400">{m.email}</div>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {editable ? (
                        <select
                          value={m.role}
                          onChange={(e) => handleRoleChange(m.id, e.target.value as Role)}
                          className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        >
                          {INVITABLE_ROLES.filter((r) => canAssignRole(myRole!, r) || r === m.role).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-gray-700 dark:text-gray-300">{ROLE_LABELS[m.role]}</span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      {editable && (
                        <button
                          onClick={() => handleRemove(m.id, label)}
                          className="text-red-600 hover:text-red-700 text-sm"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {canManage && invitations.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Pending invitations</h3>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">{inv.email}</span>
                  <span className="text-gray-500 dark:text-gray-400"> · {ROLE_LABELS[inv.role]}</span>
                </div>
                <button
                  onClick={() => handleRevoke(inv.id)}
                  className="text-red-600 hover:text-red-700"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
