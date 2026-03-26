'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import { formatDate, statusColors } from './stripe-helpers';

interface CryptoEscrowsTabProps {
  businessId: string;
}

interface Escrow {
  id: string;
  chain: string;
  amount: number;
  amount_usd: number | null;
  status: string;
  depositor_address: string;
  beneficiary_address: string;
  deposit_address: string | null;
  tx_hash: string | null;
  created_at: string;
  expires_at: string | null;
  released_at: string | null;
}

export function CryptoEscrowsTab({ businessId }: CryptoEscrowsTabProps) {
  const router = useRouter();
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEscrows = useCallback(async () => {
    try {
      const result = await authFetch(`/api/escrow?business_id=${businessId}`, {}, router);
      if (!result) return;
      const { data } = result;
      setEscrows(data.escrows || []);
    } catch { /* ignore */ }
  }, [businessId, router]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchEscrows();
      setLoading(false);
    };
    load();
  }, [fetchEscrows]);

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading escrows...</p>
      </div>
    );
  }

  const exportCsv = () => {
    const headers = ['Date', 'Chain', 'Amount', 'Amount (USD)', 'Status', 'Depositor', 'Beneficiary', 'TX Hash', 'Expires'];
    const rows = escrows.map(e => [
      e.created_at ? new Date(e.created_at).toISOString() : '',
      e.chain,
      String(e.amount),
      e.amount_usd != null ? `$${e.amount_usd}` : '',
      e.status,
      e.depositor_address || '',
      e.beneficiary_address || '',
      e.tx_hash || '',
      e.expires_at ? new Date(e.expires_at).toISOString() : '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crypto-escrows-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div><h3 className="text-lg font-semibold text-gray-900 dark:text-white">Crypto Escrows</h3><p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Funds held in escrow until both parties are satisfied. Supports auto-release, disputes, and refunds.</p></div>
        {escrows.length > 0 && (
          <button
            onClick={exportCsv}
            className="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            Export CSV
          </button>
        )}
      </div>
      {escrows.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No escrows yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Chain</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Amount</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">USD</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Status</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Depositor</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Beneficiary</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Created</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Expires</th>
              </tr>
            </thead>
            <tbody>
              {escrows.map((e) => (
                <tr key={e.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2 px-3 font-medium text-gray-900 dark:text-white">{e.chain}</td>
                  <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{e.amount}</td>
                  <td className="py-2 px-3 text-gray-600 dark:text-gray-300">
                    {e.amount_usd != null ? `$${e.amount_usd}` : '—'}
                  </td>
                  <td className="py-2 px-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${statusColors[e.status] || 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}>
                      {e.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-2 px-3 font-mono text-xs text-gray-500 dark:text-gray-400 truncate max-w-[120px]" title={e.depositor_address}>
                    {e.depositor_address || '—'}
                  </td>
                  <td className="py-2 px-3 font-mono text-xs text-gray-500 dark:text-gray-400 truncate max-w-[120px]" title={e.beneficiary_address}>
                    {e.beneficiary_address || '—'}
                  </td>
                  <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{formatDate(e.created_at)}</td>
                  <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{formatDate(e.expires_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
