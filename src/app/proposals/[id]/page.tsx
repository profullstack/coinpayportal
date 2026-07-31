'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface Revision {
  id: string;
  revision_number: number;
  proposed_by: 'merchant' | 'client';
  amount: string;
  currency: string;
  crypto_currency: string | null;
  merchant_wallet_address: string | null;
  payee_source: string | null;
  terms: string | null;
  message: string | null;
  due_date: string | null;
  status: string;
  created_at: string;
}

interface ProposalEvent {
  id: string;
  event_type: string;
  actor: string;
  message: string | null;
  created_at: string;
}

interface Proposal {
  id: string;
  proposal_number: string;
  title: string;
  description: string | null;
  status: string;
  current_revision_id: string | null;
  access_token: string;
  expires_at: string | null;
  invoice_id: string | null;
  clients?: { name: string; email: string; company_name: string } | null;
  businesses?: { name: string } | null;
}

function formatAmount(amount: string | number, currency: string) {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

export default function ProposalDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [events, setEvents] = useState<ProposalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [showCounter, setShowCounter] = useState(false);
  const [counter, setCounter] = useState({
    amount: '',
    currency: 'USD',
    crypto_currency: '',
    merchant_wallet_address: '',
    terms: '',
    message: '',
    due_date: '',
  });

  // Filled when accepting a client counter that left the payee unset.
  const [acceptPayee, setAcceptPayee] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const result = await authFetch(`/api/proposals/${id}`, {}, router);
    if (!result) return;
    if (!result.data.success) {
      setError(result.data.error || 'Failed to load proposal');
      setLoading(false);
      return;
    }
    setProposal(result.data.proposal);
    setRevisions(result.data.revisions);
    setEvents(result.data.events);
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = revisions.find((r) => r.id === proposal?.current_revision_id) ?? null;
  const awaitingUs = current?.proposed_by === 'client' && current.status === 'open';
  const isLive = proposal?.status === 'sent' || proposal?.status === 'countered';
  // A client counter that switched coins arrives without a payee; we must supply
  // one before the offer can be accepted.
  const needsPayee = !!current?.crypto_currency && !current.merchant_wallet_address;

  const act = async (path: string, body?: Record<string, unknown>) => {
    setError('');
    setNotice('');
    setBusy(true);
    const result = await authFetch(`/api/proposals/${id}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }, router);
    setBusy(false);

    if (!result) return null;
    if (!result.data.success) {
      setError(result.data.error || 'Action failed');
      return null;
    }
    await load();
    return result.data;
  };

  const handleAccept = async () => {
    if (needsPayee && !acceptPayee.trim()) {
      setError(
        `The client changed the payment coin to ${current?.crypto_currency}. Enter the payee address before accepting.`,
      );
      return;
    }
    const data = await act('accept', acceptPayee.trim() ? { merchant_wallet_address: acceptPayee.trim() } : {});
    if (data) {
      setAcceptPayee('');
      setNotice('Proposal accepted. You can now turn it into an invoice.');
    }
  };

  const handleCounter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (counter.crypto_currency && !counter.merchant_wallet_address.trim()) {
      setError(`Enter the ${counter.crypto_currency} payee address for your counter-offer.`);
      return;
    }
    const data = await act('counter', {
      amount: parseFloat(counter.amount),
      currency: counter.currency,
      crypto_currency: counter.crypto_currency || undefined,
      merchant_wallet_address: counter.merchant_wallet_address.trim() || undefined,
      terms: counter.terms || undefined,
      message: counter.message || undefined,
      due_date: counter.due_date || undefined,
    });
    if (data) {
      setShowCounter(false);
      setNotice('Counter-offer sent.');
    }
  };

  const handleConvert = async () => {
    const data = await act('convert');
    if (data?.invoice?.id) router.push(`/invoices/${data.invoice.id}`);
  };

  const openCounter = () => {
    // Seed the form from the standing offer so a counter is an edit, not a retype.
    setCounter({
      amount: current?.amount ?? '',
      currency: current?.currency ?? 'USD',
      crypto_currency: current?.crypto_currency ?? '',
      merchant_wallet_address: current?.merchant_wallet_address ?? '',
      terms: current?.terms ?? '',
      message: '',
      due_date: current?.due_date?.slice(0, 10) ?? '',
    });
    setShowCounter(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400" />
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="min-h-screen bg-gray-900 py-8 px-4 text-center">
        <p className="text-red-400">{error || 'Proposal not found'}</p>
        <Link href="/proposals" className="mt-4 inline-block text-purple-400 hover:text-purple-300">
          ← Back to Proposals
        </Link>
      </div>
    );
  }

  const respondLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}/proposals/respond/${proposal.access_token}`
      : '';
  const field = 'w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white';

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <Link href="/proposals" className="text-purple-400 hover:text-purple-300 text-sm mb-4 inline-block">
          ← Back to Proposals
        </Link>

        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white">{proposal.title}</h1>
            <p className="mt-1 text-gray-400">
              {proposal.proposal_number} ·{' '}
              {proposal.clients?.company_name || proposal.clients?.name || proposal.clients?.email || 'No client'}
            </p>
          </div>
          <span className="px-3 py-1 text-sm font-medium rounded bg-gray-700 text-gray-200 whitespace-nowrap">
            {proposal.status}
          </span>
        </div>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg">{error}</div>
        )}
        {notice && (
          <div className="mb-6 bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded-lg">{notice}</div>
        )}

        {awaitingUs && (
          <div className="mb-6 bg-amber-500/10 border border-amber-500/30 text-amber-300 px-4 py-3 rounded-lg">
            The client sent a counter-offer. Accept it, counter again, or decline.
          </div>
        )}

        {/* Negotiation thread */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-2xl divide-y divide-gray-700 mb-6">
          {revisions.map((r) => (
            <div key={r.id} className={`p-4 ${r.id === proposal.current_revision_id ? 'bg-gray-800' : ''}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">
                    {r.proposed_by === 'merchant' ? 'You' : 'Client'} proposed
                  </span>
                  <span className="text-xs text-gray-500">v{r.revision_number}</span>
                  {r.status !== 'open' && (
                    <span className="text-xs text-gray-500">· {r.status}</span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-white font-medium">{formatAmount(r.amount, r.currency)}</span>
                  {r.crypto_currency && (
                    <span className="ml-2 text-xs text-gray-400">in {r.crypto_currency}</span>
                  )}
                </div>
              </div>

              {r.message && <p className="mt-2 text-sm text-gray-300 italic">{r.message}</p>}
              {r.terms && <p className="mt-2 text-sm text-gray-400 whitespace-pre-wrap">{r.terms}</p>}

              {r.crypto_currency && (
                <p className="mt-2 text-xs font-mono break-all">
                  {r.merchant_wallet_address ? (
                    <span className="text-gray-500">
                      Payee: {r.merchant_wallet_address}
                      {r.payee_source && <span className="ml-1">({r.payee_source})</span>}
                    </span>
                  ) : (
                    <span className="text-yellow-400">
                      No payee set for {r.crypto_currency} — needed before this can be accepted.
                    </span>
                  )}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-4 space-y-4 mb-6">
          {proposal.status === 'draft' && (
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => act('send')}
                disabled={busy}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg disabled:opacity-50"
              >
                Send to Client
              </button>
              <button
                onClick={openCounter}
                disabled={busy}
                className="px-4 py-2 border border-gray-600 text-gray-200 rounded-lg hover:bg-gray-700"
              >
                Revise Terms
              </button>
            </div>
          )}

          {isLive && (
            <>
              {needsPayee && awaitingUs && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Payee wallet address * <span className="text-gray-500">({current?.crypto_currency})</span>
                  </label>
                  <input
                    type="text"
                    value={acceptPayee}
                    onChange={(e) => setAcceptPayee(e.target.value)}
                    className={`${field} font-mono text-sm`}
                    placeholder={`Where should the ${current?.crypto_currency} be sent?`}
                  />
                  <p className="text-xs text-yellow-400 mt-1">
                    The client proposed a different coin, so no payee could be carried over. Enter one
                    to accept.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                {awaitingUs && (
                  <button
                    onClick={handleAccept}
                    disabled={busy}
                    className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg disabled:opacity-50"
                  >
                    Accept Offer
                  </button>
                )}
                <button
                  onClick={openCounter}
                  disabled={busy}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg disabled:opacity-50"
                >
                  Counter-offer
                </button>
                {awaitingUs && (
                  <button
                    onClick={() => act('reject')}
                    disabled={busy}
                    className="px-4 py-2 border border-red-500/40 text-red-400 rounded-lg hover:bg-red-500/10"
                  >
                    Decline
                  </button>
                )}
                <button
                  onClick={() => act('withdraw')}
                  disabled={busy}
                  className="px-4 py-2 border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700"
                >
                  Withdraw
                </button>
              </div>
            </>
          )}

          {proposal.status === 'accepted' && !proposal.invoice_id && (
            <button
              onClick={handleConvert}
              disabled={busy}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg disabled:opacity-50"
            >
              Create Invoice from Proposal
            </button>
          )}

          {proposal.invoice_id && (
            <Link
              href={`/invoices/${proposal.invoice_id}`}
              className="inline-block px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg"
            >
              View Invoice
            </Link>
          )}

          {isLive && respondLink && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Client response link</p>
              <p className="text-xs font-mono text-gray-400 break-all">{respondLink}</p>
            </div>
          )}
        </div>

        {/* Counter-offer form */}
        {showCounter && (
          <form onSubmit={handleCounter} className="bg-gray-800/50 border border-gray-700 rounded-2xl p-6 space-y-4 mb-6">
            <h2 className="text-lg font-semibold text-white">Your counter-offer</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Amount *</label>
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
                <label className="block text-sm font-medium text-gray-300 mb-2">Currency</label>
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
              <label className="block text-sm font-medium text-gray-300 mb-2">Paid in</label>
              <input
                type="text"
                value={counter.crypto_currency}
                onChange={(e) => setCounter({ ...counter, crypto_currency: e.target.value.toUpperCase() })}
                className={field}
                placeholder="e.g., BTC"
              />
            </div>

            {counter.crypto_currency && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Payee wallet address * <span className="text-gray-500">({counter.crypto_currency})</span>
                </label>
                <input
                  type="text"
                  required
                  value={counter.merchant_wallet_address}
                  onChange={(e) => setCounter({ ...counter, merchant_wallet_address: e.target.value })}
                  className={`${field} font-mono text-sm`}
                  placeholder={`Where should the ${counter.crypto_currency} be sent?`}
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Terms</label>
              <textarea
                value={counter.terms}
                onChange={(e) => setCounter({ ...counter, terms: e.target.value })}
                className={field}
                rows={4}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Message</label>
              <textarea
                value={counter.message}
                onChange={(e) => setCounter({ ...counter, message: e.target.value })}
                className={field}
                rows={2}
                placeholder="Explain what changed"
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCounter(false)}
                className="px-4 py-2 text-gray-400 hover:text-white"
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

        {/* History */}
        {events.length > 0 && (
          <div className="bg-gray-800/30 border border-gray-700 rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">History</h2>
            <ul className="space-y-1 text-xs text-gray-500">
              {events.map((e) => (
                <li key={e.id}>
                  {new Date(e.created_at).toLocaleString()} — {e.actor} {e.event_type}
                  {e.message ? `: ${e.message}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
