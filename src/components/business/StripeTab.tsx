'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

interface StripeTabProps {
  businessId: string;
}

interface ConnectStatus {
  connected: boolean;
  account_id?: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
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

interface Dispute {
  id: string;
  amount_cents: number;
  currency: string;
  reason: string;
  status: string;
  evidence_due_by: string | null;
}

interface Payout {
  id: string;
  amount: number;
  currency: string;
  status: string;
  arrival_date: string | null;
}

interface Escrow {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

interface BalanceSummary {
  available: { amount: number; currency: string }[];
  pending: { amount: number; currency: string }[];
}

export function StripeTab({ businessId }: StripeTabProps) {
  const router = useRouter();
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [balance, setBalance] = useState<BalanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarding, setOnboarding] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchConnectStatus = useCallback(async () => {
    try {
      // First check if the business has a stripe account
      const result = await authFetch(`/api/stripe/connect/status/${businessId}`, {}, router);
      if (!result) return;
      const { response, data } = result;
      if (response.ok && data.success) {
        setConnectStatus({
          connected: true,
          account_id: data.account_id,
          charges_enabled: data.charges_enabled,
          payouts_enabled: data.payouts_enabled,
          details_submitted: data.details_submitted,
        });
        return true;
      }
      setConnectStatus({ connected: false });
      return false;
    } catch {
      setConnectStatus({ connected: false });
      return false;
    }
  }, [businessId, router]);

  const fetchTransactions = useCallback(async () => {
    try {
      const result = await authFetch(`/api/stripe/transactions?business_id=${businessId}&limit=20`, {}, router);
      if (!result) return;
      const { data } = result;
      if (data.success) setTransactions(data.transactions || []);
    } catch { /* ignore */ }
  }, [businessId, router]);

  const fetchDisputes = useCallback(async () => {
    try {
      const result = await authFetch(`/api/stripe/disputes?business_id=${businessId}`, {}, router);
      if (!result) return;
      const { data } = result;
      if (data.success) setDisputes(data.disputes || []);
    } catch { /* ignore */ }
  }, [businessId, router]);

  const fetchPayouts = useCallback(async () => {
    try {
      const result = await authFetch(`/api/stripe/payouts?business_id=${businessId}`, {}, router);
      if (!result) return;
      const { data } = result;
      if (data.success) setPayouts(data.payouts || []);
    } catch { /* ignore */ }
  }, [businessId, router]);

  const fetchEscrows = useCallback(async () => {
    try {
      const result = await authFetch(`/api/stripe/escrows?business_id=${businessId}`, {}, router);
      if (!result) return;
      const { data } = result;
      if (data.success) setEscrows(data.escrows || []);
    } catch { /* ignore */ }
  }, [businessId, router]);

