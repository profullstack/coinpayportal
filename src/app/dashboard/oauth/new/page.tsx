'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

const AVAILABLE_SCOPES = ['openid', 'profile', 'email', 'payments:read', 'payments:write'];

interface CreatedSecret {
  client_id: string;
  client_secret: string;
}

export default function OAuthNewPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          <p className="mt-2 text-gray-600 dark:text-gray-300">Loading...</p>
        </div>
      </div>
    }>
      <OAuthNewForm />
    </Suspense>
  );
}

function OAuthNewForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [redirectUris, setRedirectUris] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['openid', 'profile', 'email']);
  const [loading, setLoading] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(!!editId);
  const [error, setError] = useState('');
  const [createdSecret, setCreatedSecret] = useState<CreatedSecret | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    if (editId) {
      loadClient(editId);
    }
  }, [editId]);

  const loadClient = async (id: string) => {
    try {
      const result = await authFetch(`/api/oauth/clients/${id}`, {}, router);
      if (!result) return;

      const { response, data } = result;
      if (!response.ok || !data.success) {
        setError('Client not found');
        setLoadingEdit(false);
        return;
      }

      const client = data.client;
      setName(client.name);
      setDescription(client.description || '');
      setRedirectUris(client.redirect_uris.join('\n'));
      setSelectedScopes(client.scopes || []);
    } catch {
      setError('Failed to load client');
    } finally {
      setLoadingEdit(false);
    }
  };

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const uris = redirectUris
      .split(/[\n,]/)
      .map((u) => u.trim())
      .filter(Boolean);

    if (uris.length === 0) {
      setError('At least one redirect URI is required');
      setLoading(false);
      return;
    }

    try {
      if (editId) {
        // Update existing client
        const result = await authFetch(`/api/oauth/clients/${editId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            description: description || null,
            redirect_uris: uris,
            scopes: selectedScopes,
          }),
        }, router);

        if (!result) return;

        const { response, data } = result;
        if (!response.ok || !data.success) {
          setError(data.error || 'Failed to update client');
          setLoading(false);
          return;
        }

        router.push('/dashboard/oauth');
      } else {
        // Create new client
        const result = await authFetch('/api/oauth/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            description: description || null,
            redirect_uris: uris,
            scopes: selectedScopes,
          }),
        }, router);

        if (!result) return;

        const { response, data } = result;
        if (!response.ok || !data.success) {
          setError(data.error || 'Failed to create client');
          setLoading(false);
          return;
        }

        // Show the secret
        setCreatedSecret({
          client_id: data.client.client_id,
          client_secret: data.client.client_secret,
        });
      }
    } catch {
      setError('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  if (loadingEdit) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          <p className="mt-2 text-gray-600 dark:text-gray-300">Loading...</p>
        </div>
      </div>
    );
  }

  // Secret display after creation
  if (createdSecret) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8">
            <div className="text-center mb-6">
              <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">App Created!</h2>
            </div>

            {/* Warning */}
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <p className="text-sm text-yellow-800 dark:text-yellow-200 font-medium">
                  Save the client secret now — you won&apos;t see it again!
                </p>
              </div>
            </div>

            {/* Client ID */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Client ID</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2 rounded font-mono text-sm break-all">
                  {createdSecret.client_id}
                </code>
                <button
                  onClick={() => copyToClipboard(createdSecret.client_id, 'id')}
                  className="flex-shrink-0 px-3 py-2 text-sm font-medium text-purple-600 bg-purple-50 dark:bg-purple-900/20 rounded hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
                >
                  {copiedField === 'id' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Client Secret */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Client Secret</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2 rounded font-mono text-sm break-all">
                  {createdSecret.client_secret}
                </code>
                <button
                  onClick={() => copyToClipboard(createdSecret.client_secret, 'secret')}
                  className="flex-shrink-0 px-3 py-2 text-sm font-medium text-purple-600 bg-purple-50 dark:bg-purple-900/20 rounded hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
                >
                  {copiedField === 'secret' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <Link
              href="/dashboard/oauth"
              className="block w-full text-center bg-purple-600 text-white py-2.5 px-4 rounded-lg font-semibold hover:bg-purple-500 transition-colors"
            >
              Done
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <Link
            href="/dashboard/oauth"
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400"
          >
            ← Back to OAuth Apps
          </Link>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">
          {editId ? 'Edit App' : 'Register New App'}
        </h1>

        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 space-y-6">
          {/* Name */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              App Name *
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="My OAuth App"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="Brief description of your application"
            />
          </div>

          {/* Redirect URIs */}
          <div>
            <label htmlFor="redirect_uris" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Redirect URIs * <span className="font-normal text-gray-500">(one per line or comma-separated)</span>
            </label>
            <textarea
              id="redirect_uris"
              required
              value={redirectUris}
              onChange={(e) => setRedirectUris(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
              placeholder="https://myapp.com/callback&#10;https://myapp.com/auth/callback"
            />
          </div>

          {/* Scopes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Scopes
            </label>
            <div className="flex flex-wrap gap-3">
              {AVAILABLE_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                    selectedScopes.includes(scope)
                      ? 'bg-purple-50 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300'
                      : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-400'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                    className="sr-only"
                  />
                  <span className="text-sm">{scope}</span>
                  {selectedScopes.includes(scope) && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </label>
              ))}
            </div>
          </div>

          {/* Submit */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
            <Link
              href="/dashboard/oauth"
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 font-medium"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="bg-purple-600 text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Saving...' : editId ? 'Update App' : 'Create App'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
