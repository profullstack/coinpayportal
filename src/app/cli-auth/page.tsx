'use client';

import { Suspense, useEffect, useState } from 'react';

function CliAuthContent() {
  // G-1.2-10: `?code=` is deliberately NOT read.
  //
  // Anyone could start a device authorization — it is unauthenticated by
  // necessity, the CLI has no credential yet — and get a link that pre-filled
  // this form. Sent to a signed-in merchant, one click handed the *attacker's*
  // terminal a 7-day session JWT for the victim's account: full takeover, one
  // click, and the attacker also chose the client name shown below.
  //
  // The merchant must type the code their own terminal printed. An attacker can
  // still send someone here, but cannot make the victim's screen show the
  // attacker's code.
  const [code, setCode] = useState('');
  const [clientName, setClientName] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [reqStatus, setReqStatus] = useState<string>('');
  const [state, setState] = useState<'idle' | 'working' | 'approved' | 'denied' | 'error'>('idle');
  const [message, setMessage] = useState('');

  // Look the request up once the typed code is complete. This also tells us
  // whether the visitor is signed in.
  const lookupCode = code.trim().toUpperCase();
  useEffect(() => {
    if (lookupCode.replace('-', '').length < 8) return;
    (async () => {
      try {
        const res = await fetch(`/api/cli-auth/approve?code=${encodeURIComponent(lookupCode)}`);
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
  }, [lookupCode]);

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
  // No code in the redirect: it would survive the login round-trip and
  // re-create the pre-filled form this fix removes.
  const loginHref = `/login?redirect=${encodeURIComponent('/cli-auth')}`;

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
                A command-line client is asking to sign in to your CoinPay account.
              </p>

              {/*
                `client_name` is chosen by whoever started the request, so it is
                a claim and not an identity — an attacker picks it as freely as
                the real client does. Shown, because it helps a user recognise
                their own machine, but labelled so it cannot be read as
                verified by us.
              */}
              {clientName && (
                <p className="mt-2 text-sm text-slate-400">
                  It calls itself <span className="font-mono text-slate-300">“{clientName}”</span>{' '}
                  <span className="text-slate-500">(self-reported, not verified)</span>.
                </p>
              )}

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
                Only approve this if you just ran <code>coinpay login</code> yourself, and
                the code above matches the one in your own terminal. Never enter a
                code someone else sent you — approving gives that person full
                access to your account.
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
