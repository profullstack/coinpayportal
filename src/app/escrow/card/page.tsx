'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface CardEscrow {
  id: string;
  business_id: string;
  stripe_payment_intent_id: string;
  amount_cents: number;
  currency: string;
  description: string;
  status: string;
  escrow_status: 'pending' | 'released' | 'refunded' | 'disputed';
  metadata: Record<string, unknown>;
  customer_email?: string;
  created_at: string;
  updated_at: string;
  released_at?: string;
  refunded_at?: string;
  stripe_charge_id?: string;
}

interface CardEscrowEvent {
  id: string;
  escrow_id: string;
  event_type: string;
  actor: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  released: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  refunded: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  disputed: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
};

const STATUS_DESCRIPTIONS: Record<string, string> = {
  pending: 'Funds held in escrow, awaiting release',
  released: 'Funds released to merchant',
  refunded: 'Funds refunded to customer',
  disputed: 'Dispute raised, under review',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <div className="text-center">
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-800'}`}>
        {status.replace('_', ' ')}
      </span>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
        {STATUS_DESCRIPTIONS[status] || status}
      </p>
    </div>
  );
}

function formatAmount(amountCents: number, currency = 'USD'): string {
  const amount = amountCents / 100;
  const formatters = {
    USD: (amt: number) => `$${amt.toFixed(2)}`,
    EUR: (amt: number) => `€${amt.toFixed(2)}`,
    GBP: (amt: number) => `£${amt.toFixed(2)}`,
    CAD: (amt: number) => `C$${amt.toFixed(2)}`,
  };
  
  const formatter = formatters[currency.toUpperCase() as keyof typeof formatters];
  return formatter ? formatter(amount) : `${amount.toFixed(2)} ${currency.toUpperCase()}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function copyToClipboard(text: string, field: string, setCopied: (field: string | null) => void) {
  navigator.clipboard.writeText(text);
  setCopied(field);
  setTimeout(() => setCopied(null), 2000);
}

export default function CardEscrowPage() {
  const router = useRouter();
  const [escrows, setEscrows] = useState<CardEscrow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterBusiness, setFilterBusiness] = useState<string>('');

  const loadEscrows = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      if (filterBusiness) params.set('businessId', filterBusiness);
      if (filterStatus) params.set('status', filterStatus);

      const result = await authFetch(`/api/stripe/escrows?${params.toString()}`);
      if (!result) {
        throw new Error('Not authenticated');
      }
      
      const { response, data } = result;

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load card escrows');
      }

      setEscrows(data.escrows || []);
    } catch (err) {
      console.error('Error loading card escrows:', err);
      setError(err instanceof Error ? err.message : 'Failed to load card escrows');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterBusiness]);

  const handleRelease = async (escrowId: string) => {
    setActionLoading(escrowId);
    setError('');

    try {
      const result = await authFetch('/api/stripe/escrow/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ escrowId }),
      });
      if (!result) throw new Error('Not authenticated');

      const { response, data } = result;

      if (!response.ok) {
        throw new Error(data.error || 'Failed to release escrow');
      }

      // Reload escrows to show updated status
      await loadEscrows();
    } catch (err) {
      console.error('Error releasing escrow:', err);
      setError(err instanceof Error ? err.message : 'Failed to release escrow');
    } finally {
      setActionLoading('');
    }
  };

  const handleRefund = async (escrowId: string, partial?: number) => {
    setActionLoading(escrowId);
    setError('');

    try {
      const body: any = { escrowId };
      if (partial) {
        body.amount = Math.round(partial * 100); // Convert to cents
      }

      const result = await authFetch('/api/stripe/escrow/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!result) throw new Error('Not authenticated');

      const { response, data } = result;

      if (!response.ok) {
        throw new Error(data.error || 'Failed to refund escrow');
      }

      // Reload escrows to show updated status
      await loadEscrows();
    } catch (err) {
      console.error('Error refunding escrow:', err);
      setError(err instanceof Error ? err.message : 'Failed to refund escrow');
    } finally {
      setActionLoading('');
    }
  };

  useEffect(() => {
    loadEscrows();
  }, [loadEscrows]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-300 dark:bg-gray-600 rounded mb-4"></div>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-300 dark:bg-gray-600 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Card Escrows</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Manage card payment escrows and releases
            </p>
          </div>
          <Link
            href="/payments"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            Create Payment
          </Link>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-6">
          <input
            type="text"
            placeholder="Filter by business ID..."
            value={filterBusiness}
            onChange={(e) => setFilterBusiness(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="released">Released</option>
            <option value="refunded">Refunded</option>
            <option value="disputed">Disputed</option>
          </select>
          <button
            onClick={loadEscrows}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-6 p-4 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-600 rounded-lg">
          <p className="text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Escrows List */}
      {escrows.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-500 dark:text-gray-400 mb-4">
            <svg className="mx-auto h-12 w-12 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-lg">No card escrows found</p>
            <p className="text-sm">Card escrows will appear here once created</p>
          </div>
          <Link
            href="/payments"
            className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Create First Payment
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {escrows.map((escrow) => (
            <div key={escrow.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Escrow Details */}
                <div className="lg:col-span-2">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-lg">
                        {escrow.description || 'Card Payment'}
                      </h3>
                      <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                        {formatAmount(escrow.amount_cents, escrow.currency)}
                      </p>
                    </div>
                    <StatusBadge status={escrow.escrow_status} />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div>
                      <label className="block text-gray-500 dark:text-gray-400 mb-1">Escrow ID</label>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-gray-900 dark:text-gray-100">{escrow.id.slice(0, 12)}...</span>
                        <button
                          onClick={() => copyToClipboard(escrow.id, `id-${escrow.id}`, setCopiedField)}
                          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          {copiedField === `id-${escrow.id}` ? '✓' : '📋'}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-gray-500 dark:text-gray-400 mb-1">Business ID</label>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-gray-900 dark:text-gray-100">{escrow.business_id}</span>
                        <button
                          onClick={() => copyToClipboard(escrow.business_id, `business-${escrow.id}`, setCopiedField)}
                          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          {copiedField === `business-${escrow.id}` ? '✓' : '📋'}
                        </button>
                      </div>
                    </div>

                    {escrow.stripe_charge_id && (
                      <div>
                        <label className="block text-gray-500 dark:text-gray-400 mb-1">Stripe Charge ID</label>
                        <div className="flex items-center space-x-2">
                          <span className="font-mono text-gray-900 dark:text-gray-100">{escrow.stripe_charge_id.slice(0, 12)}...</span>
                          <button
                            onClick={() => copyToClipboard(escrow.stripe_charge_id!, `charge-${escrow.id}`, setCopiedField)}
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                          >
                            {copiedField === `charge-${escrow.id}` ? '✓' : '📋'}
                          </button>
                        </div>
                      </div>
                    )}

                    {escrow.customer_email && (
                      <div>
                        <label className="block text-gray-500 dark:text-gray-400 mb-1">Customer Email</label>
                        <span className="text-gray-900 dark:text-gray-100">{escrow.customer_email}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Timestamps */}
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-3">Timestamps</h4>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">Created:</span>
                      <span className="block text-gray-900 dark:text-gray-100">{formatDate(escrow.created_at)}</span>
                    </div>
                    {escrow.released_at && (
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">Released:</span>
                        <span className="block text-gray-900 dark:text-gray-100">{formatDate(escrow.released_at)}</span>
                      </div>
                    )}
                    {escrow.refunded_at && (
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">Refunded:</span>
                        <span className="block text-gray-900 dark:text-gray-100">{formatDate(escrow.refunded_at)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-3">Actions</h4>
                  <div className="flex flex-col space-y-2">
                    {escrow.escrow_status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleRelease(escrow.id)}
                          disabled={actionLoading === escrow.id}
                          className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors text-sm"
                        >
                          {actionLoading === escrow.id ? 'Releasing...' : 'Release Funds'}
                        </button>
                        <button
                          onClick={() => handleRefund(escrow.id)}
                          disabled={actionLoading === escrow.id}
                          className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-lg transition-colors text-sm"
                        >
                          {actionLoading === escrow.id ? 'Refunding...' : 'Full Refund'}
                        </button>
                      </>
                    )}
                    
                    {escrow.escrow_status === 'released' && (
                      <div className="text-green-600 dark:text-green-400 text-sm font-medium">
                        ✅ Funds Released
                      </div>
                    )}
                    
                    {escrow.escrow_status === 'refunded' && (
                      <div className="text-red-600 dark:text-red-400 text-sm font-medium">
                        🔄 Funds Refunded
                      </div>
                    )}

                    <Link
                      href={`/escrow/card/${escrow.id}`}
                      className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors text-center text-sm"
                    >
                      View Details
                    </Link>
                  </div>
                </div>
              </div>

              {/* Metadata */}
              {Object.keys(escrow.metadata || {}).length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">Metadata</h4>
                  <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-md">
                    <pre className="text-xs text-gray-600 dark:text-gray-400 overflow-x-auto">
                      {JSON.stringify(escrow.metadata, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}