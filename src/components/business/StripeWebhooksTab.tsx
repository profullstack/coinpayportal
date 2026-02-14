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
        setSuccess('Webhook endpoint created');
        setTimeout(() => setSuccess(''), 3000);
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
        <p className="mt-2 text-sm text-gray-500">Loading Stripe webhooks...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Stripe Webhook Endpoints</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500"
        >
          {showForm ? 'Cancel' : 'Add Endpoint'}
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}
      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{success}</div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 bg-gray-50 rounded-lg p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Endpoint URL</label>
            <input
              type="url"
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
              placeholder="https://example.com/stripe-webhook"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Events to subscribe</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
              {COMMON_EVENTS.map(event => (
                <label key={event} className="flex items-center space-x-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={formEvents.includes(event)}
                    onChange={() => toggleEvent(event)}
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
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
        <p className="text-sm text-gray-500 py-4">No webhook endpoints configured.</p>
      ) : (
        <div className="space-y-4">
          {endpoints.map((ep) => (
            <div key={ep.id} className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-gray-900 break-all">{ep.url}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${statusColors[ep.status] || 'bg-gray-100 text-gray-700'}`}>
                      {ep.status}
                    </span>
                    <span className="text-xs text-gray-500">
                      Created {formatDate(new Date(ep.created * 1000).toISOString())}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {ep.enabled_events.slice(0, 5).map(ev => (
                      <span key={ev} className="px-2 py-0.5 text-xs bg-gray-200 text-gray-700 rounded font-mono">{ev}</span>
                    ))}
                    {ep.enabled_events.length > 5 && (
                      <span className="px-2 py-0.5 text-xs bg-gray-200 text-gray-700 rounded">+{ep.enabled_events.length - 5} more</span>
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
