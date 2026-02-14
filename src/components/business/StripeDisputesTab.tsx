'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import { formatAmount, formatDate, statusColors } from './stripe-helpers';

interface StripeDisputesTabProps {
  businessId: string;
}

interface Dispute {
  id: string;
  amount_cents: number;
  currency: string;
  reason: string;
  status: string;
  evidence_due_by: string | null;
}

export function StripeDisputesTab({ businessId }: StripeDisputesTabProps) {
  const router = useRouter();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDisputes = useCallback(async () => {
    try {
      const result = await authFetch(`/api/stripe/disputes?business_id=${businessId}`, {}, router);
      if (!result) return;
      const { data } = result;
      if (data.success) setDisputes(data.disputes || []);
    } catch { /* ignore */ }
  }, [businessId, router]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchDisputes();
      setLoading(false);
    };
    load();
  }, [fetchDisputes]);

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
        <p className="mt-2 text-sm text-gray-500">Loading disputes...</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Disputes</h3>
      {disputes.length === 0 ? (
        <p className="text-sm text-gray-500 py-4">No disputes.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 font-medium text-gray-700">Amount</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700">Reason</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700">Status</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700">Due By</th>
              </tr>
            </thead>
            <tbody>
              {disputes.map((d) => (
                <tr key={d.id} className="border-b border-gray-100">
                  <td className="py-2 px-3 font-medium">{formatAmount(d.amount_cents, d.currency)}</td>
                  <td className="py-2 px-3 text-gray-600">{d.reason?.replace(/_/g, ' ') || '—'}</td>
                  <td className="py-2 px-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${statusColors[d.status] || 'bg-gray-100 text-gray-700'}`}>
                      {d.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-gray-600">{formatDate(d.evidence_due_by)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
