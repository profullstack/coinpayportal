'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface CardTransaction {
  id: string;
  business_id: string;
  business_name: string;
  amount_usd: string;
  currency: string;
  platform_fee_usd: string;
  stripe_fee_usd: string;
  net_to_merchant_usd: string;
  status: string;
  rail: string;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_balance_txn_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  failure_reason: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/40';
    case 'pending':
      return 'text-yellow-700 bg-yellow-100 dark:text-yellow-300 dark:bg-yellow-900/40';
    case 'failed':
      return 'text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/40';
    default:
      return 'text-gray-700 bg-gray-100 dark:text-gray-300 dark:bg-gray-800';
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-sm text-gray-900 dark:text-gray-100 break-all sm:text-right">{children}</span>
    </div>
  );
}

export default function CardTransactionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [transaction, setTransaction] = useState<CardTransaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTransaction = async () => {
      try {
        const result = await authFetch(`/api/stripe/transactions/${id}`, {}, router);
        if (!result) return;
        const { response, data } = result;
        if (!response.ok || !data.success) {
          setError(data.error || 'Transaction not found');
          setLoading(false);
          return;
        }
        setTransaction(data.transaction);
        setLoading(false);
      } catch {
        setError('Failed to load transaction');
        setLoading(false);
      }
    };
    if (id) fetchTransaction();
  }, [id, router]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-purple-600 hover:text-purple-800 mb-6"
        >
          ← Back to dashboard
        </Link>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            <p className="mt-2 text-gray-600 dark:text-gray-300">Loading transaction...</p>
          </div>
        ) : error ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-8 text-center">
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Transaction not found</h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{error}</p>
          </div>
        ) : transaction ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-4">
              <div>
                <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full text-purple-600 bg-purple-100 mb-2">
                  Card
                </span>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  ${transaction.amount_usd} {transaction.currency?.toUpperCase()}
                </div>
              </div>
              <span className={`inline-flex px-2.5 py-1 text-xs font-medium rounded-full ${statusColor(transaction.status)}`}>
                {transaction.status}
              </span>
            </div>

            <div className="px-6 py-2">
              {transaction.failure_reason && (
                <div className="my-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2">
                  <div className="text-xs font-medium text-red-700 dark:text-red-300">Failure reason</div>
                  <div className="text-sm text-red-800 dark:text-red-200">{transaction.failure_reason}</div>
                  {transaction.failure_code && (
                    <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">Code: {transaction.failure_code}</div>
                  )}
                </div>
              )}
              <Row label="Customer">
                {transaction.customer_name || transaction.customer_email ? (
                  <span>
                    {transaction.customer_name && <span className="font-medium">{transaction.customer_name}</span>}
                    {transaction.customer_name && transaction.customer_email && ' · '}
                    {transaction.customer_email && (
                      <a href={`mailto:${transaction.customer_email}`} className="text-purple-600 hover:underline">
                        {transaction.customer_email}
                      </a>
                    )}
                  </span>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </Row>
              <Row label="Business">{transaction.business_name}</Row>
              <Row label="Platform fee">${transaction.platform_fee_usd}</Row>
              <Row label="Stripe fee">${transaction.stripe_fee_usd}</Row>
              <Row label="Net to merchant">${transaction.net_to_merchant_usd}</Row>
              <Row label="Payment intent">{transaction.stripe_payment_intent_id || '—'}</Row>
              <Row label="Charge">{transaction.stripe_charge_id || '—'}</Row>
              <Row label="Created">{new Date(transaction.created_at).toLocaleString()}</Row>
              <Row label="Transaction ID">{transaction.id}</Row>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
