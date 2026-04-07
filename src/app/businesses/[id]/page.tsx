'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import { Business, Wallet, TabType, PaymentMode } from '@/components/business/types';
import { GeneralTab } from '@/components/business/GeneralTab';
import { WalletsTab } from '@/components/business/WalletsTab';
import { WebhooksTab } from '@/components/business/WebhooksTab';
import { ApiKeysTab } from '@/components/business/ApiKeysTab';
import { StripeConnectTab } from '@/components/business/StripeConnectTab';
import { StripeTransactionsTab } from '@/components/business/StripeTransactionsTab';
import { StripeDisputesTab } from '@/components/business/StripeDisputesTab';
import { StripePayoutsTab } from '@/components/business/StripePayoutsTab';

import { StripeApiKeysTab } from '@/components/business/StripeApiKeysTab';
import { CryptoTransactionsTab } from '@/components/business/CryptoTransactionsTab';
import { CryptoEscrowsTab } from '@/components/business/CryptoEscrowsTab';
import { CryptoPayoutsTab } from '@/components/business/CryptoPayoutsTab';
import { CalendarTab } from '@/components/business/CalendarTab';

// Webhook configuration is intentionally NOT a per-rail tab. There is one
// businesses.webhook_url + businesses.webhook_secret per business — both
// crypto and card events route through the same outbound webhook. The
// "Webhooks" mode below is the single source of truth.
const CRYPTO_TABS: { id: TabType; label: string | ((w: Wallet[]) => string) }[] = [
  { id: 'general', label: 'General' },
  { id: 'wallets', label: (w) => `Wallets (${w.length})` },
  { id: 'api-keys', label: 'API Keys' },
  { id: 'crypto-transactions', label: 'Transactions' },
  { id: 'crypto-escrows', label: 'Escrows' },
  { id: 'crypto-payouts', label: 'Payouts' },
  { id: 'calendar', label: 'Calendar' },
];

const CARD_TABS: { id: TabType; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'stripe-connect', label: 'Stripe Connect' },
  { id: 'stripe-transactions', label: 'Transactions' },
  { id: 'stripe-disputes', label: 'Disputes' },
  { id: 'stripe-payouts', label: 'Payouts' },
  { id: 'stripe-api-keys', label: 'API Keys' },
  { id: 'calendar', label: 'Calendar' },
];

const WEBHOOK_TABS: { id: TabType; label: string }[] = [
  { id: 'webhooks', label: 'Webhooks' },
];

