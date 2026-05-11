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
  did_kind?: 'human' | 'agent' | 'service';
  lifetime?: 'persistent' | 'ephemeral';
  label?: string | null;
}

interface Delegation {
  id: string;
  agent_did: string;
  issued_at: string;
  expires_at: string | null;
  revoked: boolean;
  data: {
    principal_did: string;
    agent_did: string;
    scope: string[];
    label?: string | null;
    expires_at: string | null;
  };
}

const DELEGATION_SCOPES = [
  'reputation:read',
  'reputation:submit_receipt',
  'escrow:create',
  'escrow:settle',
  'invoice:create',
  'wallet:read',
  'wallet:transfer',
];

interface Credential {
  id: string;
  type: string;
  subject_did: string;
  issuer_did: string;
  claims: Record<string, unknown>;
  created_at: string;
  revoked: boolean;
}

interface TaskReceipt {
  id: string;
  agent_did: string;
  buyer_did: string;
  task_type: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  description?: string;
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
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [receipts, setReceipts] = useState<TaskReceipt[]>([]);
  const [credLoading, setCredLoading] = useState(false);
  const [receiptsLoading, setReceiptsLoading] = useState(false);

  // Delegation state
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [delegationsLoading, setDelegationsLoading] = useState(false);
  const [showDelegateForm, setShowDelegateForm] = useState(false);
  const [delegateAgentDid, setDelegateAgentDid] = useState('');
  const [delegateLabel, setDelegateLabel] = useState('');
  const [delegateScopes, setDelegateScopes] = useState<string[]>(['reputation:read']);
  const [delegateExpires, setDelegateExpires] = useState('');
  const [delegateBusy, setDelegateBusy] = useState(false);
  const [delegateError, setDelegateError] = useState('');

  useEffect(() => {
    fetchDid();
  }, []);

  async function fetchDid() {
    try {
      const result = await authFetch('/api/reputation/did/me', {}, router);
      if (result && result.response.ok) {
        setDidInfo(result.data);
        fetchCredentials(result.data.did);
        fetchReceipts(result.data.did);
        fetchDelegations();
      }
    } catch {
      // No DID yet
    } finally {
      setLoading(false);
    }
  }

  async function fetchDelegations() {
    setDelegationsLoading(true);
    try {
      const result = await authFetch('/api/reputation/did/delegate', {}, router);
      if (result && result.response.ok) {
        setDelegations(result.data.delegations || []);
      }
    } catch { /* noop */ }
    finally { setDelegationsLoading(false); }
  }

