'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
  email?: string;
  country?: string;
  onboarding_complete?: boolean;
  requirements_due?: string[];
  disabled_reason?: string | null;
}

interface BalanceSummary {
  available: { amount: number; currency: string }[];
  pending: { amount: number; currency: string }[];
}

export function StripeConnectTab({ businessId }: StripeConnectTabProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [balance, setBalance] = useState<BalanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarding, setOnboarding] = useState(false);
  const [error, setError] = useState('');
  const [justConnected, setJustConnected] = useState(false);

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
          email: data.email,
          country: data.country,
          onboarding_complete: data.onboarding_complete,
          requirements_due: data.requirements_due,
          disabled_reason: data.disabled_reason,
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
    // Detect return from Stripe onboarding
    if (searchParams.get('stripe_onboarding') === 'complete') {
      setJustConnected(true);
    }
  }, [searchParams]);

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
        <p className="mt-2 text-sm text-gray-400">Loading Stripe Connect...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {justConnected && connectStatus?.connected && (
        <div className="bg-green-900/30 border border-green-700 text-green-300 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <span className="text-green-400">✓</span>
          Stripe Connect onboarding completed successfully! Your account is now linked.
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <section>
        <h3 className="text-lg font-semibold text-gray-100 mb-4">Connect Status</h3>
        {connectStatus?.connected ? (
          <div className="bg-gray-800 rounded-lg p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <p className="text-sm text-gray-300">
                <span className="font-medium text-gray-400">Account ID:</span>{' '}
                <span className="font-mono text-xs text-gray-200">{connectStatus.account_id}</span>
              </p>
              {connectStatus.email && (
                <p className="text-sm text-gray-300">
                  <span className="font-medium text-gray-400">Email:</span>{' '}
                  <span className="text-gray-200">{connectStatus.email}</span>
                </p>
              )}
              {connectStatus.country && (
                <p className="text-sm text-gray-300">
                  <span className="font-medium text-gray-400">Country:</span>{' '}
                  <span className="text-gray-200">{connectStatus.country}</span>
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              <span className={`px-3 py-1 text-xs font-medium rounded-full ${connectStatus.charges_enabled ? 'bg-green-900/50 text-green-400 border border-green-700' : 'bg-red-900/50 text-red-400 border border-red-700'}`}>
                Charges {connectStatus.charges_enabled ? 'Enabled' : 'Disabled'}
              </span>
              <span className={`px-3 py-1 text-xs font-medium rounded-full ${connectStatus.payouts_enabled ? 'bg-green-900/50 text-green-400 border border-green-700' : 'bg-red-900/50 text-red-400 border border-red-700'}`}>
                Payouts {connectStatus.payouts_enabled ? 'Enabled' : 'Disabled'}
              </span>
              <span className={`px-3 py-1 text-xs font-medium rounded-full ${connectStatus.details_submitted ? 'bg-green-900/50 text-green-400 border border-green-700' : 'bg-yellow-900/50 text-yellow-400 border border-yellow-700'}`}>
                Details {connectStatus.details_submitted ? 'Submitted' : 'Pending'}
              </span>
            </div>

            {connectStatus.requirements_due && connectStatus.requirements_due.length > 0 && (
              <div className="mt-3 p-3 bg-yellow-900/20 border border-yellow-800 rounded-lg">
                <p className="text-sm font-medium text-yellow-400 mb-1">Requirements Due:</p>
                <ul className="text-xs text-yellow-300 list-disc list-inside space-y-0.5">
                  {connectStatus.requirements_due.map((req, i) => (
                    <li key={i}>{req.replace(/_/g, ' ')}</li>
                  ))}
                </ul>
                <button
                  onClick={handleOnboard}
                  disabled={onboarding}
                  className="mt-2 px-4 py-1.5 bg-yellow-600 text-white text-xs font-medium rounded-lg hover:bg-yellow-500 disabled:opacity-50"
                >
                  {onboarding ? 'Loading...' : 'Complete Requirements'}
                </button>
              </div>
            )}

            {connectStatus.disabled_reason && (
              <div className="mt-2 p-3 bg-red-900/20 border border-red-800 rounded-lg">
                <p className="text-sm text-red-400">
                  <span className="font-medium">Disabled:</span> {connectStatus.disabled_reason.replace(/_/g, ' ')}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 bg-gray-800 rounded-lg">
            <div className="text-4xl mb-3">💳</div>
            <p className="text-sm text-gray-400 mb-1">This business is not connected to Stripe yet.</p>
            <p className="text-xs text-gray-500 mb-4">Connect your Stripe account to accept credit card payments.</p>
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
          <h3 className="text-lg font-semibold text-gray-100 mb-4">Balance</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-sm text-gray-400 mb-1">Available</p>
              {balance.available.length > 0 ? balance.available.map((b, i) => (
                <p key={i} className="text-xl font-bold text-green-400">{formatAmount(b.amount, b.currency)}</p>
              )) : <p className="text-xl font-bold text-gray-500">$0.00</p>}
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-sm text-gray-400 mb-1">Pending</p>
              {balance.pending.length > 0 ? balance.pending.map((b, i) => (
                <p key={i} className="text-xl font-bold text-yellow-400">{formatAmount(b.amount, b.currency)}</p>
              )) : <p className="text-xl font-bold text-gray-500">$0.00</p>}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
