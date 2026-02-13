'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface ReputationWindow {
  task_count: number;
  accepted_count: number;
  disputed_count: number;
  total_volume: number;
  unique_buyers: number;
  avg_task_value: number;
  accepted_rate: number;
  dispute_rate: number;
  categories: Record<string, { count: number; volume: number }>;
}

interface ReputationResult {
  agent_did: string;
  windows: {
    last_30_days: ReputationWindow;
    last_90_days: ReputationWindow;
    all_time: ReputationWindow;
  };
  anti_gaming: {
    flagged: boolean;
    flags: string[];
    adjusted_weight: number;
  };
}

interface DidInfo {
  did: string;
  public_key: string;
  verified: boolean;
  created_at: string;
}

function WindowCard({ label, data }: { label: string; data: ReputationWindow }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">{label}</h3>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-gray-500 dark:text-gray-400">Tasks</span>
          <p className="font-bold text-xl">{data.task_count}</p>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">Accepted Rate</span>
          <p className="font-bold text-xl text-green-600">{(data.accepted_rate * 100).toFixed(1)}%</p>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">Dispute Rate</span>
          <p className="font-bold text-xl text-red-500">{(data.dispute_rate * 100).toFixed(1)}%</p>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">Volume</span>
          <p className="font-bold text-xl">${data.total_volume.toFixed(2)}</p>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">Avg Value</span>
          <p className="font-bold">${data.avg_task_value.toFixed(2)}</p>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">Unique Buyers</span>
          <p className="font-bold">{data.unique_buyers}</p>
        </div>
      </div>
      {Object.keys(data.categories).length > 0 && (
        <div className="mt-4 border-t pt-3">
          <span className="text-gray-500 dark:text-gray-400 text-sm">Categories</span>
          <div className="mt-1 space-y-1">
            {Object.entries(data.categories).map(([cat, info]) => (
              <div key={cat} className="flex justify-between text-sm">
                <span>{cat}</span>
                <span>{info.count} tasks · ${info.volume.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReputationPage() {
  const router = useRouter();
  const [agentDid, setAgentDid] = useState('');
  const [reputation, setReputation] = useState<ReputationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [myDid, setMyDid] = useState<DidInfo | null>(null);
  const [didLoading, setDidLoading] = useState(true);

  // Check if user already has a DID
  useEffect(() => {
    async function checkDid() {
      try {
        const result = await authFetch('/api/reputation/did/me', {}, router);
        if (result && result.response.ok && result.data?.did) {
          setMyDid(result.data);
        }
      } catch {
        // Not logged in or no DID — that's fine
      } finally {
        setDidLoading(false);
      }
    }
    checkDid();
  }, [router]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!agentDid.trim()) return;

    setLoading(true);
    setError('');
    setReputation(null);

    try {
      const res = await fetch(`/api/reputation/agent/${encodeURIComponent(agentDid)}/reputation`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Agent not found or no reputation data');
      } else {
        setReputation(data.reputation);
      }
    } catch {
      setError('Failed to fetch reputation');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Reputation Protocol</h1>
          <p className="text-gray-400 mt-1">Portable, escrow-backed reputation for the open web</p>
        </div>
        <Link
          href="/reputation/submit"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          Submit Receipt
        </Link>
      </div>

      {/* How It Works */}
      <div className="mb-8 p-6 rounded-xl bg-gray-800/50 border border-gray-700">
        <h2 className="text-lg font-bold mb-3">How It Works</h2>
        <div className="grid md:grid-cols-4 gap-4 text-sm">
          <div className="flex gap-3">
            <span className="text-2xl">1️⃣</span>
            <div>
              <p className="font-semibold">Claim a DID</p>
              <p className="text-gray-400">Get a decentralized identifier — your portable identity across platforms.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="text-2xl">2️⃣</span>
            <div>
              <p className="font-semibold">Complete Escrow Jobs</p>
              <p className="text-gray-400">Every settled escrow generates a cryptographic task receipt.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="text-2xl">3️⃣</span>
            <div>
              <p className="font-semibold">Build Reputation</p>
              <p className="text-gray-400">Your score is computed from real on-chain settlements — no fake reviews.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="text-2xl">4️⃣</span>
            <div>
              <p className="font-semibold">Use Anywhere</p>
              <p className="text-gray-400">Share your DID on ugig.net, freelance platforms, or any site that supports CPR.</p>
            </div>
          </div>
        </div>
      </div>

      {/* DID Status Card */}
      {!didLoading && (
        <div className="mb-8 p-6 rounded-xl bg-gradient-to-r from-violet-600/20 to-fuchsia-600/20 border border-violet-500/30">
          {myDid ? (
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h2 className="text-xl font-bold mb-1">🆔 Your DID</h2>
                <p className="font-mono text-sm text-violet-300 break-all">{myDid.did}</p>
                <p className="text-gray-400 text-xs mt-1">
                  Claimed {new Date(myDid.created_at).toLocaleDateString()} · {myDid.verified ? '✅ Verified' : '⏳ Unverified'}
                </p>
              </div>
              <Link
                href="/reputation/did"
                className="bg-violet-600 text-white px-6 py-3 rounded-lg hover:bg-violet-700 transition font-medium"
              >
                Manage DID
              </Link>
            </div>
          ) : (
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h2 className="text-xl font-bold mb-1">🆔 Claim Your Decentralized Identity</h2>
                <p className="text-gray-400 text-sm">
                  A DID is your portable identity. Claim one to start building escrow-backed reputation
                  that you can use on ugig.net, freelance marketplaces, and any platform that supports the
                  CoinPayPortal Reputation Protocol.
                </p>
              </div>
              <Link
                href="/reputation/did"
                className="bg-violet-600 text-white px-6 py-3 rounded-lg hover:bg-violet-700 transition font-medium whitespace-nowrap"
              >
                Claim DID
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Search Reputation */}
      <div className="mb-8">
        <h2 className="text-xl font-bold mb-3">Look Up Reputation</h2>
        <p className="text-gray-400 text-sm mb-4">
          Enter any DID to see their escrow-backed reputation score. Useful for verifying freelancers, contractors, or trading partners.
        </p>
        <form onSubmit={handleSearch}>
          <div className="flex gap-3">
            <input
              type="text"
              value={agentDid}
              onChange={(e) => setAgentDid(e.target.value)}
              placeholder="Enter a DID (e.g., did:key:z6Mk...)"
              className="flex-1 px-4 py-3 border rounded-lg dark:bg-gray-800 dark:border-gray-700 focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </form>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {reputation && (
        <div>
          <h2 className="text-xl font-semibold mb-1">{reputation.agent_did}</h2>
          {reputation.anti_gaming.flagged && (
            <div className="bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-4 py-2 rounded-lg mb-4">
              ⚠️ Anti-gaming flags: {reputation.anti_gaming.flags.join(', ')}
            </div>
          )}

          <div className="grid md:grid-cols-3 gap-6 mt-4">
            <WindowCard label="Last 30 Days" data={reputation.windows.last_30_days} />
            <WindowCard label="Last 90 Days" data={reputation.windows.last_90_days} />
            <WindowCard label="All Time" data={reputation.windows.all_time} />
          </div>
        </div>
      )}
    </div>
  );
}
