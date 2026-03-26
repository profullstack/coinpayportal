'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import { formatDate, statusColors } from './stripe-helpers';

interface StripeWebhooksTabProps {
  businessId: string;
}

interface WebhookEndpoint {
  id: string;
  url: string;
  status: string;
  enabled_events: string[];
  created: number;
  scope?: string;
}

interface CreatedSecret {
  endpointId: string;
  truncated: string;
  copied: boolean;
}

const COMMON_EVENTS = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.succeeded',
  'charge.failed',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
  'payout.paid',
  'payout.failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
];

export function StripeWebhooksTab({ businessId }: StripeWebhooksTabProps) {
  const router = useRouter();
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formUrl, setFormUrl] = useState('');
  const [formEvents, setFormEvents] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [createdSecret, setCreatedSecret] = useState<CreatedSecret | null>(null);

  const fetchEndpoints = useCallback(async () => {
    try {
      const result = await authFetch(`/api/stripe/webhooks?business_id=${businessId}`, {}, router);
      if (!result) return;
      const { data } = result;
      if (data.success) setEndpoints(data.endpoints || []);
    } catch { /* ignore */ }
  }, [businessId, router]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchEndpoints();
      setLoading(false);
    };
    load();
  }, [fetchEndpoints]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formUrl || formEvents.length === 0) {
      setError('URL and at least one event are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await authFetch('/api/stripe/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, url: formUrl, events: formEvents }),
      }, router);
      if (!result) { setSaving(false); return; }
      const { response, data } = result;
      if (response.ok && data.success) {
        if (data.endpoint?.secret) {
          const secret = data.endpoint.secret;
          const truncated = secret.slice(0, 12) + '...' + secret.slice(-4);
          // Copy to clipboard immediately — don't store the full key
          try {
            await navigator.clipboard.writeText(secret);
            setCreatedSecret({ endpointId: data.endpoint.id, truncated, copied: true });
          } catch {
            // Clipboard failed — user will need to get it from Stripe dashboard
            setCreatedSecret({ endpointId: data.endpoint.id, truncated, copied: false });
          }
        }
        setSuccess('Webhook endpoint created');
        setShowForm(false);
        setFormUrl('');
        setFormEvents([]);
        fetchEndpoints();
      } else {
        setError(data.error || 'Failed to create webhook endpoint');
      }
    } catch {
      setError('Failed to create webhook endpoint');
    }
    setSaving(false);
  };

  const handleDelete = async (endpointId: string) => {
    if (!confirm('Delete this webhook endpoint?')) return;
    setDeleting(endpointId);
    setError('');
    try {
      const result = await authFetch(`/api/stripe/webhooks/${endpointId}?business_id=${businessId}`, {
        method: 'DELETE',
      }, router);
      if (!result) { setDeleting(null); return; }
      const { response, data } = result;
      if (response.ok && data.success) {
        setSuccess('Webhook endpoint deleted');
        setTimeout(() => setSuccess(''), 3000);
        fetchEndpoints();
      } else {
        setError(data.error || 'Failed to delete webhook endpoint');
      }
    } catch {
      setError('Failed to delete webhook endpoint');
    }
    setDeleting(null);
  };

  const toggleEvent = (event: string) => {
    setFormEvents(prev =>
      prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]
    );
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">Loading Stripe webhooks...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Stripe Webhook Endpoints</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500"
        >
          {showForm ? 'Cancel' : 'Add Endpoint'}
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}
      {success && (
        <div className="mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-4 py-3 rounded-lg text-sm">{success}</div>
      )}

      {createdSecret && (
        <div className="mb-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
                {createdSecret.copied ? '✓ Signing secret copied to clipboard' : '⚠️ Webhook Signing Secret'}
              </p>
              <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1">
                {createdSecret.copied
                  ? 'Paste it somewhere safe — this is the only time it\'s available.'
                  : 'Clipboard access was blocked. Retrieve the secret from your Stripe dashboard.'}
              </p>
              <code className="mt-2 inline-block text-sm font-mono bg-yellow-100 dark:bg-yellow-900/40 text-yellow-900 dark:text-yellow-200 px-3 py-1.5 rounded">
                {createdSecret.truncated}
              </code>
            </div>
            <button
              onClick={() => { setCreatedSecret(null); setSuccess(''); }}
              className="ml-4 px-3 py-1 text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 bg-gray-50 dark:bg-gray-900 rounded-lg p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Endpoint URL</label>
            <input
              type="url"
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 dark:text-white dark:bg-gray-700"
              placeholder="https://example.com/stripe-webhook"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Events to subscribe</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
              {COMMON_EVENTS.map(event => (
                <label key={event} className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={formEvents.includes(event)}
                    onChange={() => toggleEvent(event)}
                    className="rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="font-mono text-xs">{event}</span>
                </label>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500 disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Endpoint'}
          </button>
        </form>
      )}

      {endpoints.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 py-4">No webhook endpoints configured.</p>
      ) : (
        <div className="space-y-4">
          {endpoints.map((ep) => (
            <div key={ep.id} className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-gray-900 dark:text-white break-all">{ep.url}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${statusColors[ep.status] || 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}>
                      {ep.status}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">
                      Created {formatDate(new Date(ep.created * 1000).toISOString())}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {ep.enabled_events.slice(0, 5).map(ev => (
                      <span key={ev} className="px-2 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded font-mono">{ev}</span>
                    ))}
                    {ep.enabled_events.length > 5 && (
                      <span className="px-2 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded">+{ep.enabled_events.length - 5} more</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(ep.id)}
                  disabled={deleting === ep.id}
                  className="ml-4 px-3 py-1 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-500 disabled:opacity-50"
                >
                  {deleting === ep.id ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
