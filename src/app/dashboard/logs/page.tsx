'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getAuthToken } from '@/lib/auth/client';
import EventLogTable from '@/components/logs/EventLogTable';

/**
 * The merchant's own risk events.
 *
 * Scope is resolved server-side from the caller's token in
 * `/api/dashboard/logs` — this page never asks for a business id, so there is
 * nothing here to tamper with. Buyer IPs are withheld by that route.
 */
export default function DashboardLogsPage() {
  const router = useRouter();
  // Read the token once on mount rather than setting state from an effect;
  // localStorage is client-only, so the first render is always tokenless.
  const [token] = useState(() => (typeof window === 'undefined' ? null : getAuthToken()));

  useEffect(() => {
    if (!token) router.push('/login');
  }, [token, router]);

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-7xl mx-auto text-sm text-gray-500 dark:text-gray-400">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Activity log</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Fraud screening decisions, card declines and disputes for your businesses.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="rounded bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200"
          >
            ← Dashboard
          </Link>
        </div>

        <EventLogTable endpoint="/api/dashboard/logs" showBusiness />
      </div>
    </div>
  );
}
