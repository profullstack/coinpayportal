'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface EscrowSeries {
  id: string;
  merchant_id: string;
  payment_method: string;
  customer_email: string | null;
  description: string | null;
  amount: number;
  currency: string;
  coin: string | null;
  interval: string;
  next_charge_at: string;
  max_periods: number | null;
  periods_completed: number;
  status: string;
  beneficiary_address: string | null;
  depositor_address: string | null;
  created_at: string;
  updated_at: string;
}

interface Escrow {
  id: string;
  depositor_address: string;
  beneficiary_address: string;
  escrow_address: string;
  chain: string;
  amount: number;
  amount_usd: number | null;
  fee_amount: number | null;
  deposited_amount: number | null;
  status: string;
  deposit_tx_hash: string | null;
  settlement_tx_hash: string | null;
  metadata: Record<string, unknown>;
  dispute_reason: string | null;
  created_at: string;
  funded_at: string | null;
  settled_at: string | null;
  expires_at: string;
}

interface EscrowEvent {
  id: string;
  event_type: string;
  actor: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  created: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  funded: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  released: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  settled: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  disputed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  refunded: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  expired: 'bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-500',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-800'}`}>
      {status}
    </span>
  );
}

function shortenAddress(addr: string, chars = 6): string {
  if (addr.length <= chars * 2 + 2) return addr;
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function CopyAllInfoButton({ escrow }: { escrow: Escrow }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const info = [
      `Escrow ID: ${escrow.id}`,
      `Payment Address: ${escrow.escrow_address}`,
      `Amount: ${escrow.amount} ${escrow.chain}`,
      `Chain: ${escrow.chain}`,
      `Status: ${escrow.status}`,
      `Created: ${formatDate(escrow.created_at)}`,
      `Expires: ${formatDate(escrow.expires_at)}`,
      `Depositor: ${escrow.depositor_address}`,
      `Beneficiary: ${escrow.beneficiary_address}`,
      ...(escrow.amount_usd ? [`USD Value: $${escrow.amount_usd.toFixed(2)}`] : []),
      ...(escrow.deposit_tx_hash ? [`Deposit TX: ${escrow.deposit_tx_hash}`] : []),
      ...(escrow.settlement_tx_hash ? [`Settlement TX: ${escrow.settlement_tx_hash}`] : []),
    ].join('\n');

    try {
      await navigator.clipboard.writeText(info);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="w-full mb-4 px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
    >
      {copied ? '✓ Copied!' : '📋 Copy All Info'}
    </button>
  );
}

export default function EscrowDashboardPage() {
  const router = useRouter();
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [series, setSeries] = useState<EscrowSeries[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedEscrow, setSelectedEscrow] = useState<Escrow | null>(null);
  const [events, setEvents] = useState<EscrowEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const cancelSeries = async (seriesId: string) => {
    if (!confirm('Cancel this recurring series? This cannot be undone.')) return;
    try {
      const result = await authFetch(`/api/escrow/series/${seriesId}`, {
        method: 'DELETE',
      }, router);
      if (result && result.response.ok) {
        // Refresh
        fetchEscrows();
      } else {
        setError(result?.data?.error || 'Failed to cancel series');
      }
    } catch (err) {
      setError('Failed to cancel series');
      console.error(err);
    }
  };

  const fetchEscrows = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);

      const result = await authFetch(`/api/escrow?${params.toString()}`, {}, router);
      if (!result) return;

      const { data } = result;
      setEscrows(data.escrows || []);
      setTotal(data.total || 0);

      // Also fetch recurring series
      const seriesResult = await authFetch('/api/escrow/series?business_id=all', {}, router);
      if (seriesResult) {
        setSeries(seriesResult.data.series || []);
      }
    } catch (err) {
      setError('Failed to load escrows');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, router]);

  useEffect(() => {
    fetchEscrows();
  }, [fetchEscrows]);

  const fetchEvents = async (escrowId: string) => {
    try {
      setEventsLoading(true);
      const res = await fetch(`/api/escrow/${escrowId}/events`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch (err) {
      console.error('Failed to load events:', err);
    } finally {
      setEventsLoading(false);
    }
  };

  const selectEscrow = (escrow: Escrow) => {
    setSelectedEscrow(escrow);
    fetchEvents(escrow.id);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Escrow</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage crypto escrows for jobs and gigs
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/escrow/manage"
            className="border border-blue-600 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 px-4 py-2 rounded-lg font-medium transition-colors"
          >
            Manage Escrow
          </Link>
          <Link
            href="/escrow/create"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            New Escrow
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        {['', 'pending', 'funded', 'released', 'settled', 'disputed', 'refunded', 'expired'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === s
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
          <p className="text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Recurring Series */}
      {!loading && series.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">🔄 Recurring Series</h2>
          <div className="space-y-3">
            {series.map((s) => (
              <div
                key={s.id}
                className="p-4 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-sm text-gray-500 dark:text-gray-400">
                    {s.id.slice(0, 8)}...
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 capitalize">
                      {s.interval}
                    </span>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[s.status] || 'bg-gray-100 text-gray-800'}`}>
                      {s.status}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold text-gray-900 dark:text-white">
                    {s.amount} {s.coin || s.currency}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {s.periods_completed}/{s.max_periods || '∞'} periods
                  </span>
                </div>
                {s.description && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">{s.description}</p>
                )}
                <div className="flex items-center justify-between mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {s.beneficiary_address && (
                    <span>→ {shortenAddress(s.beneficiary_address)}</span>
                  )}
                  <span>Next: {new Date(s.next_charge_at).toLocaleDateString()}</span>
                </div>
                {s.status === 'active' && (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => cancelSeries(s.id)}
                      className="px-3 py-1 text-xs font-medium text-red-600 border border-red-300 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      Cancel Series
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : escrows.length === 0 && series.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
          <p className="text-gray-500 dark:text-gray-400">No escrows found</p>
          <Link href="/escrow/create" className="text-blue-600 hover:underline mt-2 inline-block">
            Create your first escrow →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Escrow List */}
          <div className="lg:col-span-2 space-y-3">
            {escrows.map((escrow) => (
              <button
                key={escrow.id}
                onClick={() => selectEscrow(escrow)}
                className={`w-full text-left p-4 rounded-lg border transition-colors ${
                  selectedEscrow?.id === escrow.id
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-sm text-gray-500 dark:text-gray-400">
                    {escrow.id.slice(0, 8)}...
                  </span>
                  <StatusBadge status={escrow.status} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold text-gray-900 dark:text-white">
                    {escrow.amount} {escrow.chain}
                  </span>
                  {escrow.amount_usd && (
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      ≈ ${escrow.amount_usd.toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-gray-500 dark:text-gray-400">
                  <span>→ {shortenAddress(escrow.beneficiary_address)}</span>
                  <span>{formatDate(escrow.created_at)}</span>
                </div>
                {escrow.fee_amount != null && escrow.fee_amount > 0 && (
                  <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    Commission: {escrow.fee_amount} {escrow.chain} ({escrow.amount ? ((escrow.fee_amount / escrow.amount) * 100).toFixed(1) : '?'}%)
                  </div>
                )}
                {escrow.metadata && Object.keys(escrow.metadata).length > 0 && (
                  <div className="mt-2 text-xs text-gray-400">
                    {(escrow.metadata as any).job || (escrow.metadata as any).description || JSON.stringify(escrow.metadata).slice(0, 60)}
                  </div>
                )}
              </button>
            ))}
            <p className="text-center text-sm text-gray-400 mt-4">
              Showing {escrows.length} of {total} escrows
            </p>
          </div>

          {/* Detail Panel */}
          <div className="lg:col-span-1">
            {selectedEscrow ? (
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-5 sticky top-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">Details</h2>
                  <StatusBadge status={selectedEscrow.status} />
                </div>

                <CopyAllInfoButton escrow={selectedEscrow} />

                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Escrow ID</dt>
                    <dd className="font-mono text-gray-900 dark:text-white break-all">{selectedEscrow.id}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Amount</dt>
                    <dd className="text-gray-900 dark:text-white font-semibold">
                      {selectedEscrow.amount} {selectedEscrow.chain}
                      {selectedEscrow.amount_usd && (
                        <span className="font-normal text-gray-500"> (${selectedEscrow.amount_usd.toFixed(2)})</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Escrow Address</dt>
                    <dd className="font-mono text-gray-900 dark:text-white break-all text-xs">{selectedEscrow.escrow_address}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Depositor</dt>
                    <dd className="font-mono text-gray-900 dark:text-white break-all text-xs">{selectedEscrow.depositor_address}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Beneficiary</dt>
                    <dd className="font-mono text-gray-900 dark:text-white break-all text-xs">{selectedEscrow.beneficiary_address}</dd>
                  </div>
                  {selectedEscrow.deposited_amount && (
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">Deposited</dt>
                      <dd className="text-gray-900 dark:text-white">{selectedEscrow.deposited_amount} {selectedEscrow.chain}</dd>
                    </div>
                  )}
                  {selectedEscrow.fee_amount != null && selectedEscrow.fee_amount > 0 && (
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">Platform Commission</dt>
                      <dd className="text-amber-600 dark:text-amber-400 font-medium">{selectedEscrow.fee_amount} {selectedEscrow.chain} ({((selectedEscrow.fee_amount / selectedEscrow.amount) * 100).toFixed(1)}%)</dd>
                    </div>
                  )}
                  {selectedEscrow.deposit_tx_hash && (
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">Deposit TX</dt>
                      <dd className="font-mono text-xs text-blue-600 break-all">{selectedEscrow.deposit_tx_hash}</dd>
                    </div>
                  )}
                  {selectedEscrow.settlement_tx_hash && (
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">Settlement TX</dt>
                      <dd className="font-mono text-xs text-green-600 break-all">{selectedEscrow.settlement_tx_hash}</dd>
                    </div>
                  )}
                  {selectedEscrow.dispute_reason && (
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">Dispute Reason</dt>
                      <dd className="text-red-600 dark:text-red-400">{selectedEscrow.dispute_reason}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Created</dt>
                    <dd className="text-gray-900 dark:text-white">{formatDate(selectedEscrow.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Expires</dt>
                    <dd className="text-gray-900 dark:text-white">{formatDate(selectedEscrow.expires_at)}</dd>
                  </div>
                  {selectedEscrow.metadata && Object.keys(selectedEscrow.metadata).length > 0 && (
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">Metadata</dt>
                      <dd className="text-gray-900 dark:text-white text-xs">
                        <pre className="bg-gray-50 dark:bg-gray-900 rounded p-2 overflow-auto max-h-32">
                          {JSON.stringify(selectedEscrow.metadata, null, 2)}
                        </pre>
                      </dd>
                    </div>
                  )}
                </dl>

                {/* Event Log */}
                <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Event Log</h3>
                  {eventsLoading ? (
                    <div className="animate-pulse space-y-2">
                      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                    </div>
                  ) : events.length === 0 ? (
                    <p className="text-sm text-gray-400">No events</p>
                  ) : (
                    <div className="space-y-2">
                      {events.map((event) => (
                        <div key={event.id} className="flex items-start gap-2 text-xs">
                          <span className="text-gray-400 whitespace-nowrap">
                            {formatDate(event.created_at)}
                          </span>
                          <span className={`font-medium ${
                            event.event_type === 'funded' ? 'text-blue-600' :
                            event.event_type === 'settled' ? 'text-green-600' :
                            event.event_type === 'disputed' ? 'text-red-600' :
                            event.event_type === 'refunded' ? 'text-orange-600' :
                            'text-gray-600 dark:text-gray-400'
                          }`}>
                            {event.event_type}
                          </span>
                          {event.actor && event.actor !== 'system' && (
                            <span className="text-gray-400">{shortenAddress(event.actor)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-8 text-center">
                <p className="text-gray-400">Select an escrow to view details</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
