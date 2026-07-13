'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function CliAuthContent() {
  const searchParams = useSearchParams();
  const initialCode = (searchParams.get('code') || '').trim().toUpperCase();

  const [code, setCode] = useState(initialCode);
  const [clientName, setClientName] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [reqStatus, setReqStatus] = useState<string>('');
  const [state, setState] = useState<'idle' | 'working' | 'approved' | 'denied' | 'error'>('idle');
  const [message, setMessage] = useState('');

  // On load, look up the request (this also tells us if we're signed in).
  useEffect(() => {
    if (!initialCode) return;
    (async () => {
      try {
        const res = await fetch(`/api/cli-auth/approve?code=${encodeURIComponent(initialCode)}`);
        if (res.status === 401) {
          setNeedsLogin(true);
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setClientName(data.client_name || null);
          setReqStatus(data.status || '');
        }
      } catch {
        /* ignore — user can still submit */
      }
    })();
  }, [initialCode]);

  async function submit(action: 'approve' | 'deny') {
    const c = code.trim().toUpperCase();
    if (!c) {
      setMessage('Enter the code shown in your terminal.');
      return;
    }
    setState('working');
    setMessage('');
    try {
      const res = await fetch('/api/cli-auth/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_code: c, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setNeedsLogin(true);
        setState('idle');
        return;
      }
      if (!res.ok) {
        setState('error');
        setMessage(data.error || 'Something went wrong.');
        return;
      }
      setState(action === 'approve' ? 'approved' : 'denied');
    } catch {
      setState('error');
      setMessage('Network error — please try again.');
    }
  }

  const card = 'bg-slate-800 rounded-lg shadow-lg p-8';
  const loginHref = `/login?redirect=${encodeURIComponent(`/cli-auth?code=${code || initialCode}`)}`;

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Authorize CLI</h1>
        </div>

        <div className={card}>
          {needsLogin ? (
            <>
              <p className="text-slate-300">Sign in to approve this command-line login request.</p>
              <a
                href={loginHref}
                className="mt-5 block w-full rounded-lg bg-blue-600 px-4 py-3 text-center font-medium text-white hover:bg-blue-500"
              >
                Sign in to continue
              </a>
            </>
          ) : state === 'approved' ? (
            <>
              <h2 className="text-xl font-semibold text-green-400">✓ Approved</h2>
              <p className="mt-2 text-slate-300">Your terminal is now signing in. You can close this tab.</p>
            </>
          ) : state === 'denied' ? (
            <>
              <h2 className="text-xl font-semibold text-white">Request denied</h2>
              <p className="mt-2 text-slate-300">The command-line login was denied.</p>
            </>
          ) : (
            <>
              <p className="text-slate-300">
                A command-line client
                {clientName ? ` on “${clientName}”` : ''} is asking to sign in to your CoinPay account.
              </p>

              {reqStatus === 'expired' && (
                <p className="mt-3 rounded border border-red-700 bg-red-900/50 p-3 text-sm text-red-200">
                  This request has expired — run <code>coinpay login</code> again.
                </p>
              )}
              {reqStatus && reqStatus !== 'pending' && reqStatus !== 'expired' && (
                <p className="mt-3 rounded border border-yellow-700 bg-yellow-900/40 p-3 text-sm text-yellow-200">
                  This request was already handled.
                </p>
              )}

              <label className="mt-5 block text-sm font-medium text-slate-300">Code from your terminal</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="XXXX-XXXX"
                autoComplete="off"
                spellCheck={false}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-3 font-mono uppercase tracking-widest text-white"
              />
              {message && <p className="mt-2 text-sm text-red-300">{message}</p>}

              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  disabled={state === 'working'}
                  onClick={() => submit('deny')}
                  className="flex-1 rounded-lg bg-slate-700 px-4 py-3 font-medium text-white transition-colors hover:bg-slate-600 disabled:opacity-50"
                >
                  Deny
                </button>
                <button
                  type="button"
                  disabled={state === 'working' || reqStatus === 'expired'}
                  onClick={() => submit('approve')}
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
                >
                  {state === 'working' ? '…' : 'Approve'}
                </button>
              </div>

              <p className="mt-4 text-xs text-slate-500">
                Only approve this if you just ran <code>coinpay login</code> yourself.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CliAuthPage() {
  return (
    <Suspense fallback={null}>
      <CliAuthContent />
    </Suspense>
  );
}
