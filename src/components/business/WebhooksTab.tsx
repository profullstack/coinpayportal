'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import { Business } from './types';

interface WebhookDelivery {
  id: string;
  event: string;
  webhook_url: string | null;
  url: string | null;
  status_code: number | null;
  response_status: number | null;
  success: boolean | null;
  error_message: string | null;
  attempt_number: number | null;
  response_time_ms: number | null;
  created_at: string;
  payment_id: string | null;
}

interface WebhookTestResult {
  delivered: boolean;
  status_code: number | null;
  status_text: string | null;
  response_time_ms: number;
  response_body?: string | null;
  response_headers?: Record<string, string>;
  error?: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: Record<string, any>;
  };
}

interface WebhooksTabProps {
  business: Business;
  onUpdate: () => void;
  onCopy: (text: string, label: string) => void;
}

function formatTestResultAsMarkdown(result: WebhookTestResult): string {
  const lines: string[] = [];

  lines.push('# Webhook Test Result');
  lines.push('');

  // Status
  lines.push('## Status');
  lines.push(`- **Delivered:** ${result.delivered ? 'Yes' : 'No'}`);
  if (result.status_code !== null) {
    lines.push(`- **HTTP Status:** ${result.status_code} ${result.status_text || ''}`);
  }
  lines.push(`- **Response Time:** ${result.response_time_ms}ms`);
  if (result.error) {
    lines.push(`- **Error:** ${result.error}`);
  }
  lines.push('');

  // Request
  lines.push('## Request');
  lines.push('');
  lines.push('### Endpoint');
  lines.push(`- **URL:** ${result.request.url}`);
  lines.push(`- **Method:** ${result.request.method}`);
  lines.push('');

  lines.push('### Headers');
  lines.push('```json');
  lines.push(JSON.stringify(result.request.headers, null, 2));
  lines.push('```');
  lines.push('');

  lines.push('### Body');
  lines.push('```json');
  lines.push(JSON.stringify(result.request.body, null, 2));
  lines.push('```');
  lines.push('');

  // Response
  lines.push('## Response');
  lines.push('');
  lines.push(`- **Status:** ${result.status_code !== null ? `${result.status_code} ${result.status_text}` : 'No response (connection failed)'}`);
  lines.push('');

  if (result.response_headers && Object.keys(result.response_headers).length > 0) {
    lines.push('### Headers');
    lines.push('```json');
    lines.push(JSON.stringify(result.response_headers, null, 2));
    lines.push('```');
    lines.push('');
  }

  if (result.response_body) {
    lines.push('### Body');
    lines.push('```json');
    try {
      lines.push(JSON.stringify(JSON.parse(result.response_body), null, 2));
    } catch {
      lines.push(result.response_body);
    }
    lines.push('```');
  } else {
    lines.push('### Body');
    lines.push('*No response body*');
  }

  return lines.join('\n');
}

