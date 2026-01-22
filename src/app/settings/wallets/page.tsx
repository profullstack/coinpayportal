'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface MerchantWallet {
  id: string;
  cryptocurrency: string;
  wallet_address: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
}

const SUPPORTED_CRYPTOS = [
  { value: 'BTC', label: 'Bitcoin (BTC)' },
  { value: 'BCH', label: 'Bitcoin Cash (BCH)' },
  { value: 'ETH', label: 'Ethereum (ETH)' },
  { value: 'USDT', label: 'Tether (USDT)' },
  { value: 'USDC', label: 'USD Coin (USDC)' },
  { value: 'BNB', label: 'Binance Coin (BNB)' },
  { value: 'SOL', label: 'Solana (SOL)' },
  { value: 'XRP', label: 'Ripple (XRP)' },
  { value: 'ADA', label: 'Cardano (ADA)' },
  { value: 'DOGE', label: 'Dogecoin (DOGE)' },
  { value: 'POL', label: 'Polygon (POL)' },
];

export default function GlobalWalletsPage() {
  const router = useRouter();
  const [wallets, setWallets] = useState<MerchantWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showAddWallet, setShowAddWallet] = useState(false);
  const [formData, setFormData] = useState({
    cryptocurrency: '',
    wallet_address: '',
    label: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchWallets();
  }, []);

  const fetchWallets = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        router.push('/login');
        return;
      }

      const response = await fetch('/api/wallets', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to load wallets');
        setLoading(false);
        return;
      }

      setWallets(data.wallets);
      setLoading(false);
    } catch (err) {
      setError('Failed to load wallets');
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/wallets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to add wallet');
        setSaving(false);
        return;
      }

      setShowAddWallet(false);
      setFormData({ cryptocurrency: '', wallet_address: '', label: '' });
      setSaving(false);
      setSuccess('Wallet added successfully!');
      setTimeout(() => setSuccess(''), 3000);
      fetchWallets();
    } catch (err) {
      setError('Failed to add wallet');
      setSaving(false);
    }
  };

  const handleDelete = async (cryptocurrency: string) => {
    if (!confirm(`Are you sure you want to remove the ${cryptocurrency} wallet?`)) {
      return;
    }

    setError('');
    setSuccess('');

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/api/wallets/${cryptocurrency}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to delete wallet');
        return;
      }

      setSuccess('Wallet removed successfully!');
      setTimeout(() => setSuccess(''), 3000);
      fetchWallets();
    } catch (err) {
      setError('Failed to delete wallet');
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setSuccess(`${label} copied to clipboard!`);
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError('Failed to copy to clipboard');
    }
  };

  // Get available cryptocurrencies (not already added)
  const availableCryptos = SUPPORTED_CRYPTOS.filter(
    (crypto) => !wallets.some((w) => w.cryptocurrency === crypto.value)
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading wallets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
            <Link href="/settings" className="hover:text-purple-600">
              Settings
            </Link>
            <span>/</span>
            <span className="text-gray-900">Global Wallets</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Global Wallet Addresses</h1>
          <p className="mt-2 text-gray-600">
            Define wallet addresses once and import them into any of your businesses.
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
            {success}
          </div>
        )}

        {/* Main Card */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          {/* Card Header */}
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">Your Wallets</h2>
            {availableCryptos.length > 0 && (
              <button
                onClick={() => setShowAddWallet(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-500"
              >
                <svg
                  className="h-5 w-5 mr-2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M12 4v16m8-8H4"></path>
                </svg>
                Add Wallet
              </button>
            )}
          </div>

          {/* Add Wallet Form */}
          {showAddWallet && (
            <form onSubmit={handleSubmit} className="p-6 bg-gray-50 border-b border-gray-200 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Cryptocurrency *
                  </label>
                  <select
                    required
                    value={formData.cryptocurrency}
                    onChange={(e) => setFormData({ ...formData, cryptocurrency: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                  >
                    <option value="">Select cryptocurrency</option>
                    {availableCryptos.map((crypto) => (
                      <option key={crypto.value} value={crypto.value}>
                        {crypto.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Label (optional)
                  </label>
                  <input
                    type="text"
                    value={formData.label}
                    onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                    placeholder="e.g., Main ETH Wallet"
                    maxLength={100}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Wallet Address *
                </label>
                <input
                  type="text"
                  required
                  value={formData.wallet_address}
                  onChange={(e) => setFormData({ ...formData, wallet_address: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm text-gray-900"
                  placeholder="Enter wallet address"
                />
              </div>

              <div className="flex items-center space-x-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500 disabled:opacity-50"
                >
                  {saving ? 'Adding...' : 'Add Wallet'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddWallet(false);
                    setFormData({ cryptocurrency: '', wallet_address: '', label: '' });
                    setError('');
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Wallets List */}
          <div className="p-6">
            {wallets.length === 0 ? (
              <div className="text-center py-12">
                <svg
                  className="mx-auto h-12 w-12 text-gray-400"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path>
                </svg>
                <h3 className="mt-2 text-sm font-medium text-gray-900">No global wallets</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Add wallet addresses here and import them into your businesses.
                </p>
                {!showAddWallet && (
                  <button
                    onClick={() => setShowAddWallet(true)}
                    className="mt-4 inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-500"
                  >
                    <svg
                      className="h-5 w-5 mr-2"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path d="M12 4v16m8-8H4"></path>
                    </svg>
                    Add Your First Wallet
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {wallets.map((wallet) => (
                  <div
                    key={wallet.id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <span className="font-semibold text-gray-900">{wallet.cryptocurrency}</span>
                        {wallet.label && (
                          <span className="px-2 py-1 text-xs font-medium text-purple-700 bg-purple-100 rounded">
                            {wallet.label}
                          </span>
                        )}
                        {wallet.is_active && (
                          <span className="px-2 py-1 text-xs font-medium text-green-700 bg-green-100 rounded">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        <p className="text-sm text-gray-600 font-mono break-all">
                          {wallet.wallet_address}
                        </p>
                        <button
                          onClick={() =>
                            copyToClipboard(wallet.wallet_address, `${wallet.cryptocurrency} wallet address`)
                          }
                          className="text-purple-600 hover:text-purple-500 flex-shrink-0"
                          title="Copy to clipboard"
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                          </svg>
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(wallet.cryptocurrency)}
                      className="ml-4 text-sm font-medium text-red-600 hover:text-red-500"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Info Section */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
            <div className="flex items-start space-x-3">
              <svg
                className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <div className="text-sm text-gray-600">
                <p className="font-medium text-gray-900 mb-1">How to use global wallets</p>
                <p>
                  Once you add wallet addresses here, go to any of your businesses and click
                  "Import Global Wallets" to quickly add them without re-entering the addresses.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Back Link */}
        <div className="mt-6">
          <Link
            href="/settings"
            className="text-purple-600 hover:text-purple-500 text-sm font-medium"
          >
            &larr; Back to Settings
          </Link>
        </div>
      </div>
    </div>
  );
}
