'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';


interface Passkey {
  id: string;
  name: string;
  device_type: string | null;
  transports: string[] | null;
  created_at: string;
  last_used_at: string | null;
}

export default function SecuritySettingsPage() {
  const router = useRouter();
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchPasskeys();
  }, []);

  const fetchPasskeys = async () => {
    try {
      const result = await authFetch('/api/auth/webauthn/credentials', {}, router);
      if (!result) return;

      const { response, data } = result;
      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to fetch passkeys');
        return;
      }

      setPasskeys(data.credentials);
    } catch {
      setError('Failed to load passkeys');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setError('');
    setSuccess('');
    setRegistering(true);

    try {
      // 1. Get registration options
      const optResult = await authFetch('/api/auth/webauthn/register-options', {}, router);
      if (!optResult) return;

      if (!optResult.response.ok || !optResult.data.success) {
        setError(optResult.data.error || 'Failed to get registration options');
        setRegistering(false);
        return;
      }

      // 2. Start WebAuthn registration (browser prompt)
      const { startRegistration } = await import('@simplewebauthn/browser');
      const credential = await startRegistration({ optionsJSON: optResult.data.options });

      // 3. Verify with server
      const verifyResult = await authFetch('/api/auth/webauthn/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      }, router);

      if (!verifyResult) return;

      if (!verifyResult.response.ok || !verifyResult.data.success) {
        setError(verifyResult.data.error || 'Registration failed');
        setRegistering(false);
        return;
      }

      setSuccess('Passkey registered successfully!');
      setTimeout(() => setSuccess(''), 3000);
      fetchPasskeys();
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Registration was cancelled or timed out.');
      } else {
        setError(err.message || 'Failed to register passkey');
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;

    try {
      const result = await authFetch('/api/auth/webauthn/credentials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: editName.trim() }),
      }, router);

      if (!result) return;

      if (result.response.ok && result.data.success) {
        setPasskeys((prev) =>
          prev.map((p) => (p.id === id ? { ...p, name: editName.trim() } : p))
        );
      }
    } catch {
      setError('Failed to rename passkey');
    } finally {
      setEditingId(null);
      setEditName('');
    }
  };

  const handleDelete = async (passkey: Passkey) => {
    if (!confirm(`Delete passkey "${passkey.name}"? This cannot be undone.`)) return;

    setDeletingId(passkey.id);
    try {
      const result = await authFetch(`/api/auth/webauthn/credentials?id=${passkey.id}`, {
        method: 'DELETE',
      }, router);

      if (!result) return;

      if (result.response.ok && result.data.success) {
        setPasskeys((prev) => prev.filter((p) => p.id !== passkey.id));
      } else {
        setError('Failed to delete passkey');
      }
    } catch {
      setError('Failed to delete passkey');
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          <p className="mt-2 text-gray-600 dark:text-gray-300">Loading security settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/settings"
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400"
          >
            ← Back to Settings
          </Link>
          <h1 className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">Security</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-300">
            Manage your passkeys and security settings
          </p>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
            {error}
            <button onClick={() => setError('')} className="ml-2 font-bold">×</button>
          </div>
        )}

        {success && (
          <div className="mb-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-lg">
            {success}
          </div>
        )}

        {/* Passkeys Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Passkeys</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Sign in faster and more securely with passkeys (WebAuthn)
                </p>
              </div>
              <button
                onClick={handleRegister}
                disabled={registering}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {registering ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Registering...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Passkey
                  </>
                )}
              </button>
            </div>
          </div>

          {passkeys.length === 0 ? (
            <div className="p-8 text-center">
              <svg className="mx-auto h-16 w-16 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">No passkeys registered</h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                Passkeys let you sign in with your fingerprint, face, or device PIN instead of a password.
                They&apos;re more secure and easier to use.
              </p>
              <button
                onClick={handleRegister}
                disabled={registering}
                className="mt-6 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-500 disabled:opacity-50 transition-colors"
              >
                Add Your First Passkey
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {passkeys.map((passkey) => (
                <div key={passkey.id} className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="flex-shrink-0 p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                      <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      {editingId === passkey.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename(passkey.id);
                              if (e.key === 'Escape') { setEditingId(null); setEditName(''); }
                            }}
                            className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500"
                            autoFocus
                          />
                          <button
                            onClick={() => handleRename(passkey.id)}
                            className="text-xs text-purple-600 hover:text-purple-700 font-medium"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setEditingId(null); setEditName(''); }}
                            className="text-xs text-gray-500 hover:text-gray-700"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {passkey.name}
                          </span>
                          <button
                            onClick={() => { setEditingId(passkey.id); setEditName(passkey.name); }}
                            className="text-gray-400 hover:text-purple-600 transition-colors"
                            title="Rename"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-4 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {passkey.device_type && (
                          <span>{passkey.device_type === 'platform' ? '🔒 Platform' : '🔑 Roaming'}</span>
                        )}
                        <span>Created {formatDate(passkey.created_at)}</span>
                        <span>Last used {formatDate(passkey.last_used_at)}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(passkey)}
                    disabled={deletingId === passkey.id}
                    className="ml-4 p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                    title="Delete"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">About Passkeys</h3>
          <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
            <li>• Passkeys use biometrics (fingerprint, face) or your device PIN</li>
            <li>• They&apos;re phishing-resistant and more secure than passwords</li>
            <li>• Each passkey is bound to this site and your device</li>
            <li>• You can register multiple passkeys for different devices</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