  const fetchBalance = useCallback(async () => {
    try {
      const result = await authFetch(`/api/stripe/balance?business_id=${businessId}`, {}, router);
      if (!result) return;
      const { data } = result;
      if (data.success) setBalance(data.balance || null);
    } catch { /* ignore */ }
  }, [businessId, router]);

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      const connected = await fetchConnectStatus();
      if (connected) {
        await Promise.all([
          fetchTransactions(),
          fetchDisputes(),
          fetchPayouts(),
          fetchEscrows(),
          fetchBalance(),
        ]);
      }
      setLoading(false);
    };
    loadAll();
  }, [fetchConnectStatus, fetchTransactions, fetchDisputes, fetchPayouts, fetchEscrows, fetchBalance]);

  const handleOnboard = async () => {
    setOnboarding(true);
    setError('');
    try {
      const result = await authFetch('/api/stripe/connect/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId }),
      }, router);
      if (!result) { setOnboarding(false); return; }
      const { response, data } = result;
      if (response.ok && data.success && data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Failed to start Stripe onboarding');
      }
    } catch {
      setError('Failed to start Stripe onboarding');
    }
    setOnboarding(false);
  };

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

  const formatAmount = (cents: number, currency: string = 'usd') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      succeeded: 'bg-green-100 text-green-700',
      completed: 'bg-green-100 text-green-700',
      paid: 'bg-green-100 text-green-700',
      released: 'bg-green-100 text-green-700',
      pending: 'bg-yellow-100 text-yellow-700',
      held: 'bg-yellow-100 text-yellow-700',
      funded: 'bg-yellow-100 text-yellow-700',
      in_transit: 'bg-blue-100 text-blue-700',
      failed: 'bg-red-100 text-red-700',
      refunded: 'bg-gray-100 text-gray-700',
      canceled: 'bg-gray-100 text-gray-700',
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
        <p className="mt-2 text-sm text-gray-500">Loading Stripe data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{success}</div>
      )}

      {/* Connect Status */}
      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Connect Status</h3>
        {connectStatus?.connected ? (
          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <p className="text-sm text-gray-700">
              <span className="font-medium">Account ID:</span>{' '}
              <span className="font-mono text-xs">{connectStatus.account_id}</span>
            </p>
            <div className="flex flex-wrap gap-3">
              <span className={`px-3 py-1 text-xs font-medium rounded-full ${connectStatus.charges_enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                Charges {connectStatus.charges_enabled ? 'Enabled' : 'Disabled'}
              </span>
              <span className={`px-3 py-1 text-xs font-medium rounded-full ${connectStatus.payouts_enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                Payouts {connectStatus.payouts_enabled ? 'Enabled' : 'Disabled'}
              </span>
              <span className={`px-3 py-1 text-xs font-medium rounded-full ${connectStatus.details_submitted ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                Details {connectStatus.details_submitted ? 'Submitted' : 'Pending'}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600 mb-4">This business is not connected to Stripe yet.</p>
            <button
              onClick={handleOnboard}
              disabled={onboarding}
              className="px-6 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500 disabled:opacity-50"
            >
              {onboarding ? 'Connecting...' : 'Connect with Stripe'}
            </button>
          </div>
        )}
      </section>

      {connectStatus?.connected && (
        <>
          {/* Balance */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Balance</h3>
            {balance ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-500 mb-1">Available</p>
                  {balance.available.length > 0 ? balance.available.map((b, i) => (
                    <p key={i} className="text-xl font-bold text-green-600">{formatAmount(b.amount, b.currency)}</p>
                  )) : <p className="text-xl font-bold text-gray-400">$0.00</p>}
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-500 mb-1">Pending</p>
                  {balance.pending.length > 0 ? balance.pending.map((b, i) => (
                    <p key={i} className="text-xl font-bold text-yellow-600">{formatAmount(b.amount, b.currency)}</p>
                  )) : <p className="text-xl font-bold text-gray-400">$0.00</p>}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No balance data available.</p>
            )}
          </section>

          {/* Card Transactions */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Card Transactions</h3>
            {transactions.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">No transactions yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-3 font-medium text-gray-700">Amount</th>
                      <th className="text-left py-2 px-3 font-medium text-gray-700">Status</th>
                      <th className="text-left py-2 px-3 font-medium text-gray-700">Customer</th>
                      <th className="text-left py-2 px-3 font-medium text-gray-700">Date</th>
                      <th className="text-left py-2 px-3 font-medium text-gray-700">Charge ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => (
                      <tr key={tx.id} className="border-b border-gray-100">
                        <td className="py-2 px-3 font-medium">{formatAmount(tx.amount, tx.currency)}</td>
                        <td className="py-2 px-3">{statusBadge(tx.status)}</td>
                        <td className="py-2 px-3 text-gray-600">{tx.customer_email || '—'}</td>
                        <td className="py-2 px-3 text-gray-600">{formatDate(tx.created_at)}</td>
                        <td className="py-2 px-3 font-mono text-xs text-gray-500">{tx.stripe_charge_id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Disputes */}
          <section>
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
                        <td className="py-2 px-3">{statusBadge(d.status)}</td>
                        <td className="py-2 px-3 text-gray-600">{formatDate(d.evidence_due_by)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Payouts */}
          <section>
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
                        <td className="py-2 px-3">{statusBadge(p.status)}</td>
                        <td className="py-2 px-3 text-gray-600">{formatDate(p.arrival_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Escrows */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Escrows</h3>
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
                        <td className="py-2 px-3">{statusBadge(e.status)}</td>
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
          </section>
        </>
      )}
    </div>
  );
}
