'use client';

import { useState, useEffect } from 'react';
import { Wallet, SUPPORTED_CRYPTOS } from './types';

interface MerchantWallet {
  id: string;
  cryptocurrency: string;
  wallet_address: string;
  label: string | null;
  is_active: boolean;
}

interface WalletsTabProps {
  businessId: string;
  wallets: Wallet[];
  onUpdate: () => void;
  onCopy: (text: string, label: string) => void;
}

export function WalletsTab({ businessId, wallets, onUpdate, onCopy }: WalletsTabProps) {
  const [showAddWallet, setShowAddWallet] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [formData, setFormData] = useState({
    cryptocurrency: '',
    wallet_address: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [globalWallets, setGlobalWallets] = useState<MerchantWallet[]>([]);
  const [loadingGlobal, setLoadingGlobal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedCryptos, setSelectedCryptos] = useState<string[]>([]);

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

  const fetchGlobalWallets = async () => {
    setLoadingGlobal(true);
    setError('');

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/wallets', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to load global wallets');
        setLoadingGlobal(false);
        return;
      }

      setGlobalWallets(data.wallets);
      // Pre-select wallets that don't exist on the business
      const existingCryptos = new Set(wallets.map((w) => w.cryptocurrency));
      const availableCryptos = data.wallets
        .filter((w: MerchantWallet) => !existingCryptos.has(w.cryptocurrency))
        .map((w: MerchantWallet) => w.cryptocurrency);
      setSelectedCryptos(availableCryptos);
      setLoadingGlobal(false);
    } catch (err) {
      setError('Failed to load global wallets');
      setLoadingGlobal(false);
    }
  };

  const handleOpenImportModal = () => {
    setShowImportModal(true);
    fetchGlobalWallets();
  };

  const handleImport = async () => {
    if (selectedCryptos.length === 0) {
      setError('Please select at least one wallet to import');
      return;
    }

    setImporting(true);
    setError('');
    setSuccess('');

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/api/businesses/${businessId}/wallets/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cryptocurrencies: selectedCryptos }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to import wallets');
        setImporting(false);
        return;
      }

      setSuccess(`Imported ${data.imported} wallet(s)${data.skipped > 0 ? `, skipped ${data.skipped} existing` : ''}`);
      setTimeout(() => setSuccess(''), 3000);
      setShowImportModal(false);
      setSelectedCryptos([]);
      setImporting(false);
      onUpdate();
    } catch (err) {
      setError('Failed to import wallets');
      setImporting(false);
    }
  };

  const toggleCryptoSelection = (crypto: string) => {
    setSelectedCryptos((prev) =>
      prev.includes(crypto)
        ? prev.filter((c) => c !== crypto)
        : [...prev, crypto]
    );
  };

  // Check which global wallets are available to import
  const existingCryptos = new Set(wallets.map((w) => w.cryptocurrency));
  const importableWallets = globalWallets.filter(
    (w) => !existingCryptos.has(w.cryptocurrency)
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Multi-Crypto Wallets</h2>
        <div className="flex items-center space-x-3">
          <button
            onClick={handleOpenImportModal}
            className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            <svg
              className="h-5 w-5 mr-2 text-gray-500"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
            </svg>
            Import Global Wallets
          </button>
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
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
          {success}
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Import Global Wallets</h3>
              <p className="text-sm text-gray-500 mt-1">
                Select wallets to import from your global wallet addresses
              </p>
            </div>

            <div className="px-6 py-4 max-h-96 overflow-y-auto">
              {loadingGlobal ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
                  <p className="mt-2 text-sm text-gray-500">Loading wallets...</p>
                </div>
              ) : globalWallets.length === 0 ? (
                <div className="text-center py-8">
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
                  <p className="mt-2 text-sm text-gray-900 font-medium">No global wallets</p>
                  <p className="text-sm text-gray-500">
                    Add wallets in Settings → Global Wallets first
                  </p>
                </div>
              ) : importableWallets.length === 0 ? (
                <div className="text-center py-8">
                  <svg
                    className="mx-auto h-12 w-12 text-green-400"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                  </svg>
                  <p className="mt-2 text-sm text-gray-900 font-medium">All wallets imported</p>
                  <p className="text-sm text-gray-500">
                    This business already has all your global wallets
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {globalWallets.map((wallet) => {
                    const isExisting = existingCryptos.has(wallet.cryptocurrency);
                    const isSelected = selectedCryptos.includes(wallet.cryptocurrency);

                    return (
                      <label
                        key={wallet.id}
                        className={`flex items-start p-3 rounded-lg border cursor-pointer transition-colors ${
                          isExisting
                            ? 'bg-gray-50 border-gray-200 cursor-not-allowed'
                            : isSelected
                            ? 'bg-purple-50 border-purple-300'
                            : 'bg-white border-gray-200 hover:border-purple-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={isExisting}
                          onChange={() => toggleCryptoSelection(wallet.cryptocurrency)}
                          className="mt-1 h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded disabled:opacity-50"
                        />
                        <div className="ml-3 flex-1">
                          <div className="flex items-center space-x-2">
                            <span className="font-medium text-gray-900">{wallet.cryptocurrency}</span>
                            {wallet.label && (
                              <span className="text-xs text-purple-600 bg-purple-100 px-2 py-0.5 rounded">
                                {wallet.label}
                              </span>
                            )}
                            {isExisting && (
                              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                                Already added
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 font-mono mt-1 break-all">
                            {wallet.wallet_address}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setSelectedCryptos([]);
                  setError('');
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={importing || importableWallets.length === 0 || selectedCryptos.length === 0}
                className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? 'Importing...' : `Import ${selectedCryptos.length} Wallet(s)`}
              </button>
            </div>
          </div>
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