export function WebhooksTab({ business, onUpdate, onCopy }: WebhooksTabProps) {
  const router = useRouter();
  const [revealedSecret, setRevealedSecret] = useState('');
  const [formData, setFormData] = useState({
    webhook_url: business.webhook_url || '',
  });
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<WebhookTestResult | null>(null);
  const [error, setError] = useState('');
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);

  const fetchDeliveries = useCallback(async () => {
    setDeliveriesLoading(true);
    try {
      const res = await authFetch(
        `/api/webhooks?business_id=${business.id}&limit=20`,
        {},
        router
      );
      if (!res) return;
      if (res.data?.success && Array.isArray(res.data.logs)) {
        setDeliveries(res.data.logs);
      }
    } catch {
      // soft-fail; the panel just stays empty
    } finally {
      setDeliveriesLoading(false);
    }
  }, [business.id, router]);

  useEffect(() => {
    fetchDeliveries();
  }, [fetchDeliveries]);

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

  const handleTestWebhook = async () => {
    setError('');
    setTesting(true);
    setTestResult(null);

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/api/businesses/${business.id}/webhook-test`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to test webhook');
        setTesting(false);
        return;
      }

      setTestResult(data.test_result);
      setTesting(false);
    } catch (err) {
      setError('Failed to test webhook');
      setTesting(false);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">Webhook Configuration</h2>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Webhook URL</label>
          <input
            type="url"
            value={formData.webhook_url}
            onChange={(e) => setFormData({ webhook_url: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 dark:text-white dark:bg-gray-700"
            placeholder="https://example.com/webhook"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">
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

      <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Webhook Secret</h3>
        {business.webhook_secret ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                Current Secret
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Webhook secret is encrypted at rest. Click &quot;Copy&quot; to decrypt and copy to clipboard, or &quot;Reveal&quot; to show it.
              </p>
              <div className="flex items-center space-x-2">
                <code className="flex-1 px-4 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg font-mono text-sm text-gray-900 dark:text-white dark:bg-gray-700 break-all">
                  {revealedSecret || 'whsec_••••••••••••••••'}
                </code>
                <button
                  onClick={async () => {
                    try {
                      const res = await authFetch(`/api/businesses/${business.id}/webhook-secret`, {}, router);
                      if (!res) return;
                      const { data } = res;
                      if (data.success && data.secret) {
                        setRevealedSecret(data.secret);
                      }
                    } catch {}
                  }}
                  className="text-gray-600 hover:text-gray-500 dark:text-gray-400 text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded"
                  title="Reveal secret"
                >
                  {revealedSecret ? 'Revealed' : 'Reveal'}
                </button>
                <button
                  onClick={async () => {
                    try {
                      const res = await authFetch(`/api/businesses/${business.id}/webhook-secret`, {}, router);
                      if (!res) return;
                      const { data } = res;
                      if (data.success && data.secret) {
                        navigator.clipboard.writeText(data.secret);
                        onCopy(data.secret, 'Webhook secret');
                      }
                    } catch {}
                  }}
                  className="text-purple-600 hover:text-purple-500"
                  title="Copy decrypted secret to clipboard"
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
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">
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
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">No webhook secret generated yet.</p>
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

      {/* Test Webhook Section */}
      <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Test Webhook</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          Send a test webhook to verify your endpoint is working correctly.
        </p>

        <button
          onClick={handleTestWebhook}
          disabled={testing || !business.webhook_url || !business.webhook_secret}
          className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-500 disabled:opacity-50 flex items-center space-x-2"
        >
          {testing ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span>Sending Test...</span>
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              <span>Send Test Webhook</span>
            </>
          )}
        </button>

        {!business.webhook_url && (
          <p className="mt-2 text-xs text-amber-600">
            Please configure a webhook URL first.
          </p>
        )}
        {business.webhook_url && !business.webhook_secret && (
          <p className="mt-2 text-xs text-amber-600">
            Please generate a webhook secret first.
          </p>
        )}

        {/* Test Result Display */}
        {testResult && (
          <div className="mt-6 space-y-4">
            {/* Copy as Markdown Button */}
            <div className="flex justify-end">
              <button
                onClick={() => {
                  const markdown = formatTestResultAsMarkdown(testResult);
                  onCopy(markdown, 'Webhook test result (Markdown)');
                }}
                className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg hover:bg-gray-200 dark:bg-gray-700 flex items-center space-x-2"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Copy as Markdown</span>
              </button>
            </div>

            {/* Status Banner */}
            <div
              className={`p-4 rounded-lg ${
                testResult.delivered
                  ? 'bg-green-50 border border-green-200'
                  : 'bg-red-50 border border-red-200'
              }`}
            >
              <div className="flex items-center space-x-3">
                {testResult.delivered ? (
                  <svg
                    className="h-6 w-6 text-green-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                ) : (
                  <svg
                    className="h-6 w-6 text-red-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                )}
                <div>
                  <h4
                    className={`font-semibold ${
                      testResult.delivered ? 'text-green-800' : 'text-red-800'
                    }`}
                  >
                    {testResult.delivered ? 'Webhook Delivered Successfully' : 'Webhook Delivery Failed'}
                  </h4>
                  <p
                    className={`text-sm ${
                      testResult.delivered ? 'text-green-700' : 'text-red-700'
                    }`}
                  >
                    {testResult.delivered
                      ? `Status: ${testResult.status_code} ${testResult.status_text}`
                      : testResult.error || `Status: ${testResult.status_code} ${testResult.status_text}`}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Response time: {testResult.response_time_ms}ms
              </p>
            </div>

            {/* Request Details */}
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
              <h5 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center space-x-2">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16l-4-4m0 0l4-4m-4 4h18"
                  />
                </svg>
                <span>Request</span>
              </h5>
              <div className="space-y-2">
                <div>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase">URL</span>
                  <p className="text-sm text-gray-900 dark:text-white font-mono break-all">{testResult.request.url}</p>
                </div>
                <div>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase">Method</span>
                  <p className="text-sm text-gray-900 dark:text-white">{testResult.request.method}</p>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase">Headers</span>
                    <button
                      onClick={() => onCopy(JSON.stringify(testResult.request.headers, null, 2), 'Request headers')}
                      className="text-purple-600 hover:text-purple-500 p-1"
                      title="Copy to clipboard"
                    >
                      <svg className="h-4 w-4" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                        <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                      </svg>
                    </button>
                  </div>
                  <pre className="text-xs text-gray-900 dark:text-white bg-white dark:bg-gray-800 p-2 rounded border overflow-x-auto">
                    {JSON.stringify(testResult.request.headers, null, 2)}
                  </pre>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">
                    Signature format: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">t=timestamp,v1=hmac_sha256_hex</code>
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase">Body</span>
                    <button
                      onClick={() => onCopy(JSON.stringify(testResult.request.body, null, 2), 'Request body')}
                      className="text-purple-600 hover:text-purple-500 p-1"
                      title="Copy to clipboard"
                    >
                      <svg className="h-4 w-4" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                        <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                      </svg>
                    </button>
                  </div>
                  <pre className="text-xs text-gray-900 dark:text-white bg-white dark:bg-gray-800 p-2 rounded border overflow-x-auto max-h-48">
                    {JSON.stringify(testResult.request.body, null, 2)}
                  </pre>
                </div>
              </div>
            </div>

            {/* Response Details */}
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
              <h5 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center space-x-2">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 8l4 4m0 0l-4 4m4-4H3"
                  />
                </svg>
                <span>Response</span>
              </h5>
              <div className="space-y-2">
                <div>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase">Status</span>
                  <p className="text-sm text-gray-900 dark:text-white">
                    {testResult.status_code !== null
                      ? `${testResult.status_code} ${testResult.status_text}`
                      : 'No response (connection failed)'}
                  </p>
                </div>
                {testResult.response_headers && Object.keys(testResult.response_headers).length > 0 && (
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase">Headers</span>
                      <button
                        onClick={() => onCopy(JSON.stringify(testResult.response_headers, null, 2), 'Response headers')}
                        className="text-purple-600 hover:text-purple-500 p-1"
                        title="Copy to clipboard"
                      >
                        <svg className="h-4 w-4" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                          <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                        </svg>
                      </button>
                    </div>
                    <pre className="text-xs text-gray-900 dark:text-white bg-white dark:bg-gray-800 p-2 rounded border overflow-x-auto max-h-32">
                      {JSON.stringify(testResult.response_headers, null, 2)}
                    </pre>
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase">Body</span>
                    {testResult.response_body && (
                      <button
                        onClick={() => {
                          try {
                            onCopy(JSON.stringify(JSON.parse(testResult.response_body!), null, 2), 'Response body');
                          } catch {
                            onCopy(testResult.response_body!, 'Response body');
                          }
                        }}
                        className="text-purple-600 hover:text-purple-500 p-1"
                        title="Copy to clipboard"
                      >
                        <svg className="h-4 w-4" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                          <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                        </svg>
                      </button>
                    )}
                  </div>
                  {testResult.response_body ? (
                    <pre className="text-xs text-gray-900 dark:text-white bg-white dark:bg-gray-800 p-2 rounded border overflow-x-auto max-h-48">
                      {(() => {
                        try {
                          return JSON.stringify(JSON.parse(testResult.response_body), null, 2);
                        } catch {
                          return testResult.response_body;
                        }
                      })()}
                    </pre>
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 italic">No response body</p>
                  )}
                </div>
                {testResult.error && (
                  <div>
                    <span className="text-xs font-medium text-red-500 uppercase">Error</span>
                    <p className="text-sm text-red-700 dark:text-red-400">{testResult.error}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Recent Deliveries */}
      <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Deliveries</h3>
          <button
            onClick={fetchDeliveries}
            disabled={deliveriesLoading}
            className="text-sm text-purple-600 hover:text-purple-500 disabled:opacity-50"
          >
            {deliveriesLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          Last 20 outbound webhook attempts to <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{business.webhook_url || '(no URL configured)'}</code>.
          Both crypto and credit-card events route through this single endpoint.
        </p>

        {deliveries.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 italic px-4 py-6 bg-gray-50 dark:bg-gray-900 rounded-lg text-center">
            {deliveriesLoading ? 'Loading…' : 'No deliveries yet. Send a Test Webhook above or wait for the next live event.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="pb-2 pr-4">Time</th>
                  <th className="pb-2 pr-4">Event</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Latency</th>
                  <th className="pb-2 pr-4">Attempt</th>
                  <th className="pb-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => {
                  const status = d.status_code ?? d.response_status;
                  const ok = d.success === true || (status !== null && status >= 200 && status < 300);
                  return (
                    <tr key={d.id} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-2 pr-4 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {new Date(d.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 text-xs font-mono text-gray-900 dark:text-white">{d.event}</td>
                      <td className="py-2 pr-4">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            ok
                              ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300'
                              : status === null
                                ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                                : 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300'
                          }`}
                        >
                          {status ?? 'no response'}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-xs text-gray-600 dark:text-gray-400">
                        {d.response_time_ms != null ? `${d.response_time_ms}ms` : '—'}
                      </td>
                      <td className="py-2 pr-4 text-xs text-gray-600 dark:text-gray-400">
                        {d.attempt_number ?? 1}
                      </td>
                      <td className="py-2 text-xs text-red-600 dark:text-red-400 max-w-xs truncate" title={d.error_message || ''}>
                        {d.error_message || ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}