'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface DidInfo {
  did: string;
  public_key: string;
  verified: boolean;
  created_at: string;
}

export default function ClaimDidPage() {
  const router = useRouter();
  const [didInfo, setDidInfo] = useState<DidInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState('');

  // Link form state
  const [linkDid, setLinkDid] = useState('');
  const [linkPublicKey, setLinkPublicKey] = useState('');
  const [linkSignature, setLinkSignature] = useState('');
  const [showLinkForm, setShowLinkForm] = useState(false);

  useEffect(() => {
    fetchDid();
  }, []);

  async function fetchDid() {
    try {
      const result = await authFetch('/api/reputation/did/me', {}, router);
      if (result && result.response.ok) {
        setDidInfo(result.data);
      }
    } catch {
      // No DID yet
    } finally {
      setLoading(false);
    }
  }

  async function handleClaim() {
    setClaiming(true);
    setError('');
    try {
      const result = await authFetch('/api/reputation/did/claim', { method: 'POST' }, router);
      if (!result) { setError('Authentication required'); return; }
      if (result.response.ok) {
        setDidInfo(result.data);
      } else {
        setError(result.data?.error || 'Failed to claim DID');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to claim DID');
    } finally {
      setClaiming(false);
    }
  }

  async function handleLink(e: React.FormEvent) {
    e.preventDefault();
    setClaiming(true);
    setError('');
    try {
      const result = await authFetch('/api/reputation/did/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          did: linkDid,
          public_key: linkPublicKey,
          signature: linkSignature,
        }),
      }, router);
      if (!result) { setError('Authentication required'); return; }
      if (result.response.ok) {
        setDidInfo(result.data);
      } else {
        setError(result.data?.error || 'Failed to link DID');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to link DID');
    } finally {
      setClaiming(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Claim Your DID</h1>
        <p>Loading...</p>
      </div>
    );
  }

  if (didInfo) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Your DID</h1>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-500">DID</label>
            <p className="font-mono text-sm break-all">{didInfo.did}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">Public Key</label>
            <p className="font-mono text-sm break-all">{didInfo.public_key}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">Verified</label>
            <p>{didInfo.verified ? '✅ Yes' : '❌ No'}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">Created</label>
            <p>{new Date(didInfo.created_at).toLocaleString()}</p>
          </div>
        </div>
        <div className="mt-4">
          <Link href="/reputation" className="text-blue-600 hover:underline">
            ← Back to Reputation
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Claim Your DID</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        A Decentralized Identifier (DID) is your unique identity in the reputation protocol.
        Generate a new one or link an existing DID you control.
      </p>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="space-y-6">
        <div className="border rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-2">Generate New DID</h2>
          <p className="text-sm text-gray-500 mb-3">
            We&apos;ll generate an ed25519 keypair and derive a did:key for you.
          </p>
          <button
            onClick={handleClaim}
            disabled={claiming}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {claiming ? 'Generating...' : 'Generate DID'}
          </button>
        </div>

        <div className="border rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-2">Link Existing DID</h2>
          <p className="text-sm text-gray-500 mb-3">
            Already have a DID? Link it by proving ownership with a signature.
          </p>
          {!showLinkForm ? (
            <button
              onClick={() => setShowLinkForm(true)}
              className="text-blue-600 hover:underline"
            >
              Show link form →
            </button>
          ) : (
            <form onSubmit={handleLink} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">DID</label>
                <input
                  type="text"
                  value={linkDid}
                  onChange={(e) => setLinkDid(e.target.value)}
                  placeholder="did:key:z..."
                  required
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Public Key (base64url)</label>
                <input
                  type="text"
                  value={linkPublicKey}
                  onChange={(e) => setLinkPublicKey(e.target.value)}
                  required
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Signature (base64url)</label>
                <input
                  type="text"
                  value={linkSignature}
                  onChange={(e) => setLinkSignature(e.target.value)}
                  required
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={claiming}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
              >
                {claiming ? 'Linking...' : 'Link DID'}
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="mt-4">
        <Link href="/reputation" className="text-blue-600 hover:underline">
          ← Back to Reputation
        </Link>
      </div>
    </div>
  );
}
