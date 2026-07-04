'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

interface PayPalConnectTabProps {
  businessId: string;
}

interface PaypalStatus {
  connected: boolean;
  environment?: 'sandbox' | 'live';
  email?: string | null;
  client_id_last4?: string;
  connected_at?: string;
}

export function PayPalConnectTab({ businessId }: PayPalConnectTabProps) {
  const router = useRouter();
  const [status, setStatus] = useState<PaypalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [environment, setEnvironment] = useState<'sandbox' | 'live'>('live');
  const [email, setEmail] = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      const result = await authFetch(`/api/paypal/connect/status/${businessId}`, {}, router);
      if (!result) return;
      const { response, data } = result;
      if (response.ok && data.success) {
        setStatus({
          connected: !!data.connected,
          environment: data.environment,
          email: data.email,
          client_id_last4: data.client_id_last4,
          connected_at: data.connected_at,
        });
      } else {
        setStatus({ connected: false });
      }
    } catch {
      setStatus({ connected: false });
    }
  }, [businessId, router]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchStatus();
      setLoading(false);
    };
    load();
  }, [fetchStatus]);

  const handleConnect = async () => {
    setError('');
    setSuccess('');
    if (!clientId.trim() || !clientSecret.trim()) {
      setError('Both Client ID and Secret are required.');
      return;
    }
    setSaving(true);
    try {
      const result = await authFetch('/api/paypal/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
          environment,
          email: email.trim() || undefined,
        }),
      }, router);
      if (!result) { setSaving(false); return; }
      const { response, data } = result;
      if (response.ok && data.success) {
        setSuccess('PayPal connected. New invoices you send can now be paid with PayPal.');
        setClientId('');
        setClientSecret('');
        setEmail('');
        await fetchStatus();
      } else {
        setError(data.error || 'Failed to connect PayPal.');
      }
    } catch {
      setError('Failed to connect PayPal.');
    }
    setSaving(false);
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError('');
    try {
      const result = await authFetch('/api/paypal/connect', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId }),
      }, router);
      if (!result) { setDisconnecting(false); return; }
      const { response, data } = result;
      if (response.ok && data.success) {
        setStatus({ connected: false });
        setShowDisconnectConfirm(false);
        setSuccess('PayPal disconnected.');
      } else {
        setError(data.error || 'Failed to disconnect PayPal.');
      }
    } catch {
      setError('Failed to disconnect PayPal.');
    }
    setDisconnecting(false);
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
        <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">Loading PayPal…</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {success && (
        <div className="bg-green-900/30 border border-green-700 text-green-300 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <span className="text-green-400">✓</span> {success}
        </div>
      )}
      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <section>
        <h3 className="text-lg font-semibold text-gray-100 mb-4">PayPal Status</h3>
        {status?.connected ? (
          <div className="bg-gray-800 rounded-lg p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <p className="text-sm text-gray-300">
                <span className="font-medium text-gray-400 dark:text-gray-500">Client ID:</span>{' '}
                <span className="font-mono text-xs text-gray-200">••••{status.client_id_last4}</span>
              </p>
              <p className="text-sm text-gray-300">
                <span className="font-medium text-gray-400 dark:text-gray-500">Environment:</span>{' '}
                <span className="text-gray-200 capitalize">{status.environment}</span>
              </p>
              {status.email && (
                <p className="text-sm text-gray-300">
                  <span className="font-medium text-gray-400 dark:text-gray-500">Email:</span>{' '}
                  <span className="text-gray-200">{status.email}</span>
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              <span className="px-3 py-1 text-xs font-medium rounded-full bg-green-900/50 text-green-400 border border-green-700">
                Connected
              </span>
              {status.environment === 'sandbox' && (
                <span className="px-3 py-1 text-xs font-medium rounded-full bg-yellow-900/50 text-yellow-400 border border-yellow-700">
                  Sandbox (test mode)
                </span>
              )}
            </div>

            <div className="pt-3 border-t border-gray-700">
              {!showDisconnectConfirm ? (
                <button
                  onClick={() => setShowDisconnectConfirm(true)}
                  className="px-4 py-1.5 bg-red-900/40 text-red-400 border border-red-700 text-xs font-medium rounded-lg hover:bg-red-900/70"
                >
                  Disconnect PayPal
                </button>
              ) : (
                <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg space-y-2">
                  <p className="text-sm font-medium text-red-300">Disconnect this PayPal account?</p>
                  <p className="text-xs text-red-400">The PayPal option will be removed from your open invoices. You can reconnect at any time.</p>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleDisconnect}
                      disabled={disconnecting}
                      className="px-4 py-1.5 bg-red-700 text-white text-xs font-medium rounded-lg hover:bg-red-600 disabled:opacity-50"
                    >
                      {disconnecting ? 'Disconnecting…' : 'Yes, Disconnect'}
                    </button>
                    <button
                      onClick={() => setShowDisconnectConfirm(false)}
                      disabled={disconnecting}
                      className="px-4 py-1.5 bg-gray-700 text-gray-300 text-xs font-medium rounded-lg hover:bg-gray-600 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="py-6 px-6 bg-gray-800 rounded-lg">
            <div className="text-center mb-5">
              <div className="text-4xl mb-3">🅿️</div>
              <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">This business is not connected to PayPal yet.</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                Create a REST API app in your{' '}
                <a
                  href="https://developer.paypal.com/dashboard/applications"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  PayPal Developer Dashboard
                </a>{' '}
                and paste its Client ID and Secret below. Payments go straight to your PayPal account.
              </p>
            </div>

            <div className="max-w-md mx-auto space-y-3">
              <div>
                <label htmlFor="pp-env" className="block text-xs font-medium text-gray-300 mb-1">Environment</label>
                <select
                  id="pp-env"
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value as 'sandbox' | 'live')}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="live">Live (real payments)</option>
                  <option value="sandbox">Sandbox (testing)</option>
                </select>
              </div>
              <div>
                <label htmlFor="pp-client-id" className="block text-xs font-medium text-gray-300 mb-1">Client ID</label>
                <input
                  id="pp-client-id"
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="PayPal REST app Client ID"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label htmlFor="pp-secret" className="block text-xs font-medium text-gray-300 mb-1">Secret</label>
                <input
                  id="pp-secret"
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="PayPal REST app Secret"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <p className="mt-1 text-[11px] text-gray-500">Stored encrypted. Only used to create and capture payments on your account.</p>
              </div>
              <div>
                <label htmlFor="pp-email" className="block text-xs font-medium text-gray-300 mb-1">PayPal email (optional)</label>
                <input
                  id="pp-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@business.com"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <button
                onClick={handleConnect}
                disabled={saving || !clientId.trim() || !clientSecret.trim()}
                className="w-full px-6 py-2 bg-[#0070ba] text-white text-sm font-medium rounded-lg hover:bg-[#005ea6] disabled:opacity-50"
              >
                {saving ? 'Connecting…' : 'Connect PayPal'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
