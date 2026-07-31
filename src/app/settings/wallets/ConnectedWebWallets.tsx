'use client';

/**
 * "Connected Web Wallets" — associates a non-custodial CoinPay web wallet held
 * in this browser with the signed-in account.
 *
 * Why this exists: invoices and proposals must always name a payee. Wallet-first
 * users had no way to make their web wallet count as one, so every invoice they
 * created needed an address pasted in by hand. Connecting a wallet here makes its
 * receive addresses resolvable automatically, and "Import addresses" additionally
 * copies them into the older global/business wallet stores.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getAuthToken } from '@/lib/auth/client';
import { connectWebWallet, listLocalWallets, type LocalWallet } from '@/lib/wallets/connect-web-wallet';

interface LinkedWallet {
  id: string;
  wallet_id: string;
  business_id: string | null;
  label: string | null;
  is_default: boolean;
  created_at: string | null;
  addresses: { chain: string; address: string }[];
}

interface Business {
  id: string;
  name: string;
}

function authorizedFetch(url: string, init: RequestInit = {}) {
  const token = getAuthToken();
  return fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token ?? ''}` },
  });
}

export default function ConnectedWebWallets({
  /** Called after an import writes into the global/business wallet stores, so
      the surrounding page can refresh the list it renders below. */
  onImported,
}: {
  onImported?: () => void;
}) {
  const [links, setLinks] = useState<LinkedWallet[]>([]);
  const [localWallets, setLocalWallets] = useState<LocalWallet[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const [showConnect, setShowConnect] = useState(false);
  const [form, setForm] = useState({
    walletId: '',
    password: '',
    businessId: '',
    label: '',
    isDefault: false,
  });

  const load = useCallback(async () => {
    try {
      const [linkRes, bizRes] = await Promise.all([
        authorizedFetch('/api/wallets/links'),
        authorizedFetch('/api/businesses'),
      ]);
      const linkBody = await linkRes.json().catch(() => null);
      const bizBody = await bizRes.json().catch(() => null);

      if (linkBody?.success) setLinks(linkBody.links ?? []);
      if (bizBody?.success) setBusinesses(bizBody.businesses ?? []);
    } catch {
      setError('Failed to load connected wallets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLocalWallets(listLocalWallets());
    void load();
  }, [load]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!form.walletId || !form.password) {
      setError('Choose a wallet and enter its password.');
      return;
    }

    setBusy(true);
    const result = await connectWebWallet({
      walletId: form.walletId,
      password: form.password,
      businessId: form.businessId || null,
      label: form.label || null,
      isDefault: form.isDefault,
      authorizedFetch,
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error || 'Failed to connect wallet');
      return;
    }

    // Never keep the password in component state after use.
    setForm({ walletId: '', password: '', businessId: '', label: '', isDefault: false });
    setShowConnect(false);
    setSuccess('Wallet connected. Its addresses can now be used as an invoice payee.');
    void load();
  };

  const handleImport = async (link: LinkedWallet) => {
    setError('');
    setSuccess('');
    setBusy(true);

    const target = link.business_id ? 'business' : 'account';
    const response = await authorizedFetch(`/api/wallets/links/${link.id}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, business_id: link.business_id }),
    });
    const body = await response.json().catch(() => null);
    setBusy(false);

    if (!response.ok) {
      setError(body?.error || 'Failed to import addresses');
      return;
    }

    const parts: string[] = [];
    if (body.imported?.length) parts.push(`added ${body.imported.join(', ')}`);
    if (body.updated?.length) parts.push(`updated ${body.updated.join(', ')}`);
    setSuccess(
      parts.length > 0
        ? `Imported into ${target === 'business' ? 'business' : 'global'} wallets: ${parts.join('; ')}.`
        : body.message || 'Nothing new to import.',
    );
    onImported?.();
  };

  const handleUnlink = async (link: LinkedWallet) => {
    if (!confirm('Disconnect this web wallet? Invoices will stop resolving payees from it.')) return;

    setError('');
    setSuccess('');
    const response = await authorizedFetch(`/api/wallets/links/${link.id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error || 'Failed to disconnect wallet');
      return;
    }
    setSuccess('Wallet disconnected.');
    void load();
  };

  const handleMakeDefault = async (link: LinkedWallet) => {
    setError('');
    const response = await authorizedFetch(`/api/wallets/links/${link.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_default: true }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error || 'Failed to set default');
      return;
    }
    void load();
  };

  const businessName = (id: string | null) =>
    id ? businesses.find((b) => b.id === id)?.name ?? 'a business' : null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden mb-8">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Connected Web Wallets</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Link a CoinPay web wallet so its addresses can be used automatically as the payee on
            invoices and proposals.
          </p>
        </div>
        {localWallets.length > 0 && !showConnect && (
          <button
            onClick={() => setShowConnect(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-500 whitespace-nowrap"
          >
            Connect Wallet
          </button>
        )}
      </div>

      {error && (
        <div className="mx-6 mt-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
      {success && (
        <div className="mx-6 mt-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-lg">
          {success}
        </div>
      )}

      {showConnect && (
        <form
          onSubmit={handleConnect}
          className="p-6 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 space-y-4"
        >
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Your wallet is unlocked in this browser only. CoinPay receives a signature proving you
            control it — never your password or recovery phrase.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Wallet *
              </label>
              <select
                required
                value={form.walletId}
                onChange={(e) => setForm({ ...form, walletId: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              >
                <option value="">Select a wallet in this browser</option>
                {localWallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label || w.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Wallet password *
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                placeholder="Unlocks the wallet locally"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Scope
              </label>
              <select
                value={form.businessId}
                onChange={(e) => setForm({ ...form, businessId: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              >
                <option value="">Whole account (all businesses)</option>
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    Only {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Label (optional)
              </label>
              <input
                type="text"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                maxLength={100}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                placeholder="e.g., Main web wallet"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
            />
            Prefer this wallet when several could supply the payee
          </label>

          <div className="flex items-center space-x-3">
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500 disabled:opacity-50"
            >
              {busy ? 'Verifying...' : 'Connect Wallet'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowConnect(false);
                setForm({ walletId: '', password: '', businessId: '', label: '', isDefault: false });
                setError('');
              }}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="p-6">
        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading connected wallets...</p>
        ) : links.length === 0 ? (
          <div className="text-center py-8">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">
              No web wallets connected
            </h3>
            {localWallets.length === 0 ? (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                No CoinPay web wallet was found in this browser.{' '}
                <Link href="/web-wallet" className="text-purple-600 dark:text-purple-400 underline">
                  Create or import one
                </Link>{' '}
                to connect it here.
              </p>
            ) : (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Connect a wallet so invoices can resolve a payee without you pasting an address
                every time.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {links.map((link) => (
              <div key={link.id} className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-2 mb-1">
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {link.label || 'Web wallet'}
                      </span>
                      {link.is_default && (
                        <span className="px-2 py-1 text-xs font-medium text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/30 rounded">
                          Default
                        </span>
                      )}
                      <span className="px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded">
                        {link.business_id ? `Only ${businessName(link.business_id)}` : 'Whole account'}
                      </span>
                    </div>

                    {link.addresses.length === 0 ? (
                      <p className="text-sm text-yellow-600 dark:text-yellow-400">
                        No receive addresses registered for this wallet yet.
                      </p>
                    ) : (
                      <div className="mt-2 space-y-1">
                        {link.addresses.map((a) => (
                          <div key={a.chain} className="flex items-baseline gap-2 text-sm">
                            <span className="font-medium text-gray-700 dark:text-gray-200 w-20 shrink-0">
                              {a.chain}
                            </span>
                            <span className="font-mono text-gray-600 dark:text-gray-300 break-all">
                              {a.address}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <button
                      onClick={() => handleImport(link)}
                      disabled={busy || link.addresses.length === 0}
                      className="text-sm font-medium text-purple-600 dark:text-purple-400 hover:text-purple-500 disabled:opacity-50"
                    >
                      Import addresses
                    </button>
                    {!link.is_default && (
                      <button
                        onClick={() => handleMakeDefault(link)}
                        className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                      >
                        Make default
                      </button>
                    )}
                    <button
                      onClick={() => handleUnlink(link)}
                      className="text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-500"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
