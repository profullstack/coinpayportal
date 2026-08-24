import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth/admin-guard';
import EventLogTable from '@/components/logs/EventLogTable';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Event log · Admin · CoinPay',
  robots: { index: false, follow: false },
};

export default async function AdminLogsPage() {
  await requireAdminPage('/admin/logs');

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Event log</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Fraud screening decisions, card declines and disputes across every business.
            </p>
          </div>
          <Link
            href="/admin/stats"
            className="rounded bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200"
          >
            ← Platform stats
          </Link>
        </div>

        <EventLogTable endpoint="/api/admin/logs" showIp showBusiness />
      </div>
    </div>
  );
}
