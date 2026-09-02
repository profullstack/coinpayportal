'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

interface PayPalConnectTabProps {
  businessId: string;
}

interface PaypalStatus {
  connected: boolean;
  connection_mode?: 'partner' | 'self_serve';
  environment?: 'sandbox' | 'live';
  email?: string | null;
  client_id_last4?: string;
  connected_at?: string;
  onboarded_at?: string | null;
  merchant_id_in_paypal?: string | null;
  payments_receivable?: boolean;
  primary_email_confirmed?: boolean;
  oauth_third_party_granted?: boolean;
  product_status?: string | null;
  scopes?: string[];
  platform_fee_supported?: boolean;
  partner_mode_available?: boolean;
  onboarding_pending?: boolean;
}

/**
 * PayPal connection settings.
 *
 * Two ways in, and which one leads is a deliberate product call rather than an
 * accident of ordering:
 *
 *  - **Own credentials (default).** The merchant pastes a Client ID and Secret
 *    from their own PayPal REST app. Minutes of work, entirely on their side,
 *    and it needs nothing from PayPal beyond a developer account. CoinPay earns
 *    no commission on this mode because PayPal refuses `platform_fees` on a
 *    first-party order — that is the trade for it being available today.
 *
 *  - **Connect with PayPal (when configured).** PayPal Partner Referrals, which
 *    is PayPal's OAuth onboarding: nothing to copy or paste, and CoinPay's
 *    commission rides along as a platform fee. It only appears when the server
 *    has partner credentials, because CoinPay must be an APPROVED PayPal
 *    Commerce Platform partner for it to work at all — an application and
 *    review process, not a config toggle.
 *
 * Leading with the credential form is what makes PayPal usable before that
 * approval lands. Both write the same tables and every payment route treats the
 * result identically (see resolvePaypalContext).
 */
