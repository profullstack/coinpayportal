'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

interface StripeApiKeysTabProps {
  businessId: string;
}

interface RestrictedKey {
  id: string;
  name: string;
  created: number;
  livemode: boolean;
}

const COMMON_PERMISSIONS = [
  { key: 'charges', label: 'Charges' },
  { key: 'customers', label: 'Customers' },
  { key: 'disputes', label: 'Disputes' },
  { key: 'payment_intents', label: 'Payment Intents' },
  { key: 'payouts', label: 'Payouts' },
  { key: 'refunds', label: 'Refunds' },
  { key: 'subscriptions', label: 'Subscriptions' },
  { key: 'invoices', label: 'Invoices' },
];

export function StripeApiKeysTab({ businessId }: StripeApiKeysTabProps) {
  const router = useRouter();
  const [keys, setKeys] = useState<RestrictedKey[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formPermissions, setFormPermissions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchKeys = useCallback(async () => {
    try {
      const result = await authFetch(`/api/stripe/api-keys?business_id=${businessId}`, {}, router);
      if (!result) return;
      const { data } = result;
      if (data.success) {
        setKeys(data.keys || []);
        setAccountId(data.account_id || null);
      }
    } catch { /* ignore */ }
  }, [businessId, router]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchKeys();
      setLoading(false);
    };
    load();
  }, [fetchKeys]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const result = await authFetch('/api/stripe/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, name: formName, permissions: formPermissions }),
      }, router);
      if (!result) { setSaving(false); return; }
      const { response, data } = result;
      if (response.ok && data.success) {
        setSuccess('API key created — copy the secret now, it won\'t be shown again');
        setNewKeySecret(data.secret || null);
        setShowForm(false);
        setFormName('');
        setFormPermissions([]);
        fetchKeys();
      } else {
        setError(data.error || 'Failed to create API key');
      }
    } catch {
      setError('Failed to create API key');
    }
    setSaving(false);
  };

  const handleDelete = async (keyId: string) => {
    if (!confirm('Revoke this API key? This cannot be undone.')) return;
    setDeleting(keyId);
    setError('');
    try {
      const result = await authFetch(`/api/stripe/api-keys/${keyId}?business_id=${businessId}`, {
        method: 'DELETE',
      }, router);
      if (!result) { setDeleting(null); return; }
      const { response, data } = result;
      if (response.ok && data.success) {
        setSuccess('API key revoked');
        setTimeout(() => setSuccess(''), 3000);
        fetchKeys();
      } else {
        setError(data.error || 'Failed to revoke API key');
      }
    } catch {
      setError('Failed to revoke API key');
    }
    setDeleting(null);
  };

  const togglePermission = (perm: string) => {
    setFormPermissions(prev =>
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    );
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setSuccess('Copied to clipboard');
      setTimeout(() => setSuccess(''), 3000);
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
        <p className="mt-2 text-sm text-gray-500">Loading Stripe API keys...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Stripe API Keys</h2>
        <button
          onClick={() => { setShowForm(!showForm); setNewKeySecret(null); }}
          className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500"
        >
          {showForm ? 'Cancel' : 'Create Restricted Key'}
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}
      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{success}</div>
      )}

      {accountId && (
        <div className="mb-6 bg-gray-50 rounded-lg p-4">
          <p className="text-sm text-gray-700">
            <span className="font-medium">Connect Account ID:</span>{' '}
            <span className="font-mono text-xs">{accountId}</span>
            <button onClick={() => copyToClipboard(accountId)} className="ml-2 text-purple-600 hover:text-purple-500 text-xs">Copy</button>
          </p>
        </div>
      )}

      {newKeySecret && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm font-medium text-yellow-800 mb-2">⚠️ Copy this secret key now — it won&apos;t be shown again:</p>
          <div className="flex items-center space-x-2">
            <code className="flex-1 px-3 py-2 bg-white border border-yellow-300 rounded font-mono text-xs text-gray-900 break-all">{newKeySecret}</code>
            <button onClick={() => copyToClipboard(newKeySecret)} className="text-purple-600 hover:text-purple-500 text-sm">Copy</button>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 bg-gray-50 rounded-lg p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Key Name</label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
              placeholder="e.g. Backend Server Key"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Permissions (read access)</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {COMMON_PERMISSIONS.map(p => (
                <label key={p.key} className="flex items-center space-x-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={formPermissions.includes(p.key)}
                    onChange={() => togglePermission(p.key)}
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500 disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Key'}
          </button>
        </form>
      )}

      {keys.length === 0 ? (
        <p className="text-sm text-gray-500 py-4">No restricted API keys.</p>
      ) : (
        <div className="space-y-3">
          {keys.map((k) => (
            <div key={k.id} className="bg-gray-50 rounded-lg p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{k.name || 'Unnamed key'}</p>
                <p className="text-xs text-gray-500 font-mono">{k.id}</p>
                <p className="text-xs text-gray-500">
                  Created {new Date(k.created * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                  {k.livemode ? ' · Live' : ' · Test'}
                </p>
              </div>
              <button
                onClick={() => handleDelete(k.id)}
                disabled={deleting === k.id}
                className="px-3 py-1 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-500 disabled:opacity-50"
              >
                {deleting === k.id ? 'Revoking...' : 'Revoke'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
