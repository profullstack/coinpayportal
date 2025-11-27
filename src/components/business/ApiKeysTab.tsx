'use client';

import { useState } from 'react';
import { Business } from './types';

interface ApiKeysTabProps {
  business: Business;
  onUpdate: () => void;
  onCopy: (text: string, label: string) => void;
}

export function ApiKeysTab({ business, onUpdate, onCopy }: ApiKeysTabProps) {
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');

  const handleRegenerateApiKey = async () => {
    if (
      !confirm(
        'Are you sure you want to regenerate the API key? This will invalidate the current key.'
      )
    ) {
      return;
    }

    setError('');
    setRegenerating(true);

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/api/businesses/${business.id}/api-key`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to regenerate API key');
        setRegenerating(false);
        return;
      }

      setRegenerating(false);
      onUpdate();
    } catch (err) {
      setError('Failed to regenerate API key');
      setRegenerating(false);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 mb-6">API Keys</h2>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {business.api_key ? (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Current API Key
            </label>
            <div className="flex items-center space-x-2">
              <code className="flex-1 px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg font-mono text-sm text-gray-900 break-all">
                {business.api_key}
              </code>
              <button
                onClick={() => onCopy(business.api_key!, 'API key')}
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
              Use this key to authenticate API requests
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="text-sm font-medium text-blue-900 mb-2">Usage Example</h4>
            <pre className="text-xs text-blue-800 font-mono overflow-x-auto">
{`curl -X POST https://your-domain.com/api/payments/create \\
  -H "Authorization: Bearer ${business.api_key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "100.00",
    "cryptocurrency": "BTC",
    "description": "Payment for order #123"
  }'`}
            </pre>
          </div>

          <button
            onClick={handleRegenerateApiKey}
            disabled={regenerating}
            className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-500 disabled:opacity-50"
          >
            {regenerating ? 'Regenerating...' : 'Regenerate API Key'}
          </button>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Security Best Practices</h3>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start">
                <svg
                  className="h-5 w-5 text-green-500 mr-2 flex-shrink-0"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M5 13l4 4L19 7"></path>
                </svg>
                Never share your API key publicly or commit it to version control
              </li>
              <li className="flex items-start">
                <svg
                  className="h-5 w-5 text-green-500 mr-2 flex-shrink-0"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M5 13l4 4L19 7"></path>
                </svg>
                Store API keys securely using environment variables
              </li>
              <li className="flex items-start">
                <svg
                  className="h-5 w-5 text-green-500 mr-2 flex-shrink-0"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M5 13l4 4L19 7"></path>
                </svg>
                Regenerate your API key immediately if you suspect it has been compromised
              </li>
              <li className="flex items-start">
                <svg
                  className="h-5 w-5 text-green-500 mr-2 flex-shrink-0"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M5 13l4 4L19 7"></path>
                </svg>
                Use HTTPS for all API requests to protect your key in transit
              </li>
            </ul>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm text-gray-600 mb-4">No API key generated yet.</p>
          <button
            onClick={handleRegenerateApiKey}
            disabled={regenerating}
            className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500 disabled:opacity-50"
          >
            {regenerating ? 'Generating...' : 'Generate API Key'}
          </button>
        </div>
      )}
    </div>
  );
}