  async function handleDelegate(e: React.FormEvent) {
    e.preventDefault();
    setDelegateError('');
    setDelegateBusy(true);
    try {
      const result = await authFetch('/api/reputation/did/delegate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_did: delegateAgentDid.trim(),
          scope: delegateScopes,
          expires_at: delegateExpires ? new Date(delegateExpires).toISOString() : undefined,
          label: delegateLabel.trim() || undefined,
        }),
      }, router);
      if (!result) { setDelegateError('Authentication required'); return; }
      if (result.response.ok) {
        setDelegateAgentDid('');
        setDelegateLabel('');
        setDelegateExpires('');
        setDelegateScopes(['reputation:read']);
        setShowDelegateForm(false);
        fetchDelegations();
      } else {
        setDelegateError(result.data?.error || 'Failed to issue delegation');
      }
    } catch (err: any) {
      setDelegateError(err?.message || 'Failed to issue delegation');
    } finally {
      setDelegateBusy(false);
    }
  }

  async function handleRevokeDelegation(id: string) {
    if (!confirm('Revoke this delegation? The agent will lose authority immediately.')) return;
    const result = await authFetch(`/api/reputation/did/delegate?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }, router);
    if (result?.response.ok) fetchDelegations();
  }

  function toggleScope(scope: string) {
    setDelegateScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  }

  async function fetchCredentials(did: string) {
    setCredLoading(true);
    try {
      const res = await fetch(`/api/reputation/credentials?did=${encodeURIComponent(did)}`);
      const data = await res.json();
      if (data.success) setCredentials(data.credentials);
    } catch { /* noop */ }
    finally { setCredLoading(false); }
  }

  async function fetchReceipts(did: string) {
    setReceiptsLoading(true);
    try {
      const res = await fetch(`/api/reputation/receipts?did=${encodeURIComponent(did)}`);
      const data = await res.json();
      if (data.success) setReceipts(data.receipts);
    } catch { /* noop */ }
    finally { setReceiptsLoading(false); }
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
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2 py-1 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">
                {didInfo.did_kind === 'agent' ? 'Agent' : didInfo.did_kind === 'service' ? 'Service' : 'Principal'}
              </span>
              <span className="px-2 py-1 rounded bg-gray-700/60 text-gray-300 border border-gray-600">
                {didInfo.lifetime === 'ephemeral' ? 'Ephemeral' : 'Persistent'}
              </span>
              <span className={`px-2 py-1 rounded border ${didInfo.verified ? 'bg-green-500/20 text-green-300 border-green-500/30' : 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'}`}>
                {didInfo.verified ? '✅ Verified' : '⏳ Unverified'}
              </span>
              <span className="px-2 py-1 rounded bg-gray-700/40 text-gray-400 border border-gray-700">
                Created {new Date(didInfo.created_at).toLocaleDateString()}
              </span>
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

        {/* Credentials */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 mb-6">
          <h2 className="text-lg font-bold mb-4">📜 Your Credentials</h2>
          {credLoading ? (
            <div className="animate-pulse h-16 bg-gray-700 rounded" />
          ) : credentials.length === 0 ? (
            <p className="text-gray-400 text-sm">No credentials issued yet. Complete escrow tasks to earn verifiable credentials.</p>
          ) : (
            <div className="space-y-3">
              {credentials.map((cred) => (
                <Link
                  key={cred.id}
                  href={`/reputation/credential/${cred.id}`}
                  className="block border border-gray-700 rounded-lg p-4 hover:border-violet-500/50 transition"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold text-sm">{cred.type}</p>
                      <p className="text-gray-400 text-xs font-mono mt-1">Issuer: {cred.issuer_did.substring(0, 30)}...</p>
                    </div>
                    <div className="text-right text-xs">
                      <span className={cred.revoked ? 'text-red-400' : 'text-green-400'}>
                        {cred.revoked ? '❌ Revoked' : '✅ Active'}
                      </span>
                      <p className="text-gray-500 mt-1">{new Date(cred.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Delegated Authority */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 mb-6">
          <div className="flex justify-between items-start mb-3">
            <div>
              <h2 className="text-lg font-bold">🤝 Delegated Authority</h2>
              <p className="text-gray-400 text-xs mt-1">
                Authorize AI agents or services to act on your behalf with scoped, revocable, signed credentials.
              </p>
            </div>
            <button
              onClick={() => setShowDelegateForm((s) => !s)}
              className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs rounded transition whitespace-nowrap"
            >
              {showDelegateForm ? 'Cancel' : '+ Delegate'}
            </button>
          </div>

          {showDelegateForm && (
            <form onSubmit={handleDelegate} className="space-y-3 mb-4 border border-violet-500/30 bg-violet-500/5 rounded-lg p-4">
              {delegateError && (
                <div className="text-red-400 text-xs">{delegateError}</div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Agent DID</label>
                <input
                  type="text"
                  value={delegateAgentDid}
                  onChange={(e) => setDelegateAgentDid(e.target.value)}
                  placeholder="did:key:z..."
                  required
                  className="w-full border border-gray-700 bg-gray-900 rounded px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Label (optional)</label>
                <input
                  type="text"
                  value={delegateLabel}
                  onChange={(e) => setDelegateLabel(e.target.value)}
                  placeholder="e.g. Pricing Bot, Refund Agent"
                  className="w-full border border-gray-700 bg-gray-900 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-2">Scopes</label>
                <div className="grid grid-cols-2 gap-2">
                  {DELEGATION_SCOPES.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={delegateScopes.includes(s)}
                        onChange={() => toggleScope(s)}
                        className="rounded"
                      />
                      <code className="text-violet-300">{s}</code>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Expires (optional)</label>
                <input
                  type="datetime-local"
                  value={delegateExpires}
                  onChange={(e) => setDelegateExpires(e.target.value)}
                  className="border border-gray-700 bg-gray-900 rounded px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={delegateBusy || delegateScopes.length === 0}
                className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium"
              >
                {delegateBusy ? 'Issuing...' : 'Issue Delegation Credential'}
              </button>
            </form>
          )}

          {delegationsLoading ? (
            <div className="animate-pulse h-16 bg-gray-700 rounded" />
          ) : delegations.length === 0 ? (
            <p className="text-gray-400 text-sm">No delegations issued. Use this to let an AI agent submit receipts, settle escrow, or read reputation on your behalf — without sharing your private key.</p>
          ) : (
            <div className="space-y-2">
              {delegations.map((d) => {
                const expired = d.expires_at && new Date(d.expires_at).getTime() < Date.now();
                return (
                  <div key={d.id} className="border border-gray-700 rounded-lg p-3 bg-gray-900/40">
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-white">
                            {d.data.label || 'Unlabeled agent'}
                          </span>
                          {d.revoked && <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-300">Revoked</span>}
                          {!d.revoked && expired && <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300">Expired</span>}
                          {!d.revoked && !expired && <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">Active</span>}
                        </div>
                        <p className="font-mono text-xs text-gray-400 mt-1 break-all">{d.agent_did}</p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {d.data.scope.map((s) => (
                            <code key={s} className="text-[10px] px-1.5 py-0.5 bg-gray-800 rounded text-violet-300">{s}</code>
                          ))}
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          Issued {new Date(d.issued_at).toLocaleDateString()}
                          {d.expires_at && <> · Expires {new Date(d.expires_at).toLocaleDateString()}</>}
                        </p>
                      </div>
                      {!d.revoked && (
                        <button
                          onClick={() => handleRevokeDelegation(d.id)}
                          className="text-xs text-red-400 hover:text-red-300 whitespace-nowrap"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Task Receipt History */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 mb-6">
          <h2 className="text-lg font-bold mb-4">🧾 Task Receipt History</h2>
          {receiptsLoading ? (
            <div className="animate-pulse h-16 bg-gray-700 rounded" />
          ) : receipts.length === 0 ? (
            <p className="text-gray-400 text-sm">No task receipts yet. Submit receipts from completed escrow transactions to build your reputation.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-left border-b border-gray-700">
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2 pr-4">Amount</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((receipt) => (
                    <tr key={receipt.id} className="border-b border-gray-800">
                      <td className="py-2 pr-4">{receipt.task_type || 'Task'}</td>
                      <td className="py-2 pr-4">${receipt.amount?.toFixed(2) || '0.00'} {receipt.currency || ''}</td>
                      <td className="py-2 pr-4">
                        <span className={
                          receipt.status === 'accepted' ? 'text-green-400' :
                          receipt.status === 'disputed' ? 'text-red-400' :
                          'text-yellow-400'
                        }>
                          {receipt.status}
                        </span>
                      </td>
                      <td className="py-2 text-gray-400">{new Date(receipt.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
