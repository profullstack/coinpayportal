'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import { formatAmount } from './stripe-helpers';

interface StripeConnectTabProps {
  businessId: string;
}

interface ConnectStatus {
  connected: boolean;
  account_id?: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
}

interface BalanceSummary {
  available: { amount: number; currency: string }[];
  pending: { amount: number; currency: string }[];
}

export function StripeConnectTab({ businessId }: StripeConnectTabProps) {
  const router = useRouter();
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [balance, setBalance] = useState<BalanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarding, setOnboarding] = useState(false);
  const [error, setError] = useState('');

  const fetchConnectStatus = useCallback(async () => {
    try {
      const result = await authFetch(`/api/stripe/connect/status/${businessId}`, {}, router);
      if (!result) return false;
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

  const fetchBalance = useCallback(async () => {
    try {
      const result = await authFetch(`/api/stripe/balance?business_id=${businessId}`, {}, router);
      if (!result) return;
      const { data } = result;
      if (data.success) setBalance(data.balance || null);
    } catch { /* ignore */ }
  }, [businessId, router]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const connected = await fetchConnectStatus();
      if (connected) await fetchBalance();
      setLoading(false);
    };
    load();
  }, [fetchConnectStatus, fetchBalance]);

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

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
        <p className="mt-2 text-sm text-gray-500">Loading Stripe Connect...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

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

      {connectStatus?.connected && balance && (
        <section>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Balance</h3>
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
        </section>
      )}
    </div>
  );
}
