'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import type { Role } from '@/lib/auth/permissions';

/**
 * Whose books the Finances pages show. Only rendered for someone who can open
 * more than their own: an org owner granted them finance access.
 *
 * The choice lives in the `finance_owner` cookie, which every same-origin fetch to
 * /api/finances already carries, so no page needs to know about it. The server
 * re-authorizes it on every request (src/lib/finances/access.ts); a stale cookie
 * for books you lost access to is cleared here on the next visit.
 */

const COOKIE = 'finance_owner';

type Owner = {
  ownerId: string;
  email: string | null;
  name: string | null;
  role: Role;
  organizations: string[];
  self: boolean;
};

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  writer: 'Read & write',
  readonly: 'Read only',
};

function readCookie(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)finance_owner=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(value: string | null) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = value
    ? `${COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
    : `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

export function FinanceOwnerSwitcher() {
  const router = useRouter();
  const [owners, setOwners] = useState<Owner[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await authFetch('/api/finances/owners', {}, router);
      if (!result || cancelled) return;
      const list: Owner[] = result.data?.owners ?? [];
      const selected = readCookie();
      if (selected && !list.some((o) => o.ownerId === selected)) {
        // Access was revoked (or the cookie is from another account): back to your own books.
        writeCookie(null);
        window.location.reload();
        return;
      }
      setOwners(list);
      setCurrent(selected ?? list.find((o) => o.self)?.ownerId ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (owners.length < 2) return null;

  const active = owners.find((o) => o.ownerId === current) ?? owners[0];
  const label = (o: Owner) =>
    o.self ? 'My books' : `${o.name || o.email || 'Owner'}${o.organizations.length ? ` (${o.organizations.join(', ')})` : ''}`;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
      <div
        className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 rounded-lg border px-4 py-3 text-sm ${
          active.self
            ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
            : 'border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20'
        }`}
      >
        <label htmlFor="finance-owner" className="font-medium text-gray-700 dark:text-gray-200">
          Viewing books of
        </label>
        <select
          id="finance-owner"
          value={active.ownerId}
          onChange={(e) => {
            const next = owners.find((o) => o.ownerId === e.target.value);
            writeCookie(next && !next.self ? next.ownerId : null);
            window.location.reload();
          }}
          className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        >
          {owners.map((o) => (
            <option key={o.ownerId} value={o.ownerId}>
              {label(o)}
            </option>
          ))}
        </select>
        {!active.self && (
          <span className="text-gray-600 dark:text-gray-300">
            Your access: <strong>{ROLE_LABEL[active.role]}</strong>
          </span>
        )}
      </div>
    </div>
  );
}
