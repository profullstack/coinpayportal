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
  const [copied, setCopied] = useState('');

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

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      // fallback
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Your Decentralized Identity</h1>
        <div className="animate-pulse h-32 bg-gray-800 rounded-lg" />
      </div>
    );
  }

  // User already has a DID — show it with helpful context
  if (didInfo) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Link href="/reputation" className="text-violet-400 hover:text-violet-300 text-sm mb-4 inline-block">
          ← Back to Reputation
        </Link>
        <h1 className="text-2xl font-bold mb-6">Your Decentralized Identity</h1>

        {/* DID Card */}
        <div className="bg-gradient-to-r from-violet-600/20 to-fuchsia-600/20 border border-violet-500/30 rounded-xl p-6 mb-6">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-400 block mb-1">Your DID</label>
              <div className="flex items-center gap-2">
                <p className="font-mono text-sm break-all text-white flex-1">{didInfo.did}</p>
                <button
                  onClick={() => copyToClipboard(didInfo.did, 'did')}
                  className="px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white text-xs rounded transition whitespace-nowrap"
                >
                  {copied === 'did' ? '✓ Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-400 block mb-1">Public Key</label>
              <div className="flex items-center gap-2">
                <p className="font-mono text-xs break-all text-gray-300 flex-1">{didInfo.public_key}</p>
                <button
                  onClick={() => copyToClipboard(didInfo.public_key, 'key')}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded transition whitespace-nowrap"
                >
                  {copied === 'key' ? '✓ Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="flex gap-6 text-sm">
              <div>
                <span className="text-gray-400">Status: </span>
                <span className={didInfo.verified ? 'text-green-400' : 'text-yellow-400'}>
                  {didInfo.verified ? '✅ Verified' : '⏳ Unverified'}
                </span>
              </div>
              <div>
                <span className="text-gray-400">Created: </span>
                <span>{new Date(didInfo.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </div>

        {/* What To Do Next */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 mb-6">
          <h2 className="text-lg font-bold mb-4">What To Do With Your DID</h2>
          <div className="space-y-4 text-sm">
            <div className="flex gap-3">
              <span className="text-xl">📋</span>
              <div>
                <p className="font-semibold">Add it to your profiles</p>
                <p className="text-gray-400">
                  Paste your DID on your <a href="https://ugig.net/profile" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline">ugig.net profile</a>, freelance bios,
                  or any platform that supports decentralized identifiers. This lets clients verify your reputation.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="text-xl">🔒</span>
              <div>
                <p className="font-semibold">Complete escrow transactions</p>
                <p className="text-gray-400">
                  Every escrow you settle on CoinPayPortal generates a signed task receipt tied to your DID.
                  These receipts build your on-chain reputation score — no fake reviews possible.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="text-xl">🔍</span>
              <div>
                <p className="font-semibold">Let clients verify you</p>
                <p className="text-gray-400">
                  Anyone can look up your DID on the <Link href="/reputation" className="text-violet-400 hover:underline">Reputation page</Link> to
                  see your verified settlement history, acceptance rate, and dispute record.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="text-xl">🌐</span>
              <div>
                <p className="font-semibold">It&apos;s portable</p>
                <p className="text-gray-400">
                  Your DID and reputation are not locked to CoinPayPortal. Any platform can query your
                  reputation via the open API. Your identity follows you — not the other way around.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* CLI Access */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
          <h2 className="text-lg font-bold mb-3">Access via CLI</h2>
          <p className="text-gray-400 text-sm mb-3">
            You can also manage your DID and reputation from the command line:
          </p>
          <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm space-y-2 text-gray-300">
            <p><span className="text-gray-500">$</span> coinpay reputation did <span className="text-gray-500"># View your DID</span></p>
            <p><span className="text-gray-500">$</span> coinpay reputation query {didInfo.did.substring(0, 20)}... <span className="text-gray-500"># Check score</span></p>
            <p><span className="text-gray-500">$</span> coinpay reputation submit <span className="text-gray-500"># Submit a task receipt</span></p>
          </div>
        </div>
      </div>
    );
  }

  // No DID yet — show claim form with context
  return (
    <div className="max-w-3xl mx-auto p-6">
      <Link href="/reputation" className="text-violet-400 hover:text-violet-300 text-sm mb-4 inline-block">
        ← Back to Reputation
      </Link>
      <h1 className="text-2xl font-bold mb-2">Claim Your Decentralized Identity</h1>
      <p className="text-gray-400 mb-6">
        A Decentralized Identifier (DID) is a unique, self-owned identity that isn&apos;t controlled by any
        single platform. Think of it like a universal username backed by cryptography — you own it, and
        your reputation travels with it.
      </p>

      {/* Why You Need One */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 mb-6">
        <h2 className="text-lg font-bold mb-3">Why Claim a DID?</h2>
        <ul className="space-y-2 text-sm text-gray-300">
          <li className="flex gap-2"><span>✅</span> Build reputation from real escrow settlements — not fake reviews</li>
          <li className="flex gap-2"><span>✅</span> Use the same identity across ugig.net, CoinPayPortal, and any supporting platform</li>
          <li className="flex gap-2"><span>✅</span> Let clients verify your track record before hiring you</li>
          <li className="flex gap-2"><span>✅</span> Your reputation is portable — if a platform shuts down, your history survives</li>
          <li className="flex gap-2"><span>✅</span> Anti-gaming protection: scores are backed by real economic activity</li>
        </ul>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="space-y-6">
        <div className="border border-gray-700 rounded-lg p-5 bg-gray-800/30">
          <h2 className="text-lg font-semibold mb-2">Generate New DID</h2>
          <p className="text-sm text-gray-400 mb-4">
            We&apos;ll generate an ed25519 keypair and create a <code className="text-violet-400">did:key</code> for you.
            Your private key is stored encrypted — only you can sign with it.
          </p>
          <button
            onClick={handleClaim}
            disabled={claiming}
            className="bg-violet-600 text-white px-6 py-3 rounded-lg hover:bg-violet-700 disabled:opacity-50 transition font-medium"
          >
            {claiming ? 'Generating...' : '🆔 Generate My DID'}
          </button>
        </div>

        <div className="border border-gray-700 rounded-lg p-5 bg-gray-800/30">
          <h2 className="text-lg font-semibold mb-2">Link Existing DID</h2>
          <p className="text-sm text-gray-400 mb-3">
            Already have a DID from another platform? Link it by proving ownership with a cryptographic signature.
          </p>
          {!showLinkForm ? (
            <button
              onClick={() => setShowLinkForm(true)}
              className="text-violet-400 hover:text-violet-300 text-sm"
            >
              Show advanced link form →
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
                  className="w-full border border-gray-700 bg-gray-900 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Public Key (base64url)</label>
                <input
                  type="text"
                  value={linkPublicKey}
                  onChange={(e) => setLinkPublicKey(e.target.value)}
                  required
                  className="w-full border border-gray-700 bg-gray-900 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Signature (base64url)</label>
                <input
                  type="text"
                  value={linkSignature}
                  onChange={(e) => setLinkSignature(e.target.value)}
                  required
                  className="w-full border border-gray-700 bg-gray-900 rounded px-3 py-2 text-sm"
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
    </div>
  );
}
