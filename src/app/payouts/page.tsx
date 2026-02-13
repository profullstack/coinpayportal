'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface Payout {
  id: string;
  stripe_payout_id: string;
  amount_cents: number;
  amount_usd: string;
  currency: string;
  status: string;
  arrival_date: string | null;
  description?: string;
  created_at: string;
  updated_at?: string;
}

interface Pagination {
  limit: number;
  offset: number;
  total: number;
  has_more: boolean;
}

export default function PayoutsPage() {
  const router = useRouter();
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Create payout form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createAmount, setCreateAmount] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const fetchPayouts = useCallback(async () => {
    setLoading(true);
    setError('');

    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    params.set('limit', '50');

    const qs = params.toString();
    const result = await authFetch(`/api/stripe/payouts${qs ? '?' + qs : ''}`, {}, router);
    if (!result) return;

    const { response, data } = result;
    if (response.ok && data.success) {
      setPayouts(data.payouts || []);
      setPagination(data.pagination || null);
    } else {
      setError(data.error || 'Failed to fetch payouts');
    }
    setLoading(false);
  }, [statusFilter, dateFrom, dateTo, router]);

  useEffect(() => {
    fetchPayouts();
  }, [fetchPayouts]);

  const handleCreatePayout = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError('');

    const amountCents = Math.round(parseFloat(createAmount) * 100);
    if (!amountCents || amountCents <= 0) {
      setCreateError('Please enter a valid amount');
      setCreating(false);
      return;
    }

    const result = await authFetch('/api/stripe/payouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: amountCents,
        currency: 'usd',
        description: createDescription || undefined,
      }),
    }, router);

    if (!result) {
      setCreating(false);
      return;
    }

    const { response, data } = result;
    if (response.ok && data.success) {
      setShowCreateForm(false);
      setCreateAmount('');
      setCreateDescription('');
      fetchPayouts();
    } else {
      setCreateError(data.error || 'Failed to create payout');
    }
    setCreating(false);
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      paid: 'bg-green-100 text-green-800',
      pending: 'bg-yellow-100 text-yellow-800',
      in_transit: 'bg-blue-100 text-blue-800',
      failed: 'bg-red-100 text-red-800',
      canceled: 'bg-gray-100 text-gray-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Payouts</h1>
          <p className="text-gray-600 mt-1">
            Manage payouts to your connected Stripe account
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/dashboard" className="px-4 py-2 border rounded-lg hover:bg-gray-50">
            ← Dashboard
          </Link>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {showCreateForm ? 'Cancel' : '+ Create Payout'}
          </button>
        </div>
      </div>

      {/* Create Payout Form */}
      {showCreateForm && (
        <div className="mb-6 p-6 bg-white border rounded-lg shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Create New Payout</h2>
          <form onSubmit={handleCreatePayout} className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount (USD)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.50"
                value={createAmount}
                onChange={(e) => setCreateAmount(e.target.value)}
                placeholder="50.00"
                className="px-3 py-2 border rounded-lg w-40"
                required
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description (optional)
              </label>
              <input
                type="text"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="Weekly payout"
                className="px-3 py-2 border rounded-lg w-full"
              />
            </div>
            <button
              type="submit"
              disabled={creating}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Payout'}
            </button>
          </form>
          {createError && (
            <p className="mt-3 text-red-600 text-sm">{createError}</p>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="in_transit">In Transit</option>
          <option value="paid">Paid</option>
          <option value="failed">Failed</option>
          <option value="canceled">Canceled</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="px-3 py-2 border rounded-lg"
          placeholder="From date"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="px-3 py-2 border rounded-lg"
          placeholder="To date"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">{error}</div>
      )}

      {/* Payouts Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading payouts...</div>
      ) : payouts.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No payouts yet</p>
          <p className="mt-2">Create your first payout to transfer funds to your bank account.</p>
        </div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">ID</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Amount</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Arrival Date</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payouts.map((payout) => (
                <tr key={payout.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono">
                    {payout.stripe_payout_id || payout.id}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold">
                    ${payout.amount_usd}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${statusBadge(payout.status)}`}>
                      {payout.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {payout.arrival_date
                      ? new Date(payout.arrival_date).toLocaleDateString()
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {new Date(payout.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pagination && pagination.has_more && (
            <div className="px-4 py-3 border-t text-center text-sm text-gray-500">
              Showing {payouts.length} of {pagination.total} payouts
            </div>
          )}
        </div>
      )}
    </div>
  );
}
