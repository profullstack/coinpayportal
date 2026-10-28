'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import {
  bytesToBase64,
  createVault,
  MIN_PASSPHRASE_LENGTH,
  rewrapWithPassphrase,
  unwrapDek,
  unwrapDekWithRecovery,
  wipe,
  type VaultRecord,
} from '@/lib/vault/sealed-vault';

/**
 * Secrets vault: the merchant's passphrase seals the secrets CoinPay uses while
 * they are away (bank feeds, CrawlProof, payout wallet keys, PayPal REST
 * secrets). Everything cryptographic happens here in the browser; the server
 * receives the vault record (ciphertext) and, to unlock, the data key, never
 * the passphrase.
 */

interface VaultState {
  subject_id: string;
  exists: boolean;
  record: VaultRecord | null;
  unlocked: boolean;
  expiresAt: string | null;
}

const TTL_OPTIONS = [
  { hours: 1, label: '1 hour' },
  { hours: 8, label: '8 hours' },
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days (max)' },
];

export default function VaultPage() {
  const router = useRouter();
  const [vault, setVault] = useState<VaultState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ttlHours, setTtlHours] = useState(8);
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [shownRecoveryKey, setShownRecoveryKey] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const result = await authFetch('/api/vault', {}, router);
    if (!result) return;
    if (!result.response.ok) {
      setError(result.data?.error || 'Could not load the vault');
      return;
    }
    setVault(result.data as VaultState);
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const sendUnlock = async (dek: Uint8Array) => {
    const result = await authFetch(
      '/api/vault/unlock',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data_key: bytesToBase64(dek), ttl_hours: ttlHours }) },
      router,
    );
    if (!result) return false;
    if (!result.response.ok) throw new Error(result.data?.error || 'Unlock failed');
    return true;
  };

  const onCreate = async () => {
    setError('');
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) return setError(`Use at least ${MIN_PASSPHRASE_LENGTH} characters`);
    if (passphrase !== confirm) return setError('The passphrases do not match');
    if (!vault) return;
    setBusy(true);
    try {
      const { record, dek, recoveryKey } = await createVault(passphrase, 'merchant', vault.subject_id);
      const created = await authFetch(
        '/api/vault',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ record }) },
        router,
      );
      if (!created) return;
      if (!created.response.ok) throw new Error(created.data?.error || 'Could not create the vault');
      await sendUnlock(dek);
      wipe(dek);
      setShownRecoveryKey(recoveryKey);
      setPassphrase('');
      setConfirm('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the vault');
    } finally {
      setBusy(false);
    }
  };

  const onUnlock = async () => {
    setError('');
    if (!vault?.record) return;
    setBusy(true);
    let dek: Uint8Array | null = null;
    try {
      if (useRecovery) {
        if (newPassphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(`Choose a new passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters`);
        dek = await unwrapDekWithRecovery(vault.record, recoveryInput, 'merchant', vault.subject_id);
        const next = await rewrapWithPassphrase(vault.record, dek, newPassphrase, 'merchant', vault.subject_id);
        const saved = await authFetch(
          '/api/vault',
          { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ record: next, data_key: bytesToBase64(dek) }) },
          router,
        );
        if (!saved) return;
        if (!saved.response.ok) throw new Error(saved.data?.error || 'Could not save the new passphrase');
        setNotice('New passphrase saved. Your recovery key still works.');
      } else {
        dek = await unwrapDek(vault.record, passphrase, 'merchant', vault.subject_id);
      }
      await sendUnlock(dek);
      setPassphrase('');
      setRecoveryInput('');
      setNewPassphrase('');
      setUseRecovery(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlock failed');
    } finally {
      wipe(dek);
      setBusy(false);
    }
  };

  const onLock = async () => {
    setBusy(true);
    try {
      await authFetch('/api/vault/lock', { method: 'POST' }, router);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white';
  const button = 'rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Secrets vault</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Your bank feeds (SimpleFIN, Plaid, saved bank sessions), CrawlProof token, statements and documents,
            payout wallet keys and PayPal REST secret are sealed to a passphrase only you know. CoinPay cannot open
            them unless you unlock. While unlocked, syncs, payouts and PayPal checkout run; when the unlock ends
            (or the server restarts) they pause with a &ldquo;locked&rdquo; status until you unlock again.
          </p>
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
            If you lose both the passphrase and the recovery key, the sealed secrets are gone for good: you will have
            to link your banks and re-enter your keys again. Funds in a payout wallet need the key, so keep the
            recovery key somewhere safe.
          </p>
        </div>

        {error && <div className="rounded border border-red-300 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>}
        {notice && <div className="rounded border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</div>}

        {shownRecoveryKey && (
          <div className="rounded border border-purple-300 bg-purple-50 dark:bg-purple-900/20 p-4">
            <h2 className="font-semibold text-purple-900 dark:text-purple-200">Your recovery key (shown once)</h2>
            <code className="mt-2 block break-all font-mono text-sm text-purple-900 dark:text-purple-100">{shownRecoveryKey}</code>
            <p className="mt-2 text-xs text-purple-800 dark:text-purple-300">Write it down or store it in a password manager. It unlocks the vault if you forget the passphrase.</p>
            <button className={`${button} mt-3`} onClick={() => setShownRecoveryKey(null)}>I saved it</button>
          </div>
        )}

        {!vault ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : !vault.exists ? (
          <div className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
            <h2 className="font-semibold text-gray-900 dark:text-white">Set up your vault</h2>
            <input type="password" className={input} placeholder={`Passphrase (${MIN_PASSPHRASE_LENGTH}+ characters)`} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" />
            <input type="password" className={input} placeholder="Repeat passphrase" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            <TtlSelect value={ttlHours} onChange={setTtlHours} />
            <button className={button} disabled={busy} onClick={onCreate}>{busy ? 'Sealing…' : 'Create vault and unlock'}</button>
            <p className="text-xs text-gray-500">Secrets you already connected are re-sealed to the new vault right away.</p>
          </div>
        ) : vault.unlocked ? (
          <div className="rounded border border-emerald-300 bg-white dark:bg-gray-800 p-4 space-y-3">
            <h2 className="font-semibold text-emerald-700 dark:text-emerald-300">Unlocked</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Until {vault.expiresAt ? new Date(vault.expiresAt).toLocaleString() : 'the server restarts'}, or until you lock it.
            </p>
            <button className={button} disabled={busy} onClick={onLock}>Lock now</button>
          </div>
        ) : (
          <div className="rounded border border-amber-300 bg-white dark:bg-gray-800 p-4 space-y-3">
            <h2 className="font-semibold text-amber-700 dark:text-amber-300">Locked</h2>
            {!useRecovery ? (
              <input type="password" className={input} placeholder="Passphrase" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="current-password" />
            ) : (
              <>
                <input className={input} placeholder="Recovery key (XXXX-XXXX-…)" value={recoveryInput} onChange={(e) => setRecoveryInput(e.target.value)} />
                <input type="password" className={input} placeholder="New passphrase" value={newPassphrase} onChange={(e) => setNewPassphrase(e.target.value)} autoComplete="new-password" />
              </>
            )}
            <TtlSelect value={ttlHours} onChange={setTtlHours} />
            <div className="flex items-center gap-4">
              <button className={button} disabled={busy} onClick={onUnlock}>{busy ? 'Unlocking…' : 'Unlock'}</button>
              <button className="text-sm text-purple-600 hover:underline" onClick={() => setUseRecovery((v) => !v)}>
                {useRecovery ? 'Use my passphrase' : 'Forgot it? Use the recovery key'}
              </button>
            </div>
          </div>
        )}

        <details className="text-sm text-gray-600 dark:text-gray-300">
          <summary className="cursor-pointer">Unlock from a script (API)</summary>
          <p className="mt-2">
            <code>GET /api/vault</code> returns the vault record. Derive the data key where the passphrase is
            (PBKDF2-SHA256 600k over the passphrase with <code>record.kdf.salt</code>, then HKDF, then unwrap
            <code> record.wrapped_dek</code>; <code>unwrapDek</code> in <code>src/lib/vault/sealed-vault.ts</code>
            does exactly this) and <code>POST /api/vault/unlock</code> with
            <code> {'{ "data_key": "<base64>", "ttl_hours": 168 }'}</code> using your API key. Never send the passphrase.
            <code> POST /api/vault/lock</code> ends it.
          </p>
        </details>
      </div>
    </div>
  );
}

function TtlSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className="block text-sm text-gray-700 dark:text-gray-300">
      Stay unlocked for{' '}
      <select className="ml-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {TTL_OPTIONS.map((o) => (
          <option key={o.hours} value={o.hours}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
