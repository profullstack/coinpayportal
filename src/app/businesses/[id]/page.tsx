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
import { StripeEscrowsTab } from '@/components/business/StripeEscrowsTab';
import { StripeWebhooksTab } from '@/components/business/StripeWebhooksTab';
import { StripeApiKeysTab } from '@/components/business/StripeApiKeysTab';

const CRYPTO_TABS: { id: TabType; label: string | ((w: Wallet[]) => string) }[] = [
  { id: 'general', label: 'General' },
  { id: 'wallets', label: (w) => `Wallets (${w.length})` },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'api-keys', label: 'API Keys' },
];

const CARD_TABS: { id: TabType; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'stripe-connect', label: 'Stripe Connect' },
  { id: 'stripe-transactions', label: 'Transactions' },
  { id: 'stripe-disputes', label: 'Disputes' },
  { id: 'stripe-payouts', label: 'Payouts' },
  { id: 'stripe-escrows', label: 'Escrows' },
  { id: 'stripe-webhooks', label: 'Webhooks' },
  { id: 'stripe-api-keys', label: 'API Keys' },
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

  // Reset to general tab when switching modes
  const handleModeChange = (mode: PaymentMode) => {
    setPaymentMode(mode);
    setActiveTab('general');
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
          <p className="mt-4 text-gray-600">Loading business...</p>
        </div>
      </div>
    );
  }

  if (!business) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Business not found</p>
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

  const currentTabs = paymentMode === 'crypto' ? CRYPTO_TABS : CARD_TABS;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <button
            onClick={() => router.push('/businesses')}
            className="text-sm text-gray-600 hover:text-gray-900 mb-4 flex items-center"
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
          <h1 className="text-3xl font-bold text-gray-900">{business.name}</h1>
          {business.description && (
            <p className="mt-2 text-gray-600">{business.description}</p>
          )}
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
            {success}
          </div>
        )}

        {/* Payment Mode Switcher */}
        <div className="mb-6 flex justify-center">
          <div className="inline-flex rounded-lg bg-gray-200 p-1" role="tablist" aria-label="Payment mode">
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
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="border-b border-gray-200">
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

            {activeTab === 'stripe-escrows' && (
              <StripeEscrowsTab businessId={businessId} />
            )}

            {activeTab === 'stripe-webhooks' && (
              <StripeWebhooksTab businessId={businessId} />
            )}

            {activeTab === 'stripe-api-keys' && (
              <StripeApiKeysTab businessId={businessId} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
