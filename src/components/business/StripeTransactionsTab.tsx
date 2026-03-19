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
  stripe_charge_id: string;
  amount: number;
  currency: string;
  status: string;
  customer_email: string | null;
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

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Card Transactions</h3>
      {transactions.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 py-4">No transactions yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Amount</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Status</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Customer</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Date</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Charge ID</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id} className="border-b border-gray-100">
                  <td className="py-2 px-3 font-medium">{formatAmount(tx.amount, tx.currency)}</td>
                  <td className="py-2 px-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${statusColors[tx.status] || 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}>
                      {tx.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{tx.customer_email || '—'}</td>
                  <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{formatDate(tx.created_at)}</td>
                  <td className="py-2 px-3 font-mono text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">{tx.stripe_charge_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
