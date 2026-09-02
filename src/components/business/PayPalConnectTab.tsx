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

export function PayPalConnectTab({ businessId }: PayPalConnectTabProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<PaypalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarding, setOnboarding] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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
          body: JSON.stringify({ business_id: businessId }),
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

  const partnerAvailable = status?.partner_mode_available !== false;
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

            {/* The commercial difference between the two modes, stated plainly.
                Self-serve cannot carry a platform fee because PayPal rejects
                platform_fees on a first-party order. */}
            {!status.platform_fee_supported && (
              <div className="text-xs text-gray-400 bg-gray-900/60 border border-gray-700 rounded-lg p-3">
                Payments on this connection go to your PayPal account in full — CoinPay takes no
                commission, because PayPal does not allow a platform fee on an account connected
                with its own API credentials.
                {partnerAvailable && ' Reconnect through CoinPay to use the managed integration.'}
              </div>
            )}

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
            <div className="text-center mb-5">
              <div className="text-4xl mb-3">🅿️</div>
              {status?.onboarding_pending ? (
                <>
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
                </>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">
                  This business is not connected to PayPal yet.
                </p>
              )}
            </div>

            {!status?.onboarding_pending && (
              partnerAvailable ? (
                <div className="max-w-md mx-auto text-center">
                  <button
                    onClick={handleOnboard}
                    disabled={onboarding}
                    className="w-full px-6 py-2.5 bg-[#0070ba] text-white text-sm font-semibold rounded-lg hover:bg-[#005ea6] disabled:opacity-50"
                  >
                    {onboarding ? 'Starting…' : 'Connect with PayPal'}
                  </button>
                  <p className="mt-3 text-[11px] text-gray-500">
                    You&apos;ll sign in to your own PayPal account and approve CoinPay. Nothing to
                    copy or paste. Payments settle directly to your PayPal balance — CoinPay never
                    holds your funds and takes its commission as a PayPal platform fee.
                  </p>
                </div>
              ) : (
                /* No fallback credential form on purpose. Pasting a REST app
                   secret creates a connection PayPal treats as first-party,
                   which cannot carry a platform fee — so it earns nothing and
                   asks the merchant to handle a secret. Fix the server config
                   instead of offering the worse path. */
                <div className="max-w-md mx-auto text-center">
                  <p className="text-sm text-yellow-400">
                    PayPal onboarding isn&apos;t available on this server yet.
                  </p>
                  <p className="mt-2 text-[11px] text-gray-500">
                    An administrator needs to configure CoinPay&apos;s PayPal partner credentials
                    before businesses can connect.
                  </p>
                </div>
              )
            )}
          </div>
        )}
      </section>
    </div>
  );
}
