'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';
import type { CatalogItem, TaxRate } from '@/components/invoices/LineItemsEditor';

interface Business {
  id: string;
  name: string;
}

const input = 'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm';
const emptyItem = { name: '', description: '', unit_price: '', unit: '', tax_rate_id: '' };
const emptyRate = { name: '', rate: '', is_default: false };

/** Saved products/services and tax rates that invoices draw lines from. */
export default function InvoiceCatalogPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [itemForm, setItemForm] = useState(emptyItem);
  const [rateForm, setRateForm] = useState(emptyRate);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const result = await authFetch('/api/businesses', {}, router);
      if (result?.data.success) {
        setBusinesses(result.data.businesses);
        if (result.data.businesses.length > 0) setBusinessId(result.data.businesses[0].id);
      }
      setLoading(false);
    })();
  }, [router]);

  const load = useCallback(async () => {
    if (!businessId) return;
    const [r, i] = await Promise.all([
      authFetch(`/api/tax-rates?business_id=${businessId}`, {}, router),
      authFetch(`/api/invoice-items?business_id=${businessId}`, {}, router),
    ]);
    setRates(r?.data.success ? r.data.tax_rates ?? [] : []);
    setItems(i?.data.success ? i.data.invoice_items ?? [] : []);
  }, [businessId, router]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async (url: string, method: string, body?: unknown) => {
    setError('');
    const result = await authFetch(
      url,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      router
    );
    if (!result?.data.success) {
      setError(result?.data.error || 'Request failed');
      return false;
    }
    await load();
    return true;
  };

  const saveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      name: itemForm.name,
      description: itemForm.description || null,
      unit_price: Number(itemForm.unit_price),
      unit: itemForm.unit || null,
      tax_rate_id: itemForm.tax_rate_id || null,
    };
    const ok = editingItem
      ? await send(`/api/invoice-items/${editingItem}`, 'PATCH', body)
      : await send('/api/invoice-items', 'POST', { business_id: businessId, ...body });
    if (ok) {
      setItemForm(emptyItem);
      setEditingItem(null);
    }
  };

  const saveRate = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await send('/api/tax-rates', 'POST', {
      business_id: businessId,
      name: rateForm.name,
      rate: Number(rateForm.rate),
      is_default: rateForm.is_default,
    });
    if (ok) setRateForm(emptyRate);
  };

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  const rateName = (id: string | null) => {
    const r = rates.find((t) => t.id === id);
    return r ? `${r.name} ${Number(r.rate)}%` : 'No tax';
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
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <Link href="/invoices" className="text-purple-400 hover:text-purple-300 text-sm mb-4 inline-block">
            ← Back to Invoices
          </Link>
          <h1 className="text-3xl font-bold text-white">Items &amp; Taxes</h1>
          <p className="mt-2 text-gray-400">
            Save the products, services and tax rates you bill often, then add them to any invoice in one click.
          </p>
        </div>

        {businesses.length > 1 && (
          <select
            aria-label="Business"
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            className="px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
          >
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg">{error}</div>
        )}

        {/* Products & services */}
        <section className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Products &amp; Services</h2>
          {items.length === 0 ? (
            <p className="text-sm text-gray-500">No saved items yet.</p>
          ) : (
            <ul className="divide-y divide-gray-700">
              {items.map((item) => (
                <li key={item.id} className="py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-white font-medium">{item.name}</p>
                    {item.description && <p className="text-sm text-gray-400 break-words">{item.description}</p>}
                    <p className="text-xs text-gray-500 mt-1">
                      {fmt(Number(item.unit_price))}
                      {item.unit ? ` / ${item.unit}` : ''} · {rateName(item.tax_rate_id)}
                    </p>
                  </div>
                  <div className="flex gap-3 text-sm shrink-0">
                    <button
                      type="button"
                      className="text-purple-400 hover:text-purple-300"
                      onClick={() => {
                        setEditingItem(item.id);
                        setItemForm({
                          name: item.name,
                          description: item.description ?? '',
                          unit_price: String(item.unit_price),
                          unit: item.unit ?? '',
                          tax_rate_id: item.tax_rate_id ?? '',
                        });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-gray-400 hover:text-red-400"
                      onClick={() => send(`/api/invoice-items/${item.id}`, 'DELETE')}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={saveItem} className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-gray-700 pt-4">
            <input
              required
              aria-label="Item name"
              placeholder="Name *"
              value={itemForm.name}
              onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
              className={input}
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                required
                type="number"
                step="0.01"
                min="0"
                aria-label="Unit price"
                placeholder="Price *"
                value={itemForm.unit_price}
                onChange={(e) => setItemForm({ ...itemForm, unit_price: e.target.value })}
                className={input}
              />
              <input
                aria-label="Unit"
                placeholder="Unit (hour, seat…)"
                value={itemForm.unit}
                onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                className={input}
              />
            </div>
            <input
              aria-label="Item description"
              placeholder="Description"
              value={itemForm.description}
              onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
              className={input}
            />
            <select
              aria-label="Item tax"
              value={itemForm.tax_rate_id}
              onChange={(e) => setItemForm({ ...itemForm, tax_rate_id: e.target.value })}
              className={input}
            >
              <option value="">No tax</option>
              {rates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({Number(r.rate)}%)
                </option>
              ))}
            </select>
            <div className="sm:col-span-2 flex justify-end gap-3">
              {editingItem && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingItem(null);
                    setItemForm(emptyItem);
                  }}
                  className="px-4 py-2 text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={!businessId}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                {editingItem ? 'Save item' : 'Add item'}
              </button>
            </div>
          </form>
        </section>

        {/* Tax rates */}
        <section className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Tax Rates</h2>
          {rates.length === 0 ? (
            <p className="text-sm text-gray-500">No tax rates yet.</p>
          ) : (
            <ul className="divide-y divide-gray-700">
              {rates.map((r) => (
                <li key={r.id} className="py-3 flex items-center justify-between gap-4">
                  <span className="text-white">
                    {r.name} <span className="text-gray-400">{Number(r.rate)}%</span>
                    {r.is_default && <span className="ml-2 text-xs text-purple-300">default</span>}
                  </span>
                  <div className="flex gap-3 text-sm">
                    {!r.is_default && (
                      <button
                        type="button"
                        className="text-purple-400 hover:text-purple-300"
                        onClick={() => send(`/api/tax-rates/${r.id}`, 'PATCH', { is_default: true })}
                      >
                        Make default
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-gray-400 hover:text-red-400"
                      onClick={() => send(`/api/tax-rates/${r.id}`, 'DELETE')}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={saveRate} className="flex flex-wrap items-center gap-3 border-t border-gray-700 pt-4">
            <input
              required
              aria-label="Tax name"
              placeholder="Name (e.g. CA Sales Tax) *"
              value={rateForm.name}
              onChange={(e) => setRateForm({ ...rateForm, name: e.target.value })}
              className={`${input} sm:w-64`}
            />
            <input
              required
              type="number"
              step="0.001"
              min="0"
              max="100"
              aria-label="Tax rate percent"
              placeholder="Rate % *"
              value={rateForm.rate}
              onChange={(e) => setRateForm({ ...rateForm, rate: e.target.value })}
              className={`${input} sm:w-32`}
            />
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={rateForm.is_default}
                onChange={(e) => setRateForm({ ...rateForm, is_default: e.target.checked })}
              />
              Default for new lines
            </label>
            <button
              type="submit"
              disabled={!businessId}
              className="ml-auto px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              Add tax rate
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
