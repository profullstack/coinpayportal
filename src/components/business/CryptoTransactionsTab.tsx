'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import { formatDate, statusColors } from './stripe-helpers';

interface CryptoTransactionsTabProps {
  businessId: string;
}

interface CryptoPayment {
  id: string;
  business_id: string;
  business_name: string;
  amount_crypto: string;
  amount_usd: string;
  currency: string;
  status: string;
  payment_address: string;
  tx_hash: string | null;
  confirmations: number;
  created_at: string;
  expires_at: string | null;
  fee_amount: string | null;
  merchant_amount: string | null;
}

const FAILURE_STATUSES = new Set(['failed', 'expired', 'forwarding_failed', 'settle_failed', 'settlement_failed']);

function isFailureStatus(status: string) {
  return FAILURE_STATUSES.has(status.toLowerCase());
}

export function CryptoTransactionsTab({ businessId }: CryptoTransactionsTabProps) {
  const router = useRouter();
  const [payments, setPayments] = useState<CryptoPayment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPayments = useCallback(async () => {
    try {
      const result = await authFetch(`/api/payments?business_id=${businessId}`, {}, router);
      if (!result) return;
      const { data } = result;
      if (data.success) setPayments(data.payments || []);
    } catch { /* ignore */ }
  }, [businessId, router]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchPayments();
      setLoading(false);
    };
    load();
  }, [fetchPayments]);

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading transactions...</p>
      </div>
    );
  }

  const exportCsv = () => {
    const headers = ['Date', 'Amount (USD)', 'Crypto Amount', 'Currency', 'Status', 'Confirmations', 'TX Hash', 'Payment Address'];
    const rows = payments.map(p => [
      p.created_at ? new Date(p.created_at).toISOString() : '',
      `$${p.amount_usd}`,
      p.amount_crypto,
      p.currency,
      p.status,
      String(p.confirmations),
      p.tx_hash || '',
      p.payment_address || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crypto-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const failureCount = payments.filter((payment) => isFailureStatus(payment.status)).length;
  const pendingCount = payments.filter((payment) => ['pending', 'detected'].includes(payment.status.toLowerCase())).length;
  const successfulCount = payments.filter((payment) =>
    ['completed', 'confirmed', 'forwarded', 'forwarding'].includes(payment.status.toLowerCase())
  ).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div><h3 className="text-lg font-semibold text-gray-900 dark:text-white">Crypto Transactions</h3><p className="text-sm text-gray-500 dark:text-gray-400 mt-1">All incoming crypto payments to your business wallets — BTC, ETH, SOL, and other supported chains.</p></div>
        {payments.length > 0 && (
          <button
            onClick={exportCsv}
            className="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            Export CSV
          </button>
        )}
      </div>
      {payments.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No crypto transactions yet.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Crypto payment status summary">
            <StatusSummaryCard label="Total" value={payments.length} className="border-gray-200 bg-gray-50 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
            <StatusSummaryCard label="Successful" value={successfulCount} className="border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300" />
            <StatusSummaryCard label="Pending" value={pendingCount} className="border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300" />
            <StatusSummaryCard label="Failures" value={failureCount} className="border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300" />
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Amount (USD)</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Crypto</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Currency</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Fee</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Net</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Status</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Confirmations</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Date</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">TX Hash</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-b border-gray-100 dark:border-gray-800 ${isFailureStatus(p.status) ? 'bg-red-50/70 dark:bg-red-950/20' : ''}`}
                  >
                    <td className="py-2 px-3 font-medium">${p.amount_usd}</td>
                    <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{p.amount_crypto}</td>
                    <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{p.currency}</td>
                    <td className="py-2 px-3 text-gray-500 dark:text-gray-400">
                      <div>{p.fee_amount ? `${p.fee_amount} ${p.currency}` : '—'}</div>
                    </td>
                    <td className="py-2 px-3 font-medium text-green-600 dark:text-green-400">
                      <div>{p.merchant_amount ? `${p.merchant_amount} ${p.currency}` : '—'}</div>
                      {p.merchant_amount && p.amount_usd ? <div className="text-xs font-normal text-gray-400">≈ ${(Number(p.amount_usd) - (Number(p.amount_usd) * 0.01)).toFixed(2)}</div> : null}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${statusColors[p.status] || 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}>
                        {p.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{p.confirmations}</td>
                    <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{formatDate(p.created_at)}</td>
                    <td className="py-2 px-3 font-mono text-xs text-gray-500 dark:text-gray-400 truncate max-w-[150px]" title={p.tx_hash || ''}>
                      {p.tx_hash || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusSummaryCard({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${className}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
