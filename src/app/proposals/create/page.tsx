'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface Business {
  id: string;
  name: string;
}

interface Client {
  id: string;
  name: string;
  email: string;
  company_name: string;
}

interface Wallet {
  cryptocurrency: string;
  wallet_address: string;
}

const ALL_CRYPTOS = [
  'BTC', 'BCH', 'ETH', 'POL', 'SOL', 'DOGE', 'XRP', 'ADA', 'BNB',
  'USDT', 'USDT_ETH', 'USDT_POL', 'USDT_SOL',
  'USDC', 'USDC_ETH', 'USDC_POL', 'USDC_SOL',
];

export default function CreateProposalPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    business_id: '',
    client_id: '',
    title: '',
    description: '',
    amount: '',
    currency: 'USD',
    crypto_currency: '',
    merchant_wallet_address: '',
    terms: '',
    message: '',
    due_date: '',
    expires_at: '',
  });

  useEffect(() => {
    (async () => {
      const result = await authFetch('/api/businesses', {}, router);
      if (!result) return;
      if (result.data.success) {
        setBusinesses(result.data.businesses);
        if (result.data.businesses.length === 1) {
          setForm((f) => ({ ...f, business_id: result.data.businesses[0].id }));
        }
      }
      setLoading(false);
    })();
  }, [router]);

  useEffect(() => {
    if (!form.business_id) return;

    // Guards against a slow response for a business the user has since switched
    // away from overwriting the newer one's clients/wallets.
    let cancelled = false;

    (async () => {
      const [clientResult, methodResult] = await Promise.all([
        authFetch(`/api/clients?business_id=${form.business_id}`, {}, router),
        authFetch(`/api/businesses/${form.business_id}/payment-methods`, {}, router),
      ]);
      if (cancelled) return;
      if (clientResult?.data.success) setClients(clientResult.data.clients);
      if (methodResult?.data.success) setWallets(methodResult.data.crypto ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [form.business_id, router]);

  const walletFor = (crypto: string) => wallets.find((w) => w.cryptocurrency === crypto);
  const resolvedWallet = form.crypto_currency ? walletFor(form.crypto_currency) : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Same rule as invoices: naming a coin means naming where it lands.
    if (form.crypto_currency && !form.merchant_wallet_address.trim()) {
      setError(`Enter the ${form.crypto_currency} payee address this proposal should be paid to.`);
      return;
    }

    setSaving(true);
    const result = await authFetch('/api/proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: form.business_id,
        client_id: form.client_id || undefined,
        title: form.title,
        description: form.description || undefined,
        amount: parseFloat(form.amount),
        currency: form.currency,
        crypto_currency: form.crypto_currency || undefined,
        merchant_wallet_address: form.merchant_wallet_address.trim() || undefined,
        terms: form.terms || undefined,
        message: form.message || undefined,
        due_date: form.due_date || undefined,
        expires_at: form.expires_at || undefined,
      }),
    }, router);

    if (!result?.data.success) {
      setError(result?.data.error || 'Failed to create proposal');
      setSaving(false);
      return;
    }

    router.push(`/proposals/${result.data.proposal.id}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400" />
      </div>
    );
  }

  const field = 'w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white';
  const label = 'block text-sm font-medium text-gray-300 mb-2';

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <Link href="/proposals" className="text-purple-400 hover:text-purple-300 text-sm mb-4 inline-block">
            ← Back to Proposals
          </Link>
          <h1 className="text-3xl font-bold text-white">New Proposal</h1>
          <p className="mt-2 text-gray-400">
            Nothing is charged when you send this. An invoice is created only once both sides agree.
          </p>
        </div>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6 space-y-6">
          <div>
            <label className={label}>Business *</label>
            <select
              required
              value={form.business_id}
              onChange={(e) => {
                // Clear the previous business's data immediately so a stale
                // client or wallet is never selectable for the new one.
                setClients([]);
                setWallets([]);
                setForm({ ...form, business_id: e.target.value, client_id: '', crypto_currency: '', merchant_wallet_address: '' });
              }}
              className={field}
            >
              <option value="">Select business</option>
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={label}>Client</label>
            <select
              value={form.client_id}
              onChange={(e) => setForm({ ...form, client_id: e.target.value })}
              className={field}
            >
              <option value="">Select client (required before sending)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.company_name || c.name || c.email}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={label}>Title *</label>
            <input
              type="text"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className={field}
              placeholder="e.g., Website redesign"
            />
          </div>

          <div>
            <label className={label}>Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className={field}
              rows={3}
              placeholder="What is being proposed"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Amount *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className={field}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className={label}>Currency</label>
              <select
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                className={field}
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
          </div>

          <div className="border border-gray-700 rounded-xl p-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Paid in</label>
              <select
                value={form.crypto_currency}
                onChange={(e) => {
                  const wallet = walletFor(e.target.value);
                  setForm({
                    ...form,
                    crypto_currency: e.target.value,
                    merchant_wallet_address: wallet?.wallet_address || '',
                  });
                }}
                className={field}
              >
                <option value="">Decide later (required before accepting)</option>
                {ALL_CRYPTOS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                    {walletFor(c) ? '' : ' — no wallet on file'}
                  </option>
                ))}
              </select>
            </div>

            {form.crypto_currency && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Payee wallet address * <span className="text-gray-500">({form.crypto_currency})</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.merchant_wallet_address}
                  onChange={(e) => setForm({ ...form, merchant_wallet_address: e.target.value })}
                  className={`${field} font-mono text-sm`}
                  placeholder={`Enter the ${form.crypto_currency} address to be paid`}
                />
                {resolvedWallet ? (
                  <p className="text-xs text-green-400 mt-1">
                    Using your saved {form.crypto_currency} wallet. Edit it to pay someone else.
                  </p>
                ) : (
                  <p className="text-xs text-yellow-400 mt-1">
                    No {form.crypto_currency} wallet could be determined from your account — enter the
                    address manually, or{' '}
                    <Link href="/settings/wallets" className="underline hover:text-yellow-300">
                      connect a wallet
                    </Link>
                    .
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <label className={label}>Terms</label>
            <textarea
              value={form.terms}
              onChange={(e) => setForm({ ...form, terms: e.target.value })}
              className={field}
              rows={4}
              placeholder="Scope, deliverables, payment schedule..."
            />
          </div>

          <div>
            <label className={label}>Message to client</label>
            <textarea
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              className={field}
              rows={2}
              placeholder="A short note that goes with the proposal"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Delivery by</label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                className={field}
              />
            </div>
            <div>
              <label className={label}>Offer expires</label>
              <input
                type="date"
                value={form.expires_at}
                onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
                className={field}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Link href="/proposals" className="px-4 py-2 text-gray-400 hover:text-white transition-colors">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create Draft'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
