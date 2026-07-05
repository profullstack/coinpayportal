'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface AccountManualDefault {
  method_id: string;
  display_name: string;
  handle: string;
  instructions: string;
}

const HANDLE_PLACEHOLDERS: Record<string, string> = {
  venmo: '@your-venmo-username',
  cashapp: '$yourcashtag',
  zelle: 'email or phone linked to Zelle',
};

/**
 * Account-level (global) payment-method setup. Handles saved here can be
 * imported into any of the merchant's businesses from that business's
 * 3rd Party settings tab.
 */
export default function AccountPaymentMethodsPage() {
  const router = useRouter();
  const [methods, setMethods] = useState<AccountManualDefault[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [savedId, setSavedId] = useState('');
  const [error, setError] = useState('');

  const fetchDefaults = useCallback(async () => {
    try {
      const result = await authFetch('/api/account/payment-methods/manual', {}, router);
      if (!result) return;
      const { response, data } = result;
      if (response.ok && data.success) setMethods(data.methods || []);
      else setError(data.error || 'Failed to load');
    } catch {
      setError('Failed to load');
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { fetchDefaults(); }, [fetchDefaults]);

  const update = (methodId: string, patch: Partial<AccountManualDefault>) =>
    setMethods((prev) => prev.map((m) => (m.method_id === methodId ? { ...m, ...patch } : m)));

  const save = async (m: AccountManualDefault) => {
    setSavingId(m.method_id);
    setSavedId('');
    setError('');
    try {
      const result = await authFetch('/api/account/payment-methods/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method_id: m.method_id, handle: m.handle, instructions: m.instructions }),
      }, router);
      if (result?.response.ok && result.data.success) {
        setSavedId(m.method_id);
        setTimeout(() => setSavedId(''), 2500);
      } else {
        setError(result?.data.error || 'Failed to save');
      }
    } catch {
      setError('Failed to save');
    }
    setSavingId('');
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <Link href="/settings" className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">← Settings</Link>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-2">Payment Methods</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-300">
            Save your Venmo, Cash App, and Zelle handles once here, then import them into any business
            from its <span className="font-medium">3rd Party</span> settings tab. Customers pay you directly on these
            rails — CoinPay takes no fee and never touches the funds.
          </p>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg">{error}</div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
          </div>
        ) : (
          <div className="space-y-4">
            {methods.map((m) => (
              <div key={m.method_id} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3">{m.display_name}</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Handle</label>
                    <input
                      type="text"
                      value={m.handle}
                      onChange={(e) => update(m.method_id, { handle: e.target.value })}
                      placeholder={HANDLE_PLACEHOLDERS[m.method_id] || 'your handle'}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Instructions for the customer (optional)</label>
                    <input
                      type="text"
                      value={m.instructions}
                      onChange={(e) => update(m.method_id, { instructions: e.target.value })}
                      placeholder="e.g. Include the invoice number in the note"
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    onClick={() => save(m)}
                    disabled={savingId === m.method_id}
                    className="px-4 py-1.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500 disabled:opacity-50"
                  >
                    {savingId === m.method_id ? 'Saving…' : 'Save'}
                  </button>
                  {savedId === m.method_id && <span className="text-xs text-green-600 dark:text-green-400">✓ Saved</span>}
                </div>
              </div>
            ))}
            {methods.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No manual methods are available.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
