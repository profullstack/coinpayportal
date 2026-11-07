'use client';

/**
 * /pass — one CoinPay account for every Profullstack property.
 *
 * 1. Pick the properties (or all of them): "Sign in with CoinPay" there then
 *    goes straight through, no consent screen.
 * 2. Deposit $99 into your own CoinPay web wallet: a free month on all of them.
 *    The money stays in your wallet; spend it however you like. After the month,
 *    each property takes pay-as-you-go top-ups through crypto checkout.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getAuthToken } from '@/lib/auth/client';

interface PassApp {
  host: string;
  name: string;
  url: string;
  connected: boolean;
}

interface PassStatus {
  active: boolean;
  claimed: boolean;
  expires_at?: string;
  deposit_usd?: number;
}

function authHeaders(): HeadersInit {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function fmtDate(iso?: string) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
}

export default function PassPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [apps, setApps] = useState<PassApp[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pass, setPass] = useState<PassStatus | null>(null);
  const [threshold, setThreshold] = useState(99);
  const [days, setDays] = useState(30);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const [depositMessage, setDepositMessage] = useState('');

  const load = useCallback(async () => {
    const [appsRes, passRes] = await Promise.all([
      fetch('/api/pass/apps', { headers: authHeaders(), cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/pass', { headers: authHeaders(), cache: 'no-store' }).then((r) => r.json()),
    ]);
    setSignedIn(!!passRes.signed_in);
    setApps(appsRes.apps ?? []);
    setPass(passRes.pass ?? null);
    if (passRes.offer) {
      setThreshold(passRes.offer.threshold_usd);
      setDays(passRes.offer.days);
    }
  }, []);

  useEffect(() => {
    load().catch(() => setSignedIn(false));
  }, [load]);

  const notConnected = useMemo(() => apps.filter((a) => !a.connected), [apps]);
  const allSelected = notConnected.length > 0 && notConnected.every((a) => selected.has(a.host));

  function toggle(host: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(host)) next.delete(host);
      else next.add(host);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(notConnected.map((a) => a.host)));
  }

  async function connect() {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/pass/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ hosts: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.error || 'Could not save');
      setMessage(`Connected ${data.connected.length} ${data.connected.length === 1 ? 'property' : 'properties'}.`);
      setSelected(new Set());
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function checkDeposit() {
    setChecking(true);
    setDepositMessage('');
    try {
      const res = await fetch('/api/pass/claim', { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.error || 'Could not check');
      if (data.status === 'granted') setDepositMessage(`Your free month is on. It runs until ${fmtDate(data.pass.expires_at)}.`);
      else if (data.status === 'already_claimed') setDepositMessage('You already used your free month.');
      else if (data.status === 'no_wallet') setDepositMessage('Connect your CoinPay web wallet to your account first (Settings, Wallets).');
      else if (data.status === 'insufficient')
        setDepositMessage(`We see $${data.deposit_usd.toFixed(2)} in new deposits. Deposit $${data.needed_usd.toFixed(2)} more and check again.`);
      if (data.pass) setPass(data.pass);
    } catch (e) {
      setDepositMessage(e instanceof Error ? e.message : 'Could not check');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 text-gray-200">
      <h1 className="text-3xl font-bold text-white mb-2">One CoinPay account, every Profullstack app</h1>
      <p className="text-gray-400 mb-10">
        Sign in to all of our properties with CoinPay. Deposit ${threshold} into your own CoinPay wallet and get{' '}
        {days} days free on every one of them. The money stays yours, in your wallet: spend it however you like.
        After that, each app takes pay-as-you-go top-ups with crypto checkout.
      </p>

      {signedIn === false && (
        <div className="bg-slate-800 rounded-lg p-6 mb-10">
          <p className="mb-4">Sign in or create a CoinPay account to start.</p>
          <div className="flex gap-3">
            <Link href="/login?redirect=/pass" className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white">
              Sign in
            </Link>
            <Link href="/signup?redirect=/pass" className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-white">
              Create account
            </Link>
          </div>
        </div>
      )}

      <section className="bg-slate-800 rounded-lg p-6 mb-8" aria-labelledby="free-month">
        <h2 id="free-month" className="text-xl font-semibold text-white mb-3">
          Free month
        </h2>
        {pass?.active ? (
          <p className="text-green-400">Active until {fmtDate(pass.expires_at)} on every property below.</p>
        ) : pass?.claimed ? (
          <p className="text-gray-400">Your free month ended {fmtDate(pass.expires_at)}. Top up on any app with crypto checkout.</p>
        ) : (
          <>
            <ol className="list-decimal list-inside space-y-1 text-gray-300 mb-4">
              <li>
                Open your <Link href="/web-wallet" className="text-blue-400 hover:text-blue-300">CoinPay web wallet</Link> and
                connect it to this account under{' '}
                <Link href="/settings/wallets" className="text-blue-400 hover:text-blue-300">Settings, Wallets</Link>.
              </li>
              <li>Deposit ${threshold} or more from outside CoinPay (any supported coin; USDC counts dollar for dollar).</li>
              <li>Once it confirms, check it here.</li>
            </ol>
            <button
              type="button"
              onClick={checkDeposit}
              disabled={!signedIn || checking}
              className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white"
            >
              {checking ? 'Checking the chain…' : 'Check my deposit'}
            </button>
          </>
        )}
        {depositMessage && (
          <p role="status" className="mt-3 text-sm text-gray-300">
            {depositMessage}
          </p>
        )}
      </section>

      <section className="bg-slate-800 rounded-lg p-6" aria-labelledby="apps">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 id="apps" className="text-xl font-semibold text-white">
            Sign in everywhere
          </h2>
          {signedIn && notConnected.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              Select all
            </label>
          )}
        </div>
        <p className="text-sm text-gray-400 mb-4">
          Picked apps can sign you in with CoinPay in one click: your name, email and CoinPay identity, nothing that can
          spend money. Apps that ask to act on your merchant account still ask you first.
        </p>
        <ul className="grid sm:grid-cols-2 gap-2 mb-4">
          {apps.map((a) => (
            <li key={a.host} className="flex items-center justify-between gap-2 bg-slate-900/60 rounded px-3 py-2">
              <label className="flex items-center gap-2 min-w-0">
                {a.connected ? (
                  <span aria-label="connected" className="text-green-400">
                    ✓
                  </span>
                ) : (
                  <input
                    type="checkbox"
                    disabled={!signedIn}
                    checked={selected.has(a.host)}
                    onChange={() => toggle(a.host)}
                  />
                )}
                <span className="truncate">{a.host}</span>
              </label>
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400 hover:text-blue-300">
                Open
              </a>
            </li>
          ))}
        </ul>
        {signedIn && (
          <button
            type="button"
            onClick={connect}
            disabled={saving || selected.size === 0}
            className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white"
          >
            {saving ? 'Saving…' : `Connect ${selected.size || ''} selected`.trim()}
          </button>
        )}
        {message && (
          <p role="status" className="mt-3 text-sm text-gray-300">
            {message}
          </p>
        )}
      </section>
    </div>
  );
}