export function PayPalConnectTab({ businessId }: PayPalConnectTabProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<PaypalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Self-serve form state
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [environment, setEnvironment] = useState<'sandbox' | 'live'>('live');
  const [email, setEmail] = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      const result = await authFetch(`/api/paypal/connect/status/${businessId}`, {}, router);
      if (!result) return null;
      const { response, data } = result;
      if (response.ok && data.success) {
        setStatus(data as PaypalStatus);
        return data as PaypalStatus;
      }
      setStatus({ connected: false });
      return null;
    } catch {
      setStatus({ connected: false });
      return null;
    }
  }, [businessId, router]);

  /**
   * Pull the merchant's onboarding state from PayPal and persist it.
   *
   * Runs automatically when PayPal bounces the merchant back to
   * ?paypal=connected. The MERCHANT.ONBOARDING.COMPLETED webhook does the same
   * job, but it can lag by minutes — long enough for the merchant to look at
   * this page, see "not connected", and try again.
   */
  const finishOnboarding = useCallback(async () => {
    setFinishing(true);
    setError('');
    try {
      const merchantIdInPaypal = searchParams?.get('merchantIdInPayPal');
      const result = await authFetch(
        '/api/paypal/connect/onboard',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            business_id: businessId,
            ...(merchantIdInPaypal ? { merchant_id_in_paypal: merchantIdInPaypal } : {}),
          }),
        },
        router
      );
      if (result) {
        const { response, data } = result;
        if (response.ok && data.success && data.connected) {
          setSuccess('PayPal connected. This business can now take PayPal payments.');
        } else if (response.ok && data.success) {
          setError(
            'PayPal onboarding is not finished yet. Complete every step in PayPal, confirm your account email, then click Refresh.'
          );
        } else {
          setError(data.error || 'Could not confirm PayPal onboarding.');
        }
      }
      await fetchStatus();
    } catch {
      setError('Could not confirm PayPal onboarding.');
    }
    setFinishing(false);
  }, [businessId, router, searchParams, fetchStatus]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const current = await fetchStatus();
      setLoading(false);
      // Returned from PayPal, and we do not yet consider them connected.
      if (searchParams?.get('paypal') === 'connected' && !current?.connected) {
        await finishOnboarding();
      }
    };
    load();
    // finishOnboarding is intentionally out of the dep list: including it
    // re-runs this effect on every searchParams identity change and re-fires
    // the PATCH.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchStatus]);

  const handleOnboard = async () => {
    setOnboarding(true);
    setError('');
    try {
      const result = await authFetch(
        '/api/paypal/connect/onboard',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ business_id: businessId, email: email.trim() || undefined }),
        },
        router
      );
      if (!result) {
        setOnboarding(false);
        return;
      }
      const { response, data } = result;
      if (response.ok && data.success && data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error || 'Failed to start PayPal onboarding.');
    } catch {
      setError('Failed to start PayPal onboarding.');
    }
    setOnboarding(false);
  };

  const handleConnect = async () => {
    setError('');
    setSuccess('');
    if (!clientId.trim() || !clientSecret.trim()) {
      setError('Both Client ID and Secret are required.');
      return;
    }
    setSaving(true);
    try {
      const result = await authFetch(
        '/api/paypal/connect',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            business_id: businessId,
            client_id: clientId.trim(),
            client_secret: clientSecret.trim(),
            environment,
            email: email.trim() || undefined,
          }),
        },
        router
      );
      if (!result) {
        setSaving(false);
        return;
      }
      const { response, data } = result;
      if (response.ok && data.success) {
        setSuccess('PayPal connected. This business can now take PayPal payments.');
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
      const result = await authFetch(
        '/api/paypal/connect',
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ business_id: businessId }),
        },
        router
      );
      if (!result) {
        setDisconnecting(false);
        return;
      }
      const { response, data } = result;
      if (response.ok && data.success) {
        setStatus({ connected: false, partner_mode_available: status?.partner_mode_available });
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

  const partnerAvailable = status?.partner_mode_available === true;
  const isPartner = status?.connection_mode === 'partner';

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
                <span className="font-medium text-gray-400 dark:text-gray-500">Connection:</span>{' '}
                <span className="text-gray-200">
                  {isPartner ? 'Onboarded through CoinPay' : 'Your own PayPal REST app'}
                </span>
              </p>
              <p className="text-sm text-gray-300">
                <span className="font-medium text-gray-400 dark:text-gray-500">Environment:</span>{' '}
                <span className="text-gray-200 capitalize">{status.environment}</span>
              </p>
              {isPartner && status.merchant_id_in_paypal && (
                <p className="text-sm text-gray-300">
                  <span className="font-medium text-gray-400 dark:text-gray-500">Merchant ID:</span>{' '}
                  <span className="font-mono text-xs text-gray-200">{status.merchant_id_in_paypal}</span>
                </p>
              )}
              {!isPartner && status.client_id_last4 && (
                <p className="text-sm text-gray-300">
                  <span className="font-medium text-gray-400 dark:text-gray-500">Client ID:</span>{' '}
                  <span className="font-mono text-xs text-gray-200">••••{status.client_id_last4}</span>
                </p>
              )}
              {status.email && (
                <p className="text-sm text-gray-300">
                  <span className="font-medium text-gray-400 dark:text-gray-500">Email:</span>{' '}
                  <span className="text-gray-200">{status.email}</span>
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-3 pt-1">
              <span
                className={`px-3 py-1 text-xs font-medium rounded-full border ${
                  status.payments_receivable !== false
                    ? 'bg-green-900/50 text-green-400 border-green-700'
                    : 'bg-red-900/50 text-red-400 border-red-700'
                }`}
              >
                Payments {status.payments_receivable !== false ? 'Enabled' : 'Disabled'}
              </span>
              {isPartner && (
                <span
                  className={`px-3 py-1 text-xs font-medium rounded-full border ${
                    status.primary_email_confirmed
                      ? 'bg-green-900/50 text-green-400 border-green-700'
                      : 'bg-yellow-900/50 text-yellow-400 border-yellow-700'
                  }`}
                >
                  Email {status.primary_email_confirmed ? 'Confirmed' : 'Unconfirmed'}
                </span>
              )}
              {status.environment === 'sandbox' && (
                <span className="px-3 py-1 text-xs font-medium rounded-full bg-yellow-900/50 text-yellow-400 border border-yellow-700">
                  Sandbox (test mode)
                </span>
              )}
              {status.product_status && (
                <span className="px-3 py-1 text-xs font-medium rounded-full bg-gray-700 text-gray-300 border border-gray-600">
                  PPCP: {status.product_status}
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
                  <p className="text-xs text-red-400">
                    New PayPal payments will be refused and the option is removed from your open
                    invoices. Payments already captured are unaffected. You can reconnect at any time.
                  </p>
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
            {status?.onboarding_pending ? (
              <div className="text-center">
                <div className="text-4xl mb-3">🅿️</div>
                <p className="text-sm text-gray-300 mb-1 font-medium">
                  PayPal onboarding is in progress.
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  Finish every step in PayPal and confirm your account email, then refresh. This
                  business cannot take PayPal payments until PayPal reports it as able to receive
                  them.
                </p>
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={finishOnboarding}
                    disabled={finishing}
                    className="px-5 py-2 bg-gray-700 text-gray-200 text-sm font-medium rounded-lg hover:bg-gray-600 disabled:opacity-50"
                  >
                    {finishing ? 'Checking…' : 'Refresh status'}
                  </button>
                  <button
                    onClick={handleOnboard}
                    disabled={onboarding}
                    className="px-5 py-2 bg-[#0070ba] text-white text-sm font-medium rounded-lg hover:bg-[#005ea6] disabled:opacity-50"
                  >
                    {onboarding ? 'Starting…' : 'Resume onboarding'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="text-center mb-5">
                  <div className="text-4xl mb-3">🅿️</div>
                  <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">
                    This business is not connected to PayPal yet.
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Create a REST API app in your{' '}
                    <a
                      href="https://developer.paypal.com/dashboard/applications"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 underline"
                    >
                      PayPal Developer Dashboard
                    </a>{' '}
                    and paste its Client ID and Secret below. Payments go straight to your PayPal
                    account.
                  </p>
                </div>

                <div className="max-w-md mx-auto space-y-3">
                  <div>
                    <label htmlFor="pp-env" className="block text-xs font-medium text-gray-300 mb-1">
                      Environment
                    </label>
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
                    <label htmlFor="pp-client-id" className="block text-xs font-medium text-gray-300 mb-1">
                      Client ID
                    </label>
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
                    <label htmlFor="pp-secret" className="block text-xs font-medium text-gray-300 mb-1">
                      Secret
                    </label>
                    <input
                      id="pp-secret"
                      type="password"
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder="PayPal REST app Secret"
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <p className="mt-1 text-[11px] text-gray-500">
                      Stored encrypted. Only used to create and capture payments on your account.
                    </p>
                  </div>
                  <div>
                    <label htmlFor="pp-email" className="block text-xs font-medium text-gray-300 mb-1">
                      PayPal email (optional)
                    </label>
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

                {/* Only offered once the server actually holds partner credentials.
                    Showing it otherwise sends the merchant to a button that
                    cannot work — CoinPay has to be an approved PayPal Commerce
                    Platform partner, which is an application, not a setting. */}
                {partnerAvailable && (
                  <div className="max-w-md mx-auto mt-6 pt-5 border-t border-gray-700 text-center">
                    <p className="text-xs text-gray-500 mb-2">
                      Or skip the copying and paste — sign in to PayPal instead:
                    </p>
                    <button
                      onClick={handleOnboard}
                      disabled={onboarding}
                      className="w-full px-6 py-2 bg-gray-700 text-white text-sm font-medium rounded-lg hover:bg-gray-600 disabled:opacity-50"
                    >
                      {onboarding ? 'Starting…' : 'Connect with PayPal'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
