'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * The /usd-account page: request a named US account, finish KYC on the
 * partner's page, then see the routing and account number and the deposits
 * the partner has reported.
 *
 * Nothing here shows a balance, because there is none: the partner holds the
 * account in the user's name and sends converted USDC to the user's wallet.
 */

type Status = {
  available: boolean;
  provider?: { id: string; label: string; supportedCountries: string[]; supportedChains: string[] } | null;
  holder?: { status: 'pending' | 'needs_action' | 'verified' | 'rejected'; country: string; onboardingUrl: string | null; rejectionReason: string | null } | null;
  account?: {
    status: 'requested' | 'pending' | 'open' | 'closed' | 'failed';
    bankName: string | null;
    routingNumber: string | null;
    accountNumber: string | null;
    accountLast4: string | null;
    rails: string[];
    destination: { asset: string; chain: string; address: string };
    openedAt: string | null;
    error: string | null;
  } | null;
  deposits?: Array<{
    depositId: string;
    status: 'received' | 'converted' | 'delivered' | 'returned';
    amountMinor: number | null;
    currency: string | null;
    rail: string | null;
    txHash: string | null;
    returnCode: string | null;
    updatedAt: string;
  }>;
};

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = { ...(extra as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function money(minor: number | null, currency: string | null): string {
  if (minor === null) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(minor / 100);
}

const DEPOSIT_LABEL: Record<string, string> = {
  received: 'Received',
  converted: 'Converted to USDC',
  delivered: 'Delivered to wallet',
  returned: 'Returned to sender',
};

function Explainer() {
  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-6 text-gray-300 space-y-3">
      <h2 className="text-lg font-semibold text-white">What it is</h2>
      <p>
        A US bank account in your own name, with a routing number and account number you can give to any US client or
        platform. It works from Nigeria, Kenya, the Philippines, India, the EU and many other countries.
      </p>
      <ul className="list-disc pl-5 space-y-1 text-sm">
        <li>Get paid by ACH, wire, RTP or FedNow like a US resident.</li>
        <li>Each deposit is converted to USDC and sent straight to a wallet address you choose.</li>
        <li>
          The account is opened and held by a licensed partner, who also runs identity checks. CoinPay never holds your
          money.
        </li>
        <li>Want local currency? Send the USDC on through CoinPay remittance to your bank or mobile wallet.</li>
      </ul>
    </section>
  );
}

export default function UsdAccountContent({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(true);

  const [country, setCountry] = useState('');
  const [chain, setChain] = useState('base');
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    setError(null);
    try {
      const res = await fetch('/api/usd-accounts', { headers: authHeaders(), credentials: 'same-origin' });
      if (res.status === 401) {
        setSignedIn(false);
        return;
      }
      if (!res.ok) {
        setError('Failed to load your US account.');
        return;
      }
      setStatus(await res.json());
    } catch {
      setError('Failed to load your US account.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  async function request(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/usd-accounts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ country, destination: { asset: 'USDC', chain, address } }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Request failed.');
        return;
      }
      setStatus(body);
    } catch {
      setError('Request failed.');
    } finally {
      setSubmitting(false);
    }
  }

  const available = enabled && status?.available !== false;
  const holder = status?.holder ?? null;
  const account = status?.account ?? null;

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Get a US account</h1>
        <p className="text-gray-400 mt-1">Receive US dollars from anywhere, delivered to your wallet as USDC.</p>
      </div>

      {!available && (
        <>
          <div className="rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            Coming soon. Global USD accounts are not open on CoinPay yet.
          </div>
          <Explainer />
        </>
      )}

      {available && !signedIn && (
        <>
          <Explainer />
          <p className="text-gray-300">
            <Link href="/login?redirect=/usd-account" className="text-purple-400 hover:underline">
              Log in
            </Link>{' '}
            to request your account.
          </p>
        </>
      )}

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {available && signedIn && loading && <p className="text-gray-400">Loading...</p>}

      {available && signedIn && !loading && status && (
        <>
          {!holder && (
            <>
              <Explainer />
              <form onSubmit={request} className="rounded-lg border border-slate-700 bg-slate-900/50 p-6 space-y-4">
                <h2 className="text-lg font-semibold text-white">Request your account</h2>
                <label className="block text-sm text-gray-300">
                  Country you live in
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    required
                    className="mt-1 block w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 text-white"
                  >
                    <option value="">Choose...</option>
                    {(status.provider?.supportedCountries ?? []).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-gray-300">
                  USDC network
                  <select
                    value={chain}
                    onChange={(e) => setChain(e.target.value)}
                    className="mt-1 block w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 text-white"
                  >
                    {(status.provider?.supportedChains ?? []).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-gray-300">
                  Your wallet address (where USDC is delivered)
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    required
                    spellCheck={false}
                    className="mt-1 block w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 font-mono text-white"
                  />
                </label>
                <p className="text-xs text-gray-400">
                  Double-check the address and network. USDC sent to a wrong address cannot be recovered.
                </p>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded bg-purple-600 px-4 py-2 text-white hover:bg-purple-500 disabled:opacity-50"
                >
                  {submitting ? 'Requesting...' : 'Request account'}
                </button>
              </form>
            </>
          )}

          {holder && holder.status !== 'verified' && (
            <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-6 space-y-3">
              <h2 className="text-lg font-semibold text-white">Identity check</h2>
              {holder.status === 'rejected' ? (
                <p className="text-red-300">
                  {status.provider?.label ?? 'The partner'} could not approve this application.
                  {holder.rejectionReason ? ` ${holder.rejectionReason}` : ''}
                </p>
              ) : holder.onboardingUrl ? (
                <>
                  <p className="text-gray-300">
                    Finish your identity check with {status.provider?.label ?? 'our partner'}. It opens the account in your
                    name.
                  </p>
                  <a
                    href={holder.onboardingUrl}
                    rel="noopener noreferrer"
                    className="inline-block rounded bg-purple-600 px-4 py-2 text-white hover:bg-purple-500"
                  >
                    Continue identity check
                  </a>
                </>
              ) : (
                <p className="text-gray-300">Your details are being reviewed. This page updates when it is done.</p>
              )}
            </section>
          )}

          {account && (
            <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-6 space-y-3">
              <h2 className="text-lg font-semibold text-white">Your US account</h2>
              {account.status === 'open' ? (
                <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
                  <dt className="text-gray-400">Bank</dt>
                  <dd className="text-white">{account.bankName ?? ''}</dd>
                  <dt className="text-gray-400">Routing number</dt>
                  <dd className="text-white font-mono">{account.routingNumber ?? ''}</dd>
                  <dt className="text-gray-400">Account number</dt>
                  <dd className="text-white font-mono">
                    {account.accountNumber ?? (account.accountLast4 ? `ending ${account.accountLast4}` : '')}
                  </dd>
                  <dt className="text-gray-400">Accepts</dt>
                  <dd className="text-white">{account.rails.map((r) => r.toUpperCase()).join(', ')}</dd>
                  <dt className="text-gray-400">Delivers to</dt>
                  <dd className="text-white font-mono break-all">
                    {account.destination.asset} on {account.destination.chain}: {account.destination.address}
                  </dd>
                </dl>
              ) : account.status === 'failed' ? (
                <p className="text-red-300">The account could not be opened. {account.error ?? ''}</p>
              ) : account.status === 'closed' ? (
                <p className="text-gray-300">This account is closed.</p>
              ) : (
                <p className="text-gray-300">
                  Your account opens once the identity check is approved. Deposits will go to{' '}
                  <span className="font-mono break-all">{account.destination.address}</span> on {account.destination.chain}.
                </p>
              )}
            </section>
          )}

          {account?.status === 'open' && (
            <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
              <h2 className="text-lg font-semibold text-white mb-3">Recent deposits</h2>
              {(status.deposits ?? []).length === 0 ? (
                <p className="text-sm text-gray-400">No deposits yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-gray-400">
                    <tr>
                      <th className="py-2 pr-4">Date</th>
                      <th className="py-2 pr-4">Amount</th>
                      <th className="py-2 pr-4">Rail</th>
                      <th className="py-2 pr-4">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(status.deposits ?? []).map((d) => (
                      <tr key={d.depositId} className="text-gray-200">
                        <td className="py-2 pr-4 whitespace-nowrap">{new Date(d.updatedAt).toLocaleDateString()}</td>
                        <td className="py-2 pr-4 whitespace-nowrap">{money(d.amountMinor, d.currency)}</td>
                        <td className="py-2 pr-4">{(d.rail ?? '').toUpperCase()}</td>
                        <td className="py-2 pr-4">
                          {DEPOSIT_LABEL[d.status] ?? d.status}
                          {d.txHash ? <span className="block font-mono text-xs text-gray-400 break-all">{d.txHash}</span> : null}
                          {d.returnCode ? <span className="block text-xs text-gray-400">{d.returnCode}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
