'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import {
  DEFAULT_KDF,
  GENERATED_BITS,
  checkStrength,
  deriveSecretKey,
  generatePassphrase,
  normalizePassphrase,
  publicKeyHex,
  randomSaltHex,
} from '@/lib/passphrase';

const DEADMAN_URL = 'https://deadman.switch.pit.world/';

type Status = { enabled: boolean; created_at?: string; last_used_at?: string | null; source?: string };
type Step = 'idle' | 'choose' | 'confirm' | 'save' | 'passon';

const input =
  'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500';
const primary =
  'inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const secondary =
  'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors';

export default function PassphraseSection() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [mode, setMode] = useState<'generated' | 'custom'>('generated');
  const [phrase, setPhrase] = useState('');
  const [retype, setRetype] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState(false);

  const load = async () => {
    const r = await authFetch('/api/auth/passphrase', {}, router);
    if (r?.response.ok && r.data.success) setStatus(r.data);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = () => {
    setError('');
    setMode('generated');
    setPhrase(generatePassphrase());
    setRetype('');
    setPassword('');
    setStep('choose');
  };

  const reset = () => {
    setStep('idle');
    setPhrase('');
    setRetype('');
    setPassword('');
    setError('');
    setCopied(false);
  };

  const strength = mode === 'custom' ? checkStrength(phrase) : null;
  const canContinue = mode === 'generated' ? !!phrase : !!strength?.ok;

  const save = async () => {
    setError('');
    setBusy(true);
    try {
      const salt = randomSaltHex();
      const sk = await deriveSecretKey(phrase, salt, DEFAULT_KDF);
      const publicKey = await publicKeyHex(sk);
      sk.fill(0);
      const r = await authFetch(
        '/api/auth/passphrase',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password, publicKey, salt, kdf: DEFAULT_KDF, source: mode }),
        },
        router
      );
      if (!r) return;
      if (!r.response.ok || !r.data.success) {
        setError(r.data.error || 'Could not save the passphrase');
        return;
      }
      setPassword('');
      setRetype('');
      await load();
      setStep('passon');
    } catch (e) {
      setError((e as Error).message || 'Could not save the passphrase');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const pw = window.prompt('Enter your current password to turn off passphrase sign-in');
    if (!pw) return;
    setRemoving(true);
    setError('');
    const r = await authFetch(
      '/api/auth/passphrase',
      { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) },
      router
    );
    setRemoving(false);
    if (r && (!r.response.ok || !r.data.success)) setError(r.data.error || 'Could not remove it');
    await load();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phrase);
      setCopied(true);
    } catch {
      setError('Could not copy. Select the phrase and copy it by hand.');
    }
  };

  return (
    <div id="passphrase" className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Passphrase</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Sign in with a sentence you remember. It never leaves your browser: we only keep a key made from it,
            so it works without a password manager and you can pass it on to your heirs.
          </p>
        </div>
        {step === 'idle' && (
          <button onClick={start} className={`${primary} shrink-0`}>
            {status?.enabled ? 'Replace' : 'Create passphrase'}
          </button>
        )}
      </div>

      {error && (
        <div className="mx-6 mt-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {step === 'idle' && (
        <div className="p-6 text-sm text-gray-600 dark:text-gray-300 flex items-center justify-between gap-4">
          {status?.enabled ? (
            <>
              <span>
                ✅ On since {status.created_at ? new Date(status.created_at).toLocaleDateString() : 'recently'}
                {status.last_used_at ? `, last used ${new Date(status.last_used_at).toLocaleDateString()}` : ', not used yet'}.
              </span>
              <button onClick={remove} disabled={removing} className="text-red-600 hover:text-red-500 font-medium disabled:opacity-50">
                {removing ? 'Removing…' : 'Turn off'}
              </button>
            </>
          ) : (
            <span>Off. Your account signs in with your password{' '}or a passkey.</span>
          )}
        </div>
      )}

      {step === 'choose' && (
        <div className="p-6 space-y-4">
          <div className="flex gap-2 text-sm">
            <button onClick={() => { setMode('generated'); setPhrase(generatePassphrase()); }} className={mode === 'generated' ? primary : secondary}>
              Make one for me
            </button>
            <button onClick={() => { setMode('custom'); setPhrase(''); }} className={mode === 'custom' ? primary : secondary}>
              I&apos;ll write my own
            </button>
          </div>

          {mode === 'generated' ? (
            <>
              <p className="text-2xl leading-relaxed font-semibold text-gray-900 dark:text-white bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 select-all">
                {phrase}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Picture it. A silly scene sticks far better than 12 random words. Don&apos;t like it?{' '}
                <button onClick={() => setPhrase(generatePassphrase())} className="text-purple-600 hover:text-purple-500 font-medium">
                  Give me another
                </button>
                . About {Math.round(GENERATED_BITS)} bits of randomness behind a deliberately slow lock.
              </p>
            </>
          ) : (
            <>
              <textarea
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                rows={3}
                className={input}
                placeholder="A sentence only you would come up with, 6+ words"
                autoComplete="off"
                spellCheck={false}
              />
              <p className={`text-sm ${strength?.ok ? 'text-green-700 dark:text-green-400' : 'text-gray-600 dark:text-gray-300'}`}>
                {phrase ? (strength?.ok ? `Looks strong (about ${strength.bits} bits if every word is a guess).` : strength?.reason) : 'Six or more words.'}{' '}
                Song lyrics, quotes, verses and sayings are the first thing attackers try, even with a twist. Make up your own.
              </p>
            </>
          )}

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Capitals, punctuation and the words &quot;a&quot;, &quot;an&quot; and &quot;the&quot; don&apos;t matter when you type it.
          </p>
          <div className="flex gap-2">
            <button onClick={() => { setRetype(''); setStep('confirm'); }} disabled={!canContinue} className={primary}>
              I&apos;ve got it
            </button>
            <button onClick={reset} className={secondary}>Cancel</button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="p-6 space-y-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">Type it from memory</label>
          <textarea value={retype} onChange={(e) => setRetype(e.target.value)} rows={2} className={input} autoComplete="off" spellCheck={false} autoFocus />
          {retype && normalizePassphrase(retype) !== normalizePassphrase(phrase) && (
            <p className="text-sm text-gray-500">Not a match yet.</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => setStep('save')}
              disabled={normalizePassphrase(retype) !== normalizePassphrase(phrase)}
              className={primary}
            >
              Matches
            </button>
            <button onClick={() => setStep('choose')} className={secondary}>Show it again</button>
          </div>
        </div>
      )}

      {step === 'save' && (
        <div className="p-6 space-y-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="pp-password">
            Current password, to confirm it&apos;s you
          </label>
          <input id="pp-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} autoComplete="current-password" />
          {status?.enabled && <p className="text-sm text-amber-700 dark:text-amber-400">This replaces your old passphrase. The old one stops working.</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={busy || !password} className={primary}>
              {busy ? 'Locking it in…' : 'Turn on passphrase sign-in'}
            </button>
            <button onClick={reset} className={secondary}>Cancel</button>
          </div>
        </div>
      )}

      {step === 'passon' && (
        <div className="p-6 space-y-4">
          <p className="text-green-700 dark:text-green-400 font-medium">Passphrase sign-in is on.</p>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <h3 className="font-semibold text-gray-900 dark:text-white">Pass it on with deadman.switch</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              If something happens to you, your heirs get this phrase, and nobody sees it before then. deadman.switch
              seals it in your browser and only releases it if you stop checking in.
            </p>
            <ol className="text-sm text-gray-600 dark:text-gray-300 list-decimal ml-5 space-y-1">
              <li>Copy the phrase (this is the last time we can show it).</li>
              <li>On deadman.switch, sign in, make a switch and paste it into the note with your CoinPay email.</li>
              <li>Add the people who should get it, and give them the switch&apos;s opening passphrase.</li>
            </ol>
            <p className="text-lg font-semibold text-gray-900 dark:text-white bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 select-all">{phrase}</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={copy} className={secondary}>{copied ? 'Copied ✓' : 'Copy phrase'}</button>
              <a href={DEADMAN_URL} target="_blank" rel="noopener noreferrer" className={primary}>
                Open deadman.switch ↗
              </a>
            </div>
          </div>
          <button onClick={reset} className={secondary}>Done, hide the phrase</button>
        </div>
      )}
    </div>
  );
}
