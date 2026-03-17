'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface OAuthClient {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  redirect_uris: string[];
  scopes: string[];
  is_active: boolean;
  created_at: string;
}

export default function OAuthDashboardPage() {
  const router = useRouter();
  const [clients, setClients] = useState<OAuthClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    try {
      const result = await authFetch('/api/oauth/clients', {}, router);
      if (!result) return;

      const { response, data } = result;
      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to fetch clients');
        return;
      }

      setClients(data.clients);
    } catch (err) {
      setError('Failed to load OAuth clients');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const handleDelete = async (client: OAuthClient) => {
    if (!confirm(`Delete "${client.name}"? This cannot be undone.`)) return;

    setDeletingId(client.id);
    try {
      const result = await authFetch(`/api/oauth/clients/${client.id}`, {
        method: 'DELETE',
      }, router);

      if (!result) return;
      if (!result.response.ok) {
        setError('Failed to delete client');
        return;
      }

      setClients((prev) => prev.filter((c) => c.id !== client.id));
    } catch {
      setError('Failed to delete client');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            <p className="mt-2 text-gray-600 dark:text-gray-300">Loading OAuth apps...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">OAuth Apps</h1>
            <p className="mt-2 text-gray-600 dark:text-gray-300">
              Manage your OAuth2/OIDC client applications
            </p>
          </div>
          <Link
            href="/dashboard/oauth/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-500 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Register New App
          </Link>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {clients.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-12 text-center">
            <svg className="mx-auto h-16 w-16 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">No OAuth apps yet</h3>
            <p className="mt-2 text-gray-500 dark:text-gray-400">
              Register an OAuth client to allow third-party apps to authenticate with CoinPay.
            </p>
            <Link
              href="/dashboard/oauth/new"
              className="mt-6 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-500 transition-colors"
            >
              Register New App
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {clients.map((client) => (
              <div
                key={client.id}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                        {client.name}
                      </h3>
                      {!client.is_active && (
                        <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
                          Inactive
                        </span>
                      )}
                    </div>
                    {client.description && (
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {client.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Link
                      href={`/dashboard/oauth/new?edit=${client.id}`}
                      className="p-2 text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
                      title="Edit"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </Link>
                    <button
                      onClick={() => handleDelete(client)}
                      disabled={deletingId === client.id}
                      className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                      title="Delete"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Client ID */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                      Client ID
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="text-sm text-gray-900 dark:text-gray-100 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded font-mono truncate">
                        {client.client_id}
                      </code>
                      <button
                        onClick={() => copyToClipboard(client.client_id, client.id)}
                        className="flex-shrink-0 p-1 text-gray-400 hover:text-purple-600 transition-colors"
                        title="Copy"
                      >
                        {copiedId === client.id ? (
                          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Created */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                      Created
                    </label>
                    <span className="text-sm text-gray-900 dark:text-gray-100">
                      {new Date(client.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Redirect URIs */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                      Redirect URIs
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {client.redirect_uris.map((uri, i) => (
                        <span
                          key={i}
                          className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1 rounded font-mono"
                        >
                          {uri}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Scopes */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                      Scopes
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {client.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-1 rounded"
                        >
                          {scope}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Back to dashboard */}
        <div className="mt-8">
          <Link
            href="/dashboard"
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
