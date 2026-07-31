'use client';

/**
 * Client-facing proposal page. No CoinPay account required — the link's token is
 * the credential, so this page never asks anyone to sign in.
 *
 * The client can accept, decline, or counter. They cannot set the payee: where
 * the business gets paid is the business's decision, so a counter that changes
 * the coin simply leaves that for them to fill in.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface Revision {
  id: string;
  revision_number: number;
  proposed_by: 'merchant' | 'client';
  amount: string;
  currency: string;
  crypto_currency: string | null;
  merchant_wallet_address: string | null;
  terms: string | null;
  message: string | null;
  due_date: string | null;
  status: string;
  created_at: string;
}

interface PublicProposal {
  proposal_number: string;
  title: string;
  description: string | null;
  status: string;
  business_name: string | null;
  client_name: string | null;
  expires_at: string | null;
  current_revision_id: string | null;
  revisions: Revision[];
}

function formatAmount(amount: string | number, currency: string) {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

export default function RespondToProposalPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [proposal, setProposal] = useState<PublicProposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [showCounter, setShowCounter] = useState(false);
  const [counter, setCounter] = useState({
    amount: '',
    currency: 'USD',
    crypto_currency: '',
    terms: '',
    message: '',
  });

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`/api/proposals/respond/${token}`);
      const body = await response.json();
      if (!response.ok || !body.success) {
        setError(body.error || 'This proposal link is no longer valid.');
      } else {
        setProposal(body.proposal);
      }
    } catch {
      setError('Failed to load this proposal.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const respond = async (payload: Record<string, unknown>) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const response = await fetch(`/api/proposals/respond/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        setError(body.error || 'Could not record your response.');
        return false;
      }
      await load();
      return true;
    } catch {
      setError('Could not record your response.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const current = proposal?.revisions.find((r) => r.id === proposal.current_revision_id) ?? null;
  const awaitingClient = current?.proposed_by === 'merchant' && current.status === 'open';
  const isLive = proposal?.status === 'sent' || proposal?.status === 'countered';

  const handleCounter = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await respond({
      action: 'counter',
      amount: parseFloat(counter.amount),
      currency: counter.currency,
      crypto_currency: counter.crypto_currency || undefined,
      terms: counter.terms || undefined,
      message: counter.message || undefined,
    });
    if (ok) {
      setShowCounter(false);
      setNotice('Your counter-offer was sent.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600" />
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Proposal unavailable</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">{error}</p>
        </div>
      </div>
    );
  }

  const field =
    'w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <p className="text-sm text-gray-500 dark:text-gray-400">{proposal.proposal_number}</p>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{proposal.title}</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-300">
            From {proposal.business_name ?? 'a CoinPay business'}
          </p>
          {proposal.description && (
            <p className="mt-4 text-gray-700 dark:text-gray-300">{proposal.description}</p>
          )}
        </div>

        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-lg">
            {notice}
          </div>
        )}

        {!isLive && (
          <div className="mb-6 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 px-4 py-3 rounded-lg">
            This proposal is {proposal.status}. No further response is needed.
          </div>
        )}

        {/* The back-and-forth so far */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow divide-y divide-gray-200 dark:divide-gray-700 mb-6">
          {proposal.revisions.map((r) => (
            <div
              key={r.id}
              className={`p-4 ${r.id === proposal.current_revision_id ? 'bg-purple-50 dark:bg-purple-900/10' : ''}`}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {r.proposed_by === 'client' ? 'You proposed' : `${proposal.business_name ?? 'They'} proposed`}
                </span>
                <span className="text-gray-900 dark:text-white font-medium">
                  {formatAmount(r.amount, r.currency)}
                  {r.crypto_currency && (
                    <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                      in {r.crypto_currency}
                    </span>
                  )}
                </span>
              </div>
              {r.message && (
                <p className="mt-2 text-sm italic text-gray-600 dark:text-gray-300">{r.message}</p>
              )}
              {r.terms && (
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{r.terms}</p>
              )}
              {r.merchant_wallet_address && (
                <p className="mt-2 text-xs font-mono text-gray-500 dark:text-gray-500 break-all">
                  Funds would go to: {r.merchant_wallet_address}
                </p>
              )}
            </div>
          ))}
        </div>

        {isLive && awaitingClient && !showCounter && (
          <div className="flex flex-wrap gap-3">
            <button
              onClick={async () => {
                if (await respond({ action: 'accept' })) setNotice('You accepted this proposal.');
              }}
              disabled={busy}
              className="px-5 py-2 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg disabled:opacity-50"
            >
              Accept
            </button>
            <button
              onClick={() => {
                setCounter({
                  amount: current?.amount ?? '',
                  currency: current?.currency ?? 'USD',
                  crypto_currency: current?.crypto_currency ?? '',
                  terms: current?.terms ?? '',
                  message: '',
                });
                setShowCounter(true);
              }}
              disabled={busy}
              className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg disabled:opacity-50"
            >
              Counter-offer
            </button>
            <button
              onClick={async () => {
                if (await respond({ action: 'reject' })) setNotice('You declined this proposal.');
              }}
              disabled={busy}
              className="px-5 py-2 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              Decline
            </button>
          </div>
        )}

        {isLive && !awaitingClient && !showCounter && (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Your counter-offer is with {proposal.business_name ?? 'the business'}. You will be
            notified when they respond.
          </p>
        )}

        {showCounter && (
          <form onSubmit={handleCounter} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Your counter-offer</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Amount *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={counter.amount}
                  onChange={(e) => setCounter({ ...counter, amount: e.target.value })}
                  className={field}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Currency
                </label>
                <select
                  value={counter.currency}
                  onChange={(e) => setCounter({ ...counter, currency: e.target.value })}
                  className={field}
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Pay in (optional)
              </label>
              <input
                type="text"
                value={counter.crypto_currency}
                onChange={(e) => setCounter({ ...counter, crypto_currency: e.target.value.toUpperCase() })}
                className={field}
                placeholder="e.g., BTC"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                If you ask for a different coin, the business will confirm their receiving address
                before accepting.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Terms
              </label>
              <textarea
                value={counter.terms}
                onChange={(e) => setCounter({ ...counter, terms: e.target.value })}
                className={field}
                rows={4}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Message
              </label>
              <textarea
                value={counter.message}
                onChange={(e) => setCounter({ ...counter, message: e.target.value })}
                className={field}
                rows={2}
                placeholder="Explain what you would like changed"
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCounter(false)}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg disabled:opacity-50"
              >
                Send Counter-offer
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
