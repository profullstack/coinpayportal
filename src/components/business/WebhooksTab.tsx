'use client';

import { useState } from 'react';
import { Business } from './types';

interface WebhooksTabProps {
  business: Business;
  onUpdate: () => void;
  onCopy: (text: string, label: string) => void;
}

export function WebhooksTab({ business, onUpdate, onCopy }: WebhooksTabProps) {
  const [formData, setFormData] = useState({
    webhook_url: business.webhook_url || '',
  });
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/api/businesses/${business.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to update webhook');
        setSaving(false);
        return;
      }

      setSaving(false);
      onUpdate();
    } catch (err) {
      setError('Failed to update webhook');
      setSaving(false);
    }
  };

  const handleRegenerateSecret = async () => {
    if (
      !confirm(
        'Are you sure you want to regenerate the webhook secret? This will invalidate the current secret.'
      )
    ) {
      return;
    }

    setError('');
    setRegenerating(true);

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/api/businesses/${business.id}/webhook-secret`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to regenerate webhook secret');
        setRegenerating(false);
        return;
      }

      setRegenerating(false);
      onUpdate();
    } catch (err) {
      setError('Failed to regenerate webhook secret');
      setRegenerating(false);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 mb-6">Webhook Configuration</h2>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Webhook URL</label>
          <input
            type="url"
            value={formData.webhook_url}
            onChange={(e) => setFormData({ webhook_url: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
            placeholder="https://example.com/webhook"
          />
          <p className="mt-1 text-xs text-gray-500">
            URL where payment notifications will be sent
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500 disabled:opacity-50"
        >
          {saving ? 'Updating...' : 'Update Webhook URL'}
        </button>
      </form>

      <div className="mt-8 pt-8 border-t border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Webhook Secret</h3>
        {business.webhook_secret ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Current Secret
              </label>
              <div className="flex items-center space-x-2">
                <code className="flex-1 px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg font-mono text-sm text-gray-900 break-all">
                  {business.webhook_secret}
                </code>
                <button
                  onClick={() => onCopy(business.webhook_secret!, 'Webhook secret')}
                  className="text-purple-600 hover:text-purple-500"
                  title="Copy to clipboard"
                >
                  <svg
                    className="h-5 w-5"
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
              <p className="mt-1 text-xs text-gray-500">
                Use this secret to verify webhook signatures
              </p>
            </div>
            <button
              onClick={handleRegenerateSecret}
              disabled={regenerating}
              className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-500 disabled:opacity-50"
            >
              {regenerating ? 'Regenerating...' : 'Regenerate Secret'}
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-600 mb-4">No webhook secret generated yet.</p>
            <button
              onClick={handleRegenerateSecret}
              disabled={regenerating}
              className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500 disabled:opacity-50"
            >
              {regenerating ? 'Generating...' : 'Generate Secret'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}