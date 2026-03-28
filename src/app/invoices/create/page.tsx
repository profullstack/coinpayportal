'use client';

import { useState, useEffect } from 'react';
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
  id: string;
  cryptocurrency: string;
  wallet_address: string;
}

export default function CreateInvoicePage() {
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
    amount: '',
    currency: 'USD',
    crypto_currency: '',
    due_date: '',
    notes: '',
    merchant_wallet_address: '',
    // New client fields
    new_client_email: '',
    new_client_name: '',
    new_client_company: '',
    // Recurring schedule
    recurring: false,
    recurrence: 'monthly',
    custom_interval_days: '',
    max_occurrences: '',
    schedule_end_date: '',
  });

  const [showNewClient, setShowNewClient] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (form.business_id) {
      fetchClients(form.business_id);
      fetchWallets(form.business_id);
    }
  }, [form.business_id]);

  const fetchData = async () => {
    const result = await authFetch('/api/businesses', {}, router);
    if (!result) return;
    if (result.data.success) {
      setBusinesses(result.data.businesses);
      if (result.data.businesses.length === 1) {
        setForm(f => ({ ...f, business_id: result.data.businesses[0].id }));
      }
    }
    setLoading(false);
  };

  const fetchClients = async (businessId: string) => {
    const result = await authFetch(`/api/clients?business_id=${businessId}`, {}, router);
    if (result?.data.success) setClients(result.data.clients);
  };

  const fetchWallets = async (businessId: string) => {
    const result = await authFetch(`/api/businesses/${businessId}`, {}, router);
    if (result?.data.success && result.data.business?.wallets) {
      setWallets(result.data.business.wallets);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      let clientId = form.client_id;

      // Create new client if needed
      if (showNewClient && form.new_client_email) {
        const clientResult = await authFetch('/api/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            business_id: form.business_id,
            email: form.new_client_email,
            name: form.new_client_name,
            company_name: form.new_client_company,
          }),
        }, router);

        if (!clientResult?.data.success) {
          setError(clientResult?.data.error || 'Failed to create client');
          setSaving(false);
          return;
        }
        clientId = clientResult.data.client.id;
      }

      // Find wallet address for selected crypto
      const selectedWallet = wallets.find(w => w.cryptocurrency === form.crypto_currency);

      const invoiceData: Record<string, unknown> = {
        business_id: form.business_id,
        client_id: clientId || undefined,
        amount: parseFloat(form.amount),
        currency: form.currency,
        crypto_currency: form.crypto_currency || undefined,
        due_date: form.due_date || undefined,
        notes: form.notes || undefined,
        merchant_wallet_address: selectedWallet?.wallet_address || form.merchant_wallet_address || undefined,
      };

      if (form.recurring) {
        invoiceData.schedule = {
          recurrence: form.recurrence,
          custom_interval_days: form.recurrence === 'custom' ? parseInt(form.custom_interval_days) : undefined,
          max_occurrences: form.max_occurrences ? parseInt(form.max_occurrences) : undefined,
          end_date: form.schedule_end_date || undefined,
        };
      }

      const result = await authFetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invoiceData),
      }, router);

      if (!result?.data.success) {
        setError(result?.data.error || 'Failed to create invoice');
        setSaving(false);
        return;
      }

      router.push(`/invoices/${result.data.invoice.id}`);
    } catch {
      setError('Failed to create invoice');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <Link href="/invoices" className="text-purple-400 hover:text-purple-300 text-sm mb-4 inline-block">
            ← Back to Invoices
          </Link>
          <h1 className="text-3xl font-bold text-white">Create Invoice</h1>
        </div>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6 space-y-6">
          {/* Business */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Business *</label>
            <select
              required
              value={form.business_id}
              onChange={e => setForm({ ...form, business_id: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-purple-500"
            >
              <option value="">Select business</option>
              {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          {/* Client */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Client</label>
            {!showNewClient ? (
              <div className="space-y-2">
                <select
                  value={form.client_id}
                  onChange={e => setForm({ ...form, client_id: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">Select client (optional)</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.company_name || c.name || c.email}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setShowNewClient(true)} className="text-sm text-purple-400 hover:text-purple-300">
                  + Create new client
                </button>
              </div>
            ) : (
              <div className="space-y-3 bg-gray-700/50 p-4 rounded-lg">
                <input
                  type="email"
                  placeholder="Client email *"
                  value={form.new_client_email}
                  onChange={e => setForm({ ...form, new_client_email: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                  required={showNewClient}
                />
                <input
                  type="text"
                  placeholder="Client name"
                  value={form.new_client_name}
                  onChange={e => setForm({ ...form, new_client_name: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                />
                <input
                  type="text"
                  placeholder="Company name"
                  value={form.new_client_company}
                  onChange={e => setForm({ ...form, new_client_company: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                />
                <button type="button" onClick={() => setShowNewClient(false)} className="text-sm text-gray-400 hover:text-gray-300">
                  ← Select existing client
                </button>
              </div>
            )}
          </div>

          {/* Amount & Currency */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Amount *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={form.amount}
                onChange={e => setForm({ ...form, amount: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Currency</label>
              <select
                value={form.currency}
                onChange={e => setForm({ ...form, currency: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
          </div>

          {/* Crypto Currency */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Crypto Currency</label>
            <select
              value={form.crypto_currency}
              onChange={e => {
                const wallet = wallets.find(w => w.cryptocurrency === e.target.value);
                setForm({ ...form, crypto_currency: e.target.value, merchant_wallet_address: wallet?.wallet_address || '' });
              }}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
            >
              <option value="">Select crypto (set before sending)</option>
              {wallets.length > 0
                ? wallets.map(w => <option key={w.id} value={w.cryptocurrency}>{w.cryptocurrency}</option>)
                : ['BTC', 'BCH', 'ETH', 'POL', 'SOL', 'DOGE', 'XRP', 'ADA', 'BNB', 'USDT', 'USDT_ETH', 'USDT_POL', 'USDT_SOL', 'USDC', 'USDC_ETH', 'USDC_POL', 'USDC_SOL']
                    .map(c => <option key={c} value={c}>{c}</option>)
              }
            </select>
            {wallets.length === 0 && form.business_id && (
              <p className="text-xs text-yellow-400 mt-1">No wallets configured for this business. Add wallets in business settings.</p>
            )}
          </div>

          {/* Due Date */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Due Date</label>
            <input
              type="date"
              value={form.due_date}
              onChange={e => setForm({ ...form, due_date: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              rows={3}
              placeholder="Optional notes for the client"
            />
          </div>

          {/* Recurring Schedule */}
          <div className="border-t border-gray-700 pt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.recurring}
                onChange={e => setForm({ ...form, recurring: e.target.checked })}
                className="rounded bg-gray-700 border-gray-600 text-purple-500"
              />
              <span className="text-sm font-medium text-gray-300">Make this a recurring invoice</span>
            </label>

            {form.recurring && (
              <div className="mt-4 space-y-3 bg-gray-700/50 p-4 rounded-lg">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Frequency</label>
                  <select
                    value={form.recurrence}
                    onChange={e => setForm({ ...form, recurrence: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                  >
                    {['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom'].map(r => (
                      <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                    ))}
                  </select>
                </div>
                {form.recurrence === 'custom' && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Custom interval (days)</label>
                    <input
                      type="number"
                      min="1"
                      value={form.custom_interval_days}
                      onChange={e => setForm({ ...form, custom_interval_days: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Max occurrences</label>
                    <input
                      type="number"
                      min="1"
                      value={form.max_occurrences}
                      onChange={e => setForm({ ...form, max_occurrences: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                      placeholder="Unlimited"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">End date</label>
                    <input
                      type="date"
                      value={form.schedule_end_date}
                      onChange={e => setForm({ ...form, schedule_end_date: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* TODO: Add Stripe/card payment option in future */}

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-4">
            <Link href="/invoices" className="px-4 py-2 text-gray-400 hover:text-white transition-colors">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? 'Creating...' : 'Create Invoice'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
