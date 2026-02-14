'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import { formatAmount, formatDate, statusColors } from './stripe-helpers';

interface StripePayoutsTabProps {
  businessId: string;
}

interface Payout {
  id: string;
  amount: number;
  currency: string;
  status: string;
  arrival_date: string | null;
}

export function StripePayoutsTab({ businessId }: StripePayoutsTabProps) {
  const router = useRouter();
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPayouts = useCallback(async () => {
    try {
      const result = await authFetch(`/api/stripe/payouts?business_id=${businessId}`, {}, router);
      if (!result) return;
      const { data } = result;
      if (data.success) setPayouts(data.payouts || []);
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
        <p className="mt-2 text-sm text-gray-500">Loading payouts...</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Payouts</h3>
      {payouts.length === 0 ? (
        <p className="text-sm text-gray-500 py-4">No payouts yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 font-medium text-gray-700">Amount</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700">Status</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700">Arrival Date</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id} className="border-b border-gray-100">
                  <td className="py-2 px-3 font-medium">{formatAmount(p.amount, p.currency)}</td>
                  <td className="py-2 px-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${statusColors[p.status] || 'bg-gray-100 text-gray-700'}`}>
                      {p.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-gray-600">{formatDate(p.arrival_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
