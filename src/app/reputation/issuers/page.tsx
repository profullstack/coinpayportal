'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch, requireAuth } from '@/lib/auth/client';

interface Issuer {
  id: string;
  did: string;
  name: string;
  domain: string;
  active: boolean;
  api_key: string | null;
  created_at: string;
}

export default function IssuersPage() {
  const router = useRouter();
  const [issuers, setIssuers] = useState<Issuer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newIssuerName, setNewIssuerName] = useState('');
  const [newIssuerDomain, setNewIssuerDomain] = useState('');
  const [registering, setRegistering] = useState(false);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [rotatedApiKey, setRotatedApiKey] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'rotate' | 'deactivate'; id: string; name: string } | null>(null);

  const fetchIssuers = useCallback(async () => {
    const result = await authFetch('/api/reputation/issuers', {}, router);
    if (result?.data?.success) {
      setIssuers(result.data.issuers);
    } else {
      setError(result?.data?.error || 'Failed to load issuers');
    }
    setLoading(false);
  }, [router]);

  useEffect(() => {
    if (!requireAuth(router)) return;
    fetchIssuers();
  }, [router, fetchIssuers]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegistering(true);
    setError('');
    setNewApiKey(null);

    const result = await authFetch('/api/reputation/issuers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newIssuerName, domain: newIssuerDomain }),
    }, router);

    if (result?.data?.success) {
      setNewApiKey(result.data.api_key);
      setNewIssuerName('');
      setNewIssuerDomain('');
      fetchIssuers();
    } else {
      setError(result?.data?.error || 'Registration failed');
    }
    setRegistering(false);
  };

  const handleRotate = async (id: string) => {
    setRotatedApiKey(null);
    const result = await authFetch(`/api/reputation/issuers/${id}/rotate`, {
      method: 'POST',
    }, router);

    if (result?.data?.success) {
      setRotatedApiKey(result.data.api_key);
      fetchIssuers();
    } else {
      setError(result?.data?.error || 'Rotation failed');
    }
    setConfirmAction(null);
  };

  const handleDeactivate = async (id: string) => {
    const result = await authFetch(`/api/reputation/issuers/${id}`, {
      method: 'DELETE',
    }, router);

    if (result?.data?.success) {
      fetchIssuers();
    } else {
      setError(result?.data?.error || 'Deactivation failed');
    }
    setConfirmAction(null);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Platform Issuers</h1>
            <p className="text-gray-400 mt-1">Manage API keys for platform reputation integration</p>
          </div>
          <Link href="/reputation" className="text-blue-400 hover:text-blue-300">
            ← Back to Reputation
          </Link>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded mb-6">
            {error}
            <button onClick={() => setError('')} className="float-right text-red-400 hover:text-red-200">✕</button>
          </div>
        )}

        {/* New API Key Display */}
        {newApiKey && (
          <div className="bg-yellow-900/50 border border-yellow-600 text-yellow-200 px-4 py-4 rounded mb-6">
            <p className="font-bold mb-2">⚠️ New API Key (shown only once):</p>
            <code className="block bg-black/50 p-3 rounded text-sm break-all select-all">{newApiKey}</code>
            <button onClick={() => setNewApiKey(null)} className="mt-2 text-yellow-400 hover:text-yellow-200 text-sm">Dismiss</button>
          </div>
        )}

        {rotatedApiKey && (
          <div className="bg-yellow-900/50 border border-yellow-600 text-yellow-200 px-4 py-4 rounded mb-6">
            <p className="font-bold mb-2">⚠️ Rotated API Key (shown only once):</p>
            <code className="block bg-black/50 p-3 rounded text-sm break-all select-all">{rotatedApiKey}</code>
            <button onClick={() => setRotatedApiKey(null)} className="mt-2 text-yellow-400 hover:text-yellow-200 text-sm">Dismiss</button>
          </div>
        )}

        {/* Register Form */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Register New Issuer</h2>
          <form onSubmit={handleRegister} className="flex gap-4 items-end flex-wrap">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Name</label>
              <input
                type="text"
                value={newIssuerName}
                onChange={(e) => setNewIssuerName(e.target.value)}
                placeholder="myplatform"
                pattern="[a-zA-Z0-9._-]+"
                required
                className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Domain</label>
              <input
                type="text"
                value={newIssuerDomain}
                onChange={(e) => setNewIssuerDomain(e.target.value)}
                placeholder="myplatform.com"
                required
                className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={registering}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 px-4 py-2 rounded font-medium"
            >
              {registering ? 'Registering...' : 'Register'}
            </button>
          </form>
        </div>

        {/* Confirmation Modal */}
        {confirmAction && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-md">
              <h3 className="text-lg font-bold mb-2">
                {confirmAction.type === 'rotate' ? 'Rotate API Key?' : 'Deactivate Issuer?'}
              </h3>
              <p className="text-gray-400 mb-4">
                {confirmAction.type === 'rotate'
                  ? `This will invalidate the current API key for "${confirmAction.name}" and generate a new one.`
                  : `This will deactivate "${confirmAction.name}". The API key will stop working.`}
              </p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setConfirmAction(null)} className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600">Cancel</button>
                <button
                  onClick={() => confirmAction.type === 'rotate' ? handleRotate(confirmAction.id) : handleDeactivate(confirmAction.id)}
                  className={`px-4 py-2 rounded font-medium ${confirmAction.type === 'rotate' ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-red-600 hover:bg-red-700'}`}
                >
                  {confirmAction.type === 'rotate' ? 'Rotate' : 'Deactivate'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Issuers List */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <h2 className="text-xl font-semibold p-6 pb-4">Your Issuers</h2>
          {loading ? (
            <p className="text-gray-400 p-6 pt-0">Loading...</p>
          ) : issuers.length === 0 ? (
            <p className="text-gray-400 p-6 pt-0">No issuers registered yet.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-t border-gray-800 text-left text-gray-400 text-sm">
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Domain</th>
                  <th className="px-6 py-3">API Key</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {issuers.map((issuer) => (
                  <tr key={issuer.id} className="border-t border-gray-800 hover:bg-gray-800/50">
                    <td className="px-6 py-4">
                      <div className="font-medium">{issuer.name}</div>
                      <div className="text-xs text-gray-500">{issuer.did}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-300">{issuer.domain}</td>
                    <td className="px-6 py-4">
                      <code className="text-sm text-gray-400">{issuer.api_key || '—'}</code>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${issuer.active ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                        {issuer.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {issuer.active && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => setConfirmAction({ type: 'rotate', id: issuer.id, name: issuer.name })}
                            className="text-yellow-400 hover:text-yellow-300 text-sm"
                          >
                            Rotate
                          </button>
                          <button
                            onClick={() => setConfirmAction({ type: 'deactivate', id: issuer.id, name: issuer.name })}
                            className="text-red-400 hover:text-red-300 text-sm"
                          >
                            Deactivate
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
