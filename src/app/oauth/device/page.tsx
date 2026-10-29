'use client';

/**
 * RFC 8628 verification page: a signed-in CoinPay user types the code their
 * device printed, sees which app is asking and for what, and approves or
 * denies. `?user_code=` is deliberately not read (see device_authorization).
 */
import { Suspense, useEffect, useState } from 'react';
import { describeScope } from '@/lib/oauth/scopes';

type Lookup = {
  status: string;
  client_id: string;
  name: string;
  description: string | null;
  scopes: string[];
  account: string | null;
};

function DeviceContent() {
  const [code, setCode] = useState('');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [state, setState] = useState<'idle' | 'working' | 'approved' | 'denied'>('idle');
  const [message, setMessage] = useState('');

  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');

  useEffect(() => {
    // Find out up front whether the visitor is signed in.
    fetch('/api/oauth/session', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setNeedsLogin(!d?.signed_in))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLookup(null);
    setMessage('');
    if (normalized.length !== 8) return;
    (async () => {
      const res = await fetch(`/api/oauth/device?user_code=${encodeURIComponent(normalized)}`, { cache: 'no-store' });
      if (res.status === 401) return setNeedsLogin(true);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setLookup(data as Lookup);
      else setMessage(res.status === 404 ? 'No pending request has that code.' : data.error_description || data.error || 'Lookup failed.');
    })();
  }, [normalized]);

  async function submit(action: 'approve' | 'deny') {
    setState('working');
    setMessage('');
    const res = await fetch('/api/oauth/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_code: normalized, action }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      setNeedsLogin(true);
      setState('idle');
      return;
    }
    if (!res.ok) {
      setState('idle');
      setMessage(data.error_description || data.error || 'Something went wrong.');
      return;
    }
    setState(action === 'approve' ? 'approved' : 'denied');
  }

  const loginHref = `/login?redirect=${encodeURIComponent('/oauth/device')}`;

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Connect a device</h1>
          <p className="text-gray-400">Sign in to an app on another device with your CoinPay account.</p>
        </div>
        <div className="bg-slate-800 rounded-lg shadow-lg p-8">
          {needsLogin ? (
            <>
              <p className="text-slate-300">Sign in to CoinPay first, then enter the code your device shows.</p>
              <a href={loginHref} className="mt-5 block w-full rounded-lg bg-blue-600 px-4 py-3 text-center font-medium text-white hover:bg-blue-500">
                Sign in to continue
              </a>
            </>
          ) : state === 'approved' ? (
            <>
              <h2 className="text-xl font-semibold text-green-400">Approved</h2>
              <p className="mt-2 text-slate-300">{lookup?.name || 'The app'} is signing in now. You can close this tab.</p>
            </>
          ) : state === 'denied' ? (
            <>
              <h2 className="text-xl font-semibold text-white">Denied</h2>
              <p className="mt-2 text-slate-300">The request was refused. Nothing was shared.</p>
            </>
          ) : (
            <>
              <label htmlFor="user-code" className="block text-sm font-medium text-slate-300">Code shown on your device</label>
              <input
                id="user-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="XXXX-XXXX"
                autoComplete="off"
                autoFocus
                spellCheck={false}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-3 font-mono uppercase tracking-widest text-white"
              />
              {message && <p className="mt-2 text-sm text-red-300">{message}</p>}

              {lookup && (
                <div className="mt-6">
                  {lookup.status === 'expired' ? (
                    <p className="rounded border border-red-700 bg-red-900/50 p-3 text-sm text-red-200">This code has expired. Start the sign-in again on your device.</p>
                  ) : lookup.status !== 'pending' ? (
                    <p className="rounded border border-yellow-700 bg-yellow-900/40 p-3 text-sm text-yellow-200">This code was already used.</p>
                  ) : (
                    <>
                      <p className="text-white">
                        <span className="font-semibold">{lookup.name}</span> wants to access your CoinPay account
                        {lookup.account ? <> (<span className="font-medium">{lookup.account}</span>)</> : null}.
                      </p>
                      {lookup.description && <p className="mt-1 text-sm text-slate-400">{lookup.description}</p>}
                      <h2 className="mt-4 mb-2 font-semibold text-white">It will be able to:</h2>
                      <ul className="space-y-2">
                        {lookup.scopes.map((s) => {
                          const info = describeScope(s);
                          return (
                            <li key={s} data-scope={s} className={info.sensitive ? 'rounded-lg border border-amber-600 bg-amber-900/30 p-3 text-amber-100' : 'text-slate-300'}>
                              <div className="font-medium">{info.icon} {info.label}</div>
                              <div className="text-sm opacity-90">{info.description}</div>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="mt-6 flex gap-3">
                        <button type="button" disabled={state === 'working'} onClick={() => submit('deny')} className="flex-1 rounded-lg bg-slate-700 px-4 py-3 font-medium text-white hover:bg-slate-600 disabled:opacity-50">
                          Deny
                        </button>
                        <button type="button" disabled={state === 'working'} onClick={() => submit('approve')} className="flex-1 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                          {state === 'working' ? '…' : 'Approve'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              <p className="mt-6 text-xs text-slate-500">
                Only enter a code that your own device is showing right now. Never enter a code someone sent you: approving gives them access to your account.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DevicePage() {
  return (
    <Suspense fallback={null}>
      <DeviceContent />
    </Suspense>
  );
}
