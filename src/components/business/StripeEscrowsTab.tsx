'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import { formatAmount, statusColors } from './stripe-helpers';

interface StripeEscrowsTabProps {
  businessId: string;
}

interface Escrow {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export function StripeEscrowsTab({ businessId }: StripeEscrowsTabProps) {
  const router = useRouter();
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchEscrows = useCallback(async () => {
    try {
      const result = await authFetch(`/api/stripe/escrows?business_id=${businessId}`, {}, router);
      if (!result) return;
      const { data } = result;
      if (data.success) setEscrows(data.escrows || []);
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

  const handleEscrowAction = async (escrowId: string, action: 'release' | 'refund') => {
    setActionLoading(escrowId);
    setError('');
    try {
      const result = await authFetch(`/api/stripe/escrow/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ escrow_id: escrowId }),
      }, router);
      if (!result) { setActionLoading(null); return; }
      const { response, data } = result;
      if (response.ok && data.success) {
        setSuccess(`Escrow ${action}d successfully`);
        setTimeout(() => setSuccess(''), 3000);
        fetchEscrows();
      } else {
        setError(data.error || `Failed to ${action} escrow`);
      }
    } catch {
      setError(`Failed to ${action} escrow`);
    }
    setActionLoading(null);
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
        <p className="mt-2 text-sm text-gray-500">Loading escrows...</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Escrows</h3>
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}
      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{success}</div>
      )}
      {escrows.length === 0 ? (
        <p className="text-sm text-gray-500 py-4">No escrows.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 font-medium text-gray-700">Amount</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700">Status</th>
                <th className="text-left py-2 px-3 font-medium text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {escrows.map((e) => (
                <tr key={e.id} className="border-b border-gray-100">
                  <td className="py-2 px-3 font-medium">{formatAmount(e.amount, e.currency)}</td>
                  <td className="py-2 px-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${statusColors[e.status] || 'bg-gray-100 text-gray-700'}`}>
                      {e.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    {(e.status === 'held' || e.status === 'funded') && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEscrowAction(e.id, 'release')}
                          disabled={actionLoading === e.id}
                          className="px-3 py-1 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-500 disabled:opacity-50"
                        >
                          Release
                        </button>
                        <button
                          onClick={() => handleEscrowAction(e.id, 'refund')}
                          disabled={actionLoading === e.id}
                          className="px-3 py-1 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-500 disabled:opacity-50"
                        >
                          Refund
                        </button>
                      </div>
                    )}
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
