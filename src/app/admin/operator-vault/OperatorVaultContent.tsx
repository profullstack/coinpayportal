'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import { bytesToBase64, createVault, MIN_PASSPHRASE_LENGTH, unwrapDek, unwrapDekWithRecovery, wipe, type VaultRecord } from '@/lib/vault/sealed-vault';

interface Status {
  subject_id: string;
  exists: boolean;
  record: VaultRecord | null;
  sealed: boolean;
  sealed_names: string[];
  env_mnemonic_names: string[];
  pool: Record<string, number>;
  unlocked: boolean;
  expiresAt: string | null;
}

/**
 * CoinPay's own SYSTEM_MNEMONIC_* sealed to an operator passphrase. All
 * cryptography runs in this browser; the server gets the vault record
 * (ciphertext) and, to unlock, the data key. Never the passphrase.
 */
export default function OperatorVaultContent() {
  const router = useRouter();
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [recovery, setRecovery] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [ttl, setTtl] = useState(168);
  const [shownRecovery, setShownRecovery] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await authFetch('/api/admin/operator-vault', {}, router);
    if (!r) return;
    if (!r.response.ok) return setError(r.data?.error || 'Could not load');
    setS(r.data as Status);
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const post = async (url: string, body: unknown) => {
    const r = await authFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, router);
    if (!r) throw new Error('Not signed in');
    if (!r.response.ok) throw new Error(r.data?.error || `Request failed (${r.response.status})`);
    return r.data;
  };

  const run = async (fn: () => Promise<void>) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const onSetup = () =>
    run(async () => {
      if (pass.length < MIN_PASSPHRASE_LENGTH) throw new Error(`Use at least ${MIN_PASSPHRASE_LENGTH} characters`);
      if (pass !== confirm) throw new Error('The passphrases do not match');
      const { record, dek, recoveryKey } = await createVault(pass, 'operator', s!.subject_id);
      try {
        const out = await post('/api/admin/operator-vault', { record });
        await post('/api/admin/operator-vault/unlock', { data_key: bytesToBase64(dek), ttl_hours: ttl });
        setNotice(`Sealed ${out.sealed?.length ?? 0} mnemonics; re-sealed ${out.resealed?.resealed ?? 0} deposit-address keys. Now remove SYSTEM_MNEMONIC_* from app.env and the vault, and redeploy.`);
      } finally {
        wipe(dek);
      }
      setShownRecovery(recoveryKey);
      setPass('');
      setConfirm('');
    });

  const onUnlock = () =>
    run(async () => {
      let dek: Uint8Array | null = null;
      try {
        dek = useRecovery
          ? await unwrapDekWithRecovery(s!.record!, recovery, 'operator', s!.subject_id)
          : await unwrapDek(s!.record!, pass, 'operator', s!.subject_id);
        await post('/api/admin/operator-vault/unlock', { data_key: bytesToBase64(dek), ttl_hours: ttl });
      } finally {
        wipe(dek);
      }
      setPass('');
      setRecovery('');
    });

  const onLock = () => run(async () => void (await post('/api/admin/operator-vault/lock', {})));

  const input = 'w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white';
  const button = 'rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50';

  return (
    <div className="min-h-screen bg-slate-900 px-4 py-8 text-gray-200">
      <div className="mx-auto max-w-2xl space-y-5">
        <h1 className="text-2xl font-bold text-white">Operator keys</h1>
        <p className="text-sm text-gray-400">
          CoinPay&apos;s SYSTEM_MNEMONIC_* are sealed to this passphrase. While locked, payment forwarding and escrow
          settlement pause (payments wait on the retry queue), relayer checks skip, and checkout draws deposit addresses
          from a pool derived while unlocked. A restart locks. Losing both the passphrase and the recovery key loses the
          sealed copy: the seeds then exist only in your offline backup.
        </p>
        {error && <div className="rounded border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</div>}
        {notice && <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">{notice}</div>}
        {shownRecovery && (
          <div className="rounded border border-purple-500/40 bg-purple-500/10 p-4">
            <div className="font-semibold text-purple-200">Recovery key (shown once)</div>
            <code className="mt-2 block break-all font-mono text-sm">{shownRecovery}</code>
            <button className={`${button} mt-3`} onClick={() => setShownRecovery(null)}>I stored it offline</button>
          </div>
        )}
        {!s ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <>
            <div className="rounded border border-slate-700 p-4 text-sm">
              <div>Vault: {s.exists ? 'set up' : 'not set up'} · Mnemonics sealed: {s.sealed ? `yes (${s.sealed_names.length})` : 'no'}</div>
              <div>State: {s.unlocked ? `unlocked until ${s.expiresAt ? new Date(s.expiresAt).toLocaleString() : '?'}` : 'locked'}</div>
              {s.sealed && s.env_mnemonic_names.length > 0 && (
                <div className="mt-2 text-amber-300">Still in the environment (ignored, remove them): {s.env_mnemonic_names.join(', ')}</div>
              )}
              <div className="mt-2 text-gray-400">
                Address pool: {Object.keys(s.pool).length ? Object.entries(s.pool).map(([k, v]) => `${k} ${v}`).join(' · ') : 'empty'}
              </div>
            </div>
            <label className="block text-sm">
              Unlock for
              <select className="ml-2 rounded border border-slate-700 bg-slate-950 px-2 py-1" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
                {[1, 24, 72, 168].map((h) => <option key={h} value={h}>{h === 168 ? '7 days (max)' : `${h} h`}</option>)}
              </select>
            </label>
            {!s.exists ? (
              <div className="space-y-3 rounded border border-slate-700 p-4">
                <div className="font-semibold text-white">Set up (seals the SYSTEM_MNEMONIC_* in this server&apos;s environment)</div>
                <input type="password" className={input} placeholder="Operator passphrase" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
                <input type="password" className={input} placeholder="Repeat" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
                <button className={button} disabled={busy} onClick={onSetup}>{busy ? 'Sealing…' : 'Create, seal and unlock'}</button>
              </div>
            ) : s.unlocked ? (
              <button className={button} disabled={busy} onClick={onLock}>Lock now</button>
            ) : (
              <div className="space-y-3 rounded border border-slate-700 p-4">
                {useRecovery ? (
                  <input className={input} placeholder="Recovery key" value={recovery} onChange={(e) => setRecovery(e.target.value)} />
                ) : (
                  <input type="password" className={input} placeholder="Operator passphrase" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
                )}
                <div className="flex gap-4">
                  <button className={button} disabled={busy} onClick={onUnlock}>{busy ? 'Unlocking…' : 'Unlock'}</button>
                  <button className="text-sm text-purple-300 hover:underline" onClick={() => setUseRecovery((v) => !v)}>
                    {useRecovery ? 'Use the passphrase' : 'Use the recovery key'}
                  </button>
                </div>
              </div>
            )}
            <p className="text-xs text-gray-500">CLI: <code>COINPAY_URL=https://coinpayportal.com COINPAY_ADMIN_TOKEN=… npx tsx scripts/operator-vault-unlock.mts</code></p>
          </>
        )}
      </div>
    </div>
  );
}
