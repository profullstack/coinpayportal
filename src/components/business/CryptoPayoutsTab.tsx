'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import { formatDate, statusColors } from './stripe-helpers';

interface CryptoPayoutsTabProps {
  businessId: string;
}

interface ForwardedPayment {
  id: string;
  business_id: string;
  amount_crypto: string;
  amount_usd: string;
  currency: string;
  status: string;
  payment_address: string;
  merchant_wallet: string;
  tx_hash: string | null;
  forward_tx_hash: string | null;
  forwarded_at: string | null;
  created_at: string;
  fee_amount: string | null;
  merchant_amount: string | null;
}

export function CryptoPayoutsTab({ businessId }: CryptoPayoutsTabProps) {
  const router = useRouter();
  const [payouts, setPayouts] = useState<ForwardedPayment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPayouts = useCallback(async () => {
    try {
      const result = await authFetch(`/api/payments?business_id=${businessId}&status=forwarded`, {}, router);
      if (!result) return;
      const { data } = result;
      if (data.success) setPayouts(data.payments || []);
    } catch { /* ignore */ }
  }, [businessId, router]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchPayouts();
      setLoading(false);
    };
    load();
  }, [fetchPayouts]);

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading payouts...</p>
      </div>
    );
  }

  const exportCsv = () => {
    const headers = ['Date', 'Amount (USD)', 'Crypto Amount', 'Currency', 'Fee', 'Net', 'TX Hash', 'Payment Address'];
    const rows = payouts.map(p => [
      p.created_at ? new Date(p.created_at).toISOString() : '',
      `$${p.amount_usd}`,
      p.amount_crypto,
      p.currency,
      p.fee_amount ? `$${p.fee_amount}` : '',
      p.merchant_amount ? `$${p.merchant_amount}` : '',
      p.tx_hash || '',
      p.payment_address || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crypto-payouts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Payouts / Forwarding</h3>
        {payouts.length > 0 && (
          <button
            onClick={exportCsv}
            className="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            Export CSV
          </button>
        )}
      </div>
      {payouts.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No forwarded payments yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Amount</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Crypto</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Chain</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Fee</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Net to Merchant</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Merchant Wallet</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Forwarded</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Forward TX</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2 px-3 font-medium">${p.amount_usd}</td>
                  <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{p.amount_crypto}</td>
                  <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{p.currency}</td>
                  <td className="py-2 px-3 text-gray-500 dark:text-gray-400">
                    {p.fee_amount ? `${p.fee_amount} ${p.currency}` : '—'}
                  </td>
                  <td className="py-2 px-3 font-medium text-green-600 dark:text-green-400">
                    {p.merchant_amount ? `${p.merchant_amount} ${p.currency}` : '—'}
                  </td>
                  <td className="py-2 px-3 font-mono text-xs text-gray-500 dark:text-gray-400 truncate max-w-[120px]" title={p.merchant_wallet}>
                    {p.merchant_wallet ? `${p.merchant_wallet.slice(0, 6)}...${p.merchant_wallet.slice(-4)}` : '—'}
                  </td>
                  <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{p.forwarded_at ? formatDate(p.forwarded_at) : formatDate(p.created_at)}</td>
                  <td className="py-2 px-3 font-mono text-xs text-gray-500 dark:text-gray-400 truncate max-w-[120px]" title={p.forward_tx_hash || p.tx_hash || ''}>
                    {(p.forward_tx_hash || p.tx_hash) ? `${(p.forward_tx_hash || p.tx_hash || '').slice(0, 8)}...` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
