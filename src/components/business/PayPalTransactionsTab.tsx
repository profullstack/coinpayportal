'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

interface PayPalTransactionsTabProps {
  businessId: string;
}

interface PaypalTransaction {
  id: string;
  paypal_order_id: string;
  paypal_capture_id: string | null;
  payer_email: string | null;
  /** MAJOR units — 10.00 is ten dollars, unlike the Stripe tab's cents. */
  amount: number;
  currency: string;
  platform_fee_amount: number;
  paypal_fee_amount: number | null;
  net_to_merchant: number | null;
  refunded_amount: number;
  status: string;
  invoice_number: string | null;
  description: string | null;
  customer_email: string | null;
  created_at: string;
}

const REFUNDABLE = new Set(['completed', 'partially_refunded']);

export function PayPalTransactionsTab({ businessId }: PayPalTransactionsTabProps) {
  const router = useRouter();
  const [transactions, setTransactions] = useState<PaypalTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [confirmRefund, setConfirmRefund] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchTransactions = useCallback(async () => {
    try {
      const result = await authFetch(
        `/api/paypal/transactions?business_id=${businessId}&limit=50`,
        {},
        router
      );
      if (!result) return;
      const { data } = result;
      if (data.success) setTransactions(data.transactions || []);
    } catch {
      /* leave the table as it was rather than blanking it on a transient error */
    }
  }, [businessId, router]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchTransactions();
      setLoading(false);
    };
    load();
  }, [fetchTransactions]);

  const handleRefund = async (transactionId: string) => {
    setRefunding(transactionId);
    setError('');
    setSuccess('');
    try {
      const result = await authFetch(
        `/api/paypal/transactions/${transactionId}/refund`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
        router
      );
      if (!result) {
        setRefunding(null);
        return;
      }
      const { response, data } = result;
      if (response.ok && data.success) {
        setSuccess(data.warning || 'Refund issued.');
        setConfirmRefund(null);
        await fetchTransactions();
      } else {
        setError(data.error || 'Refund failed.');
      }
    } catch {
      setError('Refund failed.');
    }
    setRefunding(null);
  };

  // These amounts are already in major units, so no /100 here. Getting this
  // wrong is the classic cross-rail bug: the Stripe tab divides, this must not.
  const formatAmount = (amount: number, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(
      amount
    );

  const formatDate = (dateStr: string | null) =>
    dateStr
      ? new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      : '—';

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      completed: 'bg-green-100 text-green-700',
      approved: 'bg-blue-100 text-blue-700',
      pending: 'bg-yellow-100 text-yellow-700',
      declined: 'bg-red-100 text-red-700',
      failed: 'bg-red-100 text-red-700',
      refunded: 'bg-gray-100 text-gray-700',
      partially_refunded: 'bg-orange-100 text-orange-700',
      canceled: 'bg-gray-100 text-gray-700',
      expired: 'bg-gray-100 text-gray-700',
    };
    const cls = colors[status] || 'bg-gray-100 text-gray-700';
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded ${cls}`}>
        {status.replace(/_/g, ' ')}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading PayPal transactions…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-4 py-3 rounded-lg text-sm">
          {success}
        </div>
      )}

      <section>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">PayPal Transactions</h3>
        {transactions.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No PayPal transactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Amount</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Status</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Fee</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Net</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Payer</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Date</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Order</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Actions</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 px-3 font-medium">
                      {formatAmount(tx.amount, tx.currency)}
                      {tx.refunded_amount > 0 && (
                        <span className="block text-xs text-orange-600">
                          −{formatAmount(tx.refunded_amount, tx.currency)} refunded
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3">{statusBadge(tx.status)}</td>
                    <td className="py-2 px-3 text-gray-600 dark:text-gray-300">
                      {tx.platform_fee_amount > 0 ? formatAmount(tx.platform_fee_amount, tx.currency) : '—'}
                    </td>
                    <td className="py-2 px-3 text-gray-600 dark:text-gray-300">
                      {tx.net_to_merchant === null ? '—' : formatAmount(tx.net_to_merchant, tx.currency)}
                    </td>
                    <td className="py-2 px-3 text-gray-600 dark:text-gray-300">
                      {tx.payer_email || tx.customer_email || '—'}
                    </td>
                    <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{formatDate(tx.created_at)}</td>
                    <td className="py-2 px-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                      {tx.paypal_order_id?.startsWith('pending:') ? '—' : tx.paypal_order_id}
                    </td>
                    <td className="py-2 px-3">
                      {REFUNDABLE.has(tx.status) && (
                        confirmRefund === tx.id ? (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleRefund(tx.id)}
                              disabled={refunding === tx.id}
                              className="px-3 py-1 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-500 disabled:opacity-50"
                            >
                              {refunding === tx.id ? 'Refunding…' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => setConfirmRefund(null)}
                              disabled={refunding === tx.id}
                              className="px-3 py-1 text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmRefund(tx.id)}
                            className="px-3 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                          >
                            Refund
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
