'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface Row {
  currency: string;
  current: number;
  '1_30': number;
  '31_60': number;
  '61_90': number;
  '90_plus': number;
  total: number;
}
interface ClientRow extends Row {
  client_id: string | null;
  name: string;
  invoices: number;
}

const COLUMNS: Array<[keyof Row, string]> = [
  ['current', 'Not yet due'],
  ['1_30', '1-30 days'],
  ['31_60', '31-60'],
  ['61_90', '61-90'],
  ['90_plus', '90+'],
  ['total', 'Total'],
];

/** Who owes what, by how late it is. */
export default function AgingPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Array<{ id: string; name: string }>>([]);
  const [businessId, setBusinessId] = useState('');
  const [report, setReport] = useState<{ totals: Row[]; clients: ClientRow[] } | null>(null);

  useEffect(() => {
    (async () => {
      const result = await authFetch('/api/businesses', {}, router);
      if (result?.data.success && result.data.businesses.length > 0) {
        setBusinesses(result.data.businesses);
        setBusinessId(result.data.businesses[0].id);
      }
    })();
  }, [router]);

  useEffect(() => {
    if (!businessId) return;
    (async () => {
      const result = await authFetch(`/api/invoices/aging?business_id=${businessId}`, {}, router);
      setReport(result?.data.success ? result.data : { totals: [], clients: [] });
    })();
  }, [businessId, router]);

  const fmt = (n: number, currency: string) =>
    n ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n) : '-';

  const table = (rows: Array<Row & { name?: string; invoices?: number }>, label: string) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-400 border-b border-gray-700">
            <th className="text-left font-medium py-2 pr-3">{label}</th>
            {COLUMNS.map(([, title]) => (
              <th key={title} className="text-right font-medium py-2 px-2 whitespace-nowrap">
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-800">
              <td className="py-2 pr-3 text-white">
                {r.name ?? r.currency}
                {r.invoices ? <span className="text-gray-500 text-xs"> · {r.invoices}</span> : null}
              </td>
              {COLUMNS.map(([key]) => (
                <td
                  key={key}
                  className={`py-2 px-2 text-right whitespace-nowrap ${
                    key === 'total' ? 'text-white font-medium' : key === '90_plus' && r[key] ? 'text-red-400' : 'text-gray-300'
                  }`}
                >
                  {fmt(r[key] as number, r.currency)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <Link href="/invoices" className="text-purple-400 hover:text-purple-300 text-sm mb-4 inline-block">
            ← Back to Invoices
          </Link>
          <h1 className="text-3xl font-bold text-white">Accounts Receivable Aging</h1>
          <p className="mt-2 text-gray-400">Unpaid invoices that have been sent, grouped by how far past due they are.</p>
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

        {!report ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-400" />
          </div>
        ) : report.totals.length === 0 ? (
          <p className="text-center text-gray-500 py-12">Nothing outstanding. Every sent invoice is paid.</p>
        ) : (
          <>
            <section className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-white mb-3">Totals</h2>
              {table(report.totals, 'Currency')}
            </section>
            <section className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-white mb-3">By client</h2>
              {table(report.clients, 'Client')}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
