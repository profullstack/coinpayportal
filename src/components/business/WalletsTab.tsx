'use client';

import { useState } from 'react';
import { Wallet, SUPPORTED_CRYPTOS } from './types';

interface WalletsTabProps {
  businessId: string;
  wallets: Wallet[];
  onUpdate: () => void;
  onCopy: (text: string, label: string) => void;
}

export function WalletsTab({ businessId, wallets, onUpdate, onCopy }: WalletsTabProps) {
  const [showAddWallet, setShowAddWallet] = useState(false);
  const [formData, setFormData] = useState({
    cryptocurrency: '',
    wallet_address: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/api/businesses/${businessId}/wallets`, {
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
      setFormData({ cryptocurrency: '', wallet_address: '' });
      setSaving(false);
      onUpdate();
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

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(
        `/api/businesses/${businessId}/wallets/${cryptocurrency}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to delete wallet');
        return;
      }

      onUpdate();
    } catch (err) {
      setError('Failed to delete wallet');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Multi-Crypto Wallets</h2>
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
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {showAddWallet && (
        <form onSubmit={handleSubmit} className="mb-6 p-4 bg-gray-50 rounded-lg space-y-4">
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
              {SUPPORTED_CRYPTOS.map((crypto) => (
                <option key={crypto.value} value={crypto.value}>
                  {crypto.label}
                </option>
              ))}
            </select>
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
                setFormData({ cryptocurrency: '', wallet_address: '' });
                setError('');
              }}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

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
          <h3 className="mt-2 text-sm font-medium text-gray-900">No wallets configured</h3>
          <p className="mt-1 text-sm text-gray-500">
            Add cryptocurrency wallets to accept payments in multiple currencies.
          </p>
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
                      onCopy(wallet.wallet_address, `${wallet.cryptocurrency} wallet address`)
                    }
                    className="text-purple-600 hover:text-purple-500"
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
  );
}