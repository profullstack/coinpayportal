'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import { formatAmount, formatDate, statusColors } from './stripe-helpers';

interface StripeTransactionsTabProps {
  businessId: string;
}

interface Transaction {
  id: string;
  stripe_charge_id: string | null;
  stripe_payment_intent_id: string | null;
  amount_cents: number;
  amount_usd: string;
  currency: string;
  status: string;
  platform_fee_amount: number;
  stripe_fee_amount: number;
  net_to_merchant: number;
  business_name: string;
  merchant_email: string | null;
  connected_account_email: string | null;
  created_at: string;
}

export function StripeTransactionsTab({ businessId }: StripeTransactionsTabProps) {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTransactions = useCallback(async () => {
    try {
      const result = await authFetch(`/api/stripe/transactions?business_id=${businessId}&limit=20`, {}, router);
      if (!result) return;
      const { data } = result;
      if (data.success) setTransactions(data.transactions || []);
    } catch { /* ignore */ }
  }, [businessId, router]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchTransactions();
      setLoading(false);
    };
    load();
  }, [fetchTransactions]);

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">Loading transactions...</p>
      </div>
    );
  }

  const exportCsv = () => {
    const headers = ['Date', 'Amount', 'Platform Fee', 'Net', 'Status', 'Payment Intent', 'Charge ID'];
    const rows = transactions.map(tx => [
      tx.created_at ? new Date(tx.created_at).toISOString() : '',
      `$${tx.amount_usd}`,
      formatAmount(tx.platform_fee_amount, tx.currency),
      formatAmount(tx.net_to_merchant, tx.currency),
      tx.status,
      tx.stripe_payment_intent_id || '',
      tx.stripe_charge_id || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div><h3 className="text-lg font-semibold text-gray-900 dark:text-white">Card Transactions</h3><p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Credit and debit card payments processed through Stripe Connect. Shows amount, fees, and net to merchant.</p></div>
        {transactions.length > 0 && (
          <button
            onClick={exportCsv}
            className="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            Export CSV
          </button>
        )}
      </div>
      {transactions.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No transactions yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Amount</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Platform Fee</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Stripe Fee</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Net to Merchant</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Merchant</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Status</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Date</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Payment ID</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2 px-3 font-medium">${tx.amount_usd}</td>
                  <td className="py-2 px-3 text-gray-500 dark:text-gray-400" title="CoinPayPortal application fee">
                    {formatAmount(tx.platform_fee_amount, tx.currency)}
                  </td>
                  <td className="py-2 px-3 text-gray-500 dark:text-gray-400" title="Stripe processing fee">
                    {tx.stripe_fee_amount ? formatAmount(tx.stripe_fee_amount, tx.currency) : '—'}
                  </td>
                  <td className="py-2 px-3 font-medium text-green-600 dark:text-green-400">
                    {tx.net_to_merchant ? formatAmount(tx.net_to_merchant, tx.currency) : '—'}
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-600 dark:text-gray-300">
                    <div>{tx.business_name || '—'}</div>
                    {tx.connected_account_email && (
                      <div className="text-gray-400 dark:text-gray-500">{tx.connected_account_email}</div>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${statusColors[tx.status] || 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}>
                      {tx.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{formatDate(tx.created_at)}</td>
                  <td className="py-2 px-3 font-mono text-xs text-gray-500 dark:text-gray-400 truncate max-w-[150px]" title={tx.stripe_payment_intent_id || tx.stripe_charge_id || ''}>
                    {tx.stripe_payment_intent_id || tx.stripe_charge_id || '—'}
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
