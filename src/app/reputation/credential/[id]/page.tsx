'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Credential {
  id: string;
  agent_did: string;
  credential_type: string;
  category?: string;
  data: Record<string, unknown>;
  window_start: string;
  window_end: string;
  issued_at: string;
  signature: string;
  revoked: boolean;
  revoked_at?: string;
}

export default function CredentialDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [credential, setCredential] = useState<Credential | null>(null);
  const [verification, setVerification] = useState<{ valid: boolean; reason?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const [credRes, verifyRes] = await Promise.all([
          fetch(`/api/reputation/credential/${id}`),
          fetch('/api/reputation/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential_id: id }),
          }),
        ]);

        const credData = await credRes.json();
        const verifyData = await verifyRes.json();

        if (credData.success && credData.credential) {
          setCredential(credData.credential);
        } else {
          setError('Credential not found');
        }

        setVerification(verifyData);
      } catch {
        setError('Failed to load credential');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (error || !credential) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link href="/reputation" className="text-blue-600 hover:underline">← Reputation</Link>
        <div className="mt-4 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg">
          {error || 'Credential not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/reputation" className="text-blue-600 hover:underline">← Reputation</Link>

      <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Credential</h1>
          {verification && (
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              verification.valid
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
            }`}>
              {verification.valid ? '✓ Valid' : `✗ ${verification.reason || 'Invalid'}`}
            </span>
          )}
        </div>

        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">ID</dt>
            <dd className="font-mono">{credential.id}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Agent</dt>
            <dd>
              <Link href={`/reputation?did=${encodeURIComponent(credential.agent_did)}`}
                className="text-blue-600 hover:underline">
                {credential.agent_did}
              </Link>
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Type</dt>
            <dd>{credential.credential_type}</dd>
          </div>
          {credential.category && (
            <div className="flex justify-between">
              <dt className="text-gray-500">Category</dt>
              <dd>{credential.category}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-gray-500">Window</dt>
            <dd>{new Date(credential.window_start).toLocaleDateString()} — {new Date(credential.window_end).toLocaleDateString()}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Issued</dt>
            <dd>{new Date(credential.issued_at).toLocaleString()}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Revoked</dt>
            <dd>{credential.revoked ? `Yes (${new Date(credential.revoked_at!).toLocaleString()})` : 'No'}</dd>
          </div>
        </dl>

        {credential.data && Object.keys(credential.data).length > 0 && (
          <div className="mt-6 border-t pt-4">
            <h3 className="text-sm font-semibold text-gray-500 mb-2">Credential Data</h3>
            <pre className="bg-gray-100 dark:bg-gray-900 p-3 rounded text-xs overflow-x-auto">
              {JSON.stringify(credential.data, null, 2)}
            </pre>
          </div>
        )}

        <div className="mt-4 border-t pt-4">
          <h3 className="text-sm font-semibold text-gray-500 mb-2">Signature</h3>
          <code className="text-xs break-all">{credential.signature}</code>
        </div>
      </div>
    </div>
  );
}