export default function BusinessDetailPage() {
  const router = useRouter();
  const params = useParams();
  const businessId = params?.id as string;

  const [paymentMode, setPaymentMode] = useState<PaymentMode>('crypto');
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [business, setBusiness] = useState<Business | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (businessId) {
      fetchBusiness();
      fetchWallets();
    }
  }, [businessId]);

  // Reset to the first tab of the new mode when switching modes.
  // The Webhooks mode has only one tab so we land on it directly.
  const handleModeChange = (mode: PaymentMode) => {
    setPaymentMode(mode);
    setActiveTab(mode === 'webhooks' ? 'webhooks' : 'general');
  };

  const fetchBusiness = async () => {
    try {
      const result = await authFetch(`/api/businesses/${businessId}`, {}, router);
      if (!result) return;

      const { response, data } = result;

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to load business');
        setLoading(false);
        return;
      }

      setBusiness(data.business);
      setLoading(false);
    } catch (err) {
      setError('Failed to load business');
      setLoading(false);
    }
  };

  const fetchWallets = async () => {
    try {
      const result = await authFetch(`/api/businesses/${businessId}/wallets`, {}, router);
      if (!result) return;

      const { response, data } = result;

      if (response.ok && data.success) {
        setWallets(data.wallets);
      }
    } catch (err) {
      console.error('Failed to load wallets:', err);
    }
  };

  const handleUpdate = () => {
    setSuccess('Changes saved successfully');
    setTimeout(() => setSuccess(''), 3000);
    fetchBusiness();
    fetchWallets();
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setSuccess(`${label} copied to clipboard`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to copy to clipboard');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading business...</p>
        </div>
      </div>
    );
  }

  if (!business) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-300">Business not found</p>
          <button
            onClick={() => router.push('/businesses')}
            className="mt-4 text-purple-600 hover:text-purple-500"
          >
            Back to Businesses
          </button>
        </div>
      </div>
    );
  }

  const currentTabs =
    paymentMode === 'crypto' ? CRYPTO_TABS
    : paymentMode === 'card' ? CARD_TABS
    : WEBHOOK_TABS;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <button
            onClick={() => router.push('/businesses')}
            className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white dark:text-white mb-4 flex items-center"
          >
            <svg
              className="h-4 w-4 mr-1"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M15 19l-7-7 7-7"></path>
            </svg>
            Back to Businesses
          </button>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{business.name}</h1>
          {business.description && (
            <p className="mt-2 text-gray-600 dark:text-gray-300">{business.description}</p>
          )}
        </div>

        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-4 py-3 rounded-lg">
            {success}
          </div>
        )}

        {/* Payment Mode Switcher */}
        <div className="mb-6 flex justify-center">
          <div className="inline-flex rounded-lg bg-gray-200 dark:bg-gray-700 p-1" role="tablist" aria-label="Payment mode">
            <button
              role="tab"
              aria-selected={paymentMode === 'crypto'}
              onClick={() => handleModeChange('crypto')}
              className={`px-6 py-2.5 text-sm font-semibold rounded-md transition-all ${
                paymentMode === 'crypto'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              🪙 Crypto
            </button>
            <button
              role="tab"
              aria-selected={paymentMode === 'card'}
              onClick={() => handleModeChange('card')}
              className={`px-6 py-2.5 text-sm font-semibold rounded-md transition-all ${
                paymentMode === 'card'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              💳 Credit Card
            </button>
            <button
              role="tab"
              aria-selected={paymentMode === 'webhooks'}
              onClick={() => handleModeChange('webhooks')}
              className={`px-6 py-2.5 text-sm font-semibold rounded-md transition-all ${
                paymentMode === 'webhooks'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              🔔 Webhooks
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
          <div className="border-b border-gray-200 dark:border-gray-700">
            <nav className="flex -mb-px overflow-x-auto">
              {currentTabs.map((tab) => {
                const label = typeof tab.label === 'function' ? tab.label(wallets) : tab.label;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-6 py-4 text-sm font-medium border-b-2 whitespace-nowrap ${
                      activeTab === tab.id
                        ? 'border-purple-600 text-purple-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'general' && (
              <GeneralTab
                business={business}
                onUpdate={handleUpdate}
                onCopy={copyToClipboard}
              />
            )}

            {activeTab === 'wallets' && (
              <WalletsTab
                businessId={businessId}
                wallets={wallets}
                onUpdate={handleUpdate}
                onCopy={copyToClipboard}
              />
            )}

            {activeTab === 'webhooks' && (
              <WebhooksTab
                business={business}
                onUpdate={handleUpdate}
                onCopy={copyToClipboard}
              />
            )}

            {activeTab === 'api-keys' && (
              <ApiKeysTab
                business={business}
                onUpdate={handleUpdate}
                onCopy={copyToClipboard}
              />
            )}

            {activeTab === 'stripe-connect' && (
              <StripeConnectTab businessId={businessId} />
            )}

            {activeTab === 'stripe-transactions' && (
              <StripeTransactionsTab businessId={businessId} />
            )}

            {activeTab === 'stripe-disputes' && (
              <StripeDisputesTab businessId={businessId} />
            )}

            {activeTab === 'stripe-payouts' && (
              <StripePayoutsTab businessId={businessId} />
            )}

            {activeTab === 'stripe-api-keys' && (
              <StripeApiKeysTab businessId={businessId} />
            )}

            {activeTab === 'crypto-transactions' && (
              <CryptoTransactionsTab businessId={businessId} />
            )}

            {activeTab === 'crypto-escrows' && (
              <CryptoEscrowsTab businessId={businessId} />
            )}

            {activeTab === 'crypto-payouts' && (
              <CryptoPayoutsTab businessId={businessId} />
            )}

            {activeTab === 'calendar' && (
              <CalendarTab businessId={businessId} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
