'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import { formatAmount, formatDate, statusColors } from './stripe-helpers';
import { DisputeEvidenceModal } from '@/components/disputes/DisputeEvidenceModal';

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
  actionable?: boolean;
}

export function StripeDisputesTab({ businessId }: StripeDisputesTabProps) {
  const router = useRouter();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [evidenceDisputeId, setEvidenceDisputeId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const fetchDisputes = useCallback(async () => {
    try {
      const result = await authFetch(`/api/stripe/disputes?business_id=${businessId}`, {}, router);
      if (!result) return;
      const { data } = result;
      if (data.success) setDisputes(data.disputes || []);
    } catch { /* ignore */ }
  }, [businessId, router]);

  const handleAccept = async (id: string) => {
    if (
      !window.confirm(
        'Accept this dispute? You concede the charge — the cardholder keeps the funds and the dispute closes. This cannot be undone.'
      )
    ) {
      return;
    }
    setActionId(id);
    setNotice('');
    try {
      const result = await authFetch(`/api/stripe/disputes/${id}/accept`, { method: 'POST' }, router);
      if (!result) return;
      const { response, data } = result;
      if (response.ok && data.success) {
        setNotice('Dispute accepted — the cardholder keeps the funds.');
        await fetchDisputes();
      } else {
        setNotice(data.error || 'Failed to accept dispute');
      }
    } catch {
      setNotice('Failed to accept dispute');
    } finally {
      setActionId(null);
    }
  };

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
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">Loading disputes...</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Disputes</h3>
      {notice && (
        <div className="mb-4 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 px-4 py-2 text-sm text-purple-700 dark:text-purple-300">
          {notice}
        </div>
      )}
      {disputes.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 py-4">No disputes.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Amount</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Reason</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Status</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Due By</th>
                <th className="text-right py-2 px-3 font-medium text-gray-700 dark:text-gray-200">Actions</th>
              </tr>
            </thead>
            <tbody>
              {disputes.map((d) => (
                <tr key={d.id} className="border-b border-gray-100">
                  <td className="py-2 px-3 font-medium">{formatAmount(d.amount_cents, d.currency)}</td>
                  <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{d.reason?.replace(/_/g, ' ') || '—'}</td>
                  <td className="py-2 px-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${statusColors[d.status] || 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}>
                      {d.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{formatDate(d.evidence_due_by)}</td>
                  <td className="py-2 px-3">
                    {d.actionable ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setEvidenceDisputeId(d.id)}
                          disabled={actionId === d.id}
                          className="inline-flex items-center rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
                          title="Contest the dispute by submitting proof the customer received the deliverables"
                        >
                          Submit evidence
                        </button>
                        <button
                          onClick={() => handleAccept(d.id)}
                          disabled={actionId === d.id}
                          className="inline-flex items-center rounded-lg border border-red-300 dark:border-red-700 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                          title="Concede the dispute — the cardholder keeps the funds (the refund-equivalent for a disputed charge)"
                        >
                          {actionId === d.id ? 'Accepting…' : 'Accept (refund customer)'}
                        </button>
                      </div>
                    ) : (
                      <div className="text-right text-xs text-gray-400">—</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {evidenceDisputeId && (
        <DisputeEvidenceModal
          disputeId={evidenceDisputeId}
          onClose={() => setEvidenceDisputeId(null)}
          onSubmitted={() => {
            setNotice('Evidence submitted to Stripe.');
            fetchDisputes();
          }}
        />
      )}
    </div>
  );
}
