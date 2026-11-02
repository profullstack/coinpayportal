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
  solana_fee_payer?: string | null;
  unlocked: boolean;
  expiresAt: string | null;
}

interface Retired {
  retired_vault: string;
  retired_at: string;
  record: VaultRecord;
  values: number;
}

/**
 * CoinPay's own SYSTEM_MNEMONIC_* sealed to an operator passphrase. All
 * cryptography runs in this browser; the server gets vault records
 * (ciphertext) and data keys. Never a passphrase.
 */
export default function OperatorVaultContent() {
  const router = useRouter();
  const [s, setS] = useState<Status | null>(null);
  const [retired, setRetired] = useState<Retired[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newConfirm, setNewConfirm] = useState('');
  const [oldPass, setOldPass] = useState('');
  const [recovery, setRecovery] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [ttl, setTtl] = useState(168);
  const [shownRecovery, setShownRecovery] = useState<string | null>(null);
  // An operator typing a long passphrase twice needs to see what they typed.
  const [show, setShow] = useState(false);
  const kind = show ? 'text' : 'password';
  const eye = (
    <button type="button" className="text-sm text-purple-300 hover:underline" aria-pressed={show} onClick={() => setShow((v) => !v)}>
      {show ? '🙈 Hide passphrase' : '👁 Show passphrase'}
    </button>
  );

  const load = useCallback(async () => {
    const r = await authFetch('/api/admin/operator-vault', {}, router);
    if (!r) return;
    if (!r.response.ok) return setError(r.data?.error || 'Could not load');
    setS(r.data as Status);
    const b = await authFetch('/api/admin/operator-vault/rekey-backups', {}, router);
    if (b?.response.ok) setRetired((b.data?.retired ?? []) as Retired[]);
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const post = async (url: string, body: unknown) => {
    const r = await authFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, router);
    if (!r) throw new Error('Your session expired: sign in again');
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
      const msg = err instanceof Error ? err.message : 'Failed';
      setError(/Wrong key/i.test(msg) ? 'Wrong passphrase' : msg);
    } finally {
      setBusy(false);
    }
  };

  /** The current vault's data key from the passphrase (or recovery key) typed in this browser. */
  const currentDek = async () =>
    useRecovery ? unwrapDekWithRecovery(s!.record!, recovery, 'operator', s!.subject_id) : unwrapDek(s!.record!, pass, 'operator', s!.subject_id);

  const checkNew = (a: string, b: string) => {
    if (a.length < MIN_PASSPHRASE_LENGTH) throw new Error(`Use at least ${MIN_PASSPHRASE_LENGTH} characters`);
    if (a !== b) throw new Error('The passphrases do not match');
  };

  const onSetup = () =>
    run(async () => {
      checkNew(pass, confirm);
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
        dek = await currentDek();
        await post('/api/admin/operator-vault/unlock', { data_key: bytesToBase64(dek), ttl_hours: ttl });
      } finally {
        wipe(dek);
      }
      setPass('');
      setRecovery('');
    });

  // Locking stops customer payments from forwarding, so it needs the passphrase.
  const onLock = () =>
    run(async () => {
      if (!window.confirm('Lock the operator keys? Payments stop forwarding until someone unlocks.')) return;
      let dek: Uint8Array | null = null;
      try {
        dek = await currentDek();
        await post('/api/admin/operator-vault/lock', { data_key: bytesToBase64(dek) });
      } finally {
        wipe(dek);
      }
      setPass('');
      setRecovery('');
    });

  // A fresh key pair and data key under a new passphrase; everything is re-sealed to it.
  const onRekey = () =>
    run(async () => {
      checkNew(newPass, newConfirm);
      const { record, dek, recoveryKey } = await createVault(newPass, 'operator', s!.subject_id);
      try {
        const out = await post('/api/admin/operator-vault/rekey', { record, data_key: bytesToBase64(dek) });
        setNotice(
          `Re-keyed: ${out.mnemonicBundles} mnemonic bundle, ${out.paymentKeys} deposit keys, ${out.poolKeys} pool keys moved to the new vault` +
            `${out.secondPass ? ` (+${out.secondPass} minted during the re-key)` : ''}. Still unlocked until ${new Date(out.expiresAt).toLocaleString()}. ` +
            'The old passphrase can still restore everything from the backup below until you drop it.',
        );
      } finally {
        wipe(dek);
      }
      setShownRecovery(recoveryKey);
      setNewPass('');
      setNewConfirm('');
    });

  const onRestore = (r: Retired) =>
    run(async () => {
      if (!window.confirm(`Restore ${r.retired_vault} with its OLD passphrase? The current vault is kept as a retired vault.`)) return;
      let dek: Uint8Array | null = null;
      try {
        dek = await unwrapDek(r.record, oldPass, 'operator', s!.subject_id);
        const out = await post('/api/admin/operator-vault/rekey-backups', { action: 'restore', retired_vault: r.retired_vault, data_key: bytesToBase64(dek) });
        setNotice(`Restored ${out.restored} values with the old passphrase. Unlock with the OLD passphrase to resume.`);
      } finally {
        wipe(dek);
      }
      setOldPass('');
    });

  const onDrop = (r: Retired) =>
    run(async () => {
      if (!window.confirm(`Drop ${r.retired_vault}? After this the OLD passphrase can no longer restore anything.`)) return;
      let dek: Uint8Array | null = null;
      try {
        dek = await currentDek();
        await post('/api/admin/operator-vault/rekey-backups', { action: 'drop', retired_vault: r.retired_vault, data_key: bytesToBase64(dek) });
        setNotice('Backup dropped. Only the current passphrase (and its recovery key) open the operator keys now.');
      } finally {
        wipe(dek);
      }
      setPass('');
      setRecovery('');
    });

  const input = 'w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white';
  const button = 'rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50';
  const card = 'space-y-3 rounded border border-slate-700 p-4';

  const currentSecretInput = (
    <>
      {useRecovery ? (
        <input className={input} placeholder="Recovery key" value={recovery} onChange={(e) => setRecovery(e.target.value)} />
      ) : (
        <input type={kind} className={input} placeholder="Current operator passphrase" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
      )}
      <div className="flex gap-4">
        {!useRecovery && eye}
        <button type="button" className="text-sm text-purple-300 hover:underline" onClick={() => setUseRecovery((v) => !v)}>
          {useRecovery ? 'Use the passphrase' : 'Use the recovery key'}
        </button>
      </div>
    </>
  );

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
            <p className="mt-1 text-xs text-purple-200/80">Write it down and keep it offline, away from where you keep anything about the passphrase.</p>
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
              {s.solana_fee_payer && (
                <div className="mt-2 text-gray-400">
                  Solana fee payer (send SOL here; pays fees and token-account rent on USDC/USDT forwards): <code className="break-all">{s.solana_fee_payer}</code>
                </div>
              )}
            </div>
            <label className="block text-sm">
              Unlock for
              <select className="ml-2 rounded border border-slate-700 bg-slate-950 px-2 py-1" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
                {[1, 24, 72, 168].map((h) => <option key={h} value={h}>{h === 168 ? '7 days (max)' : `${h} h`}</option>)}
              </select>
            </label>
            {!s.exists ? (
              <div className={card}>
                <div className="font-semibold text-white">Set up (seals the SYSTEM_MNEMONIC_* in this server&apos;s environment)</div>
                <input type={kind} className={input} placeholder="Operator passphrase" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
                <input type={kind} className={input} placeholder="Repeat" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
                {eye}
                {confirm && pass !== confirm && <p className="text-sm text-red-400">The two passphrases do not match.</p>}
                <button className={button} disabled={busy} onClick={onSetup}>{busy ? 'Sealing…' : 'Create, seal and unlock'}</button>
              </div>
            ) : s.unlocked ? (
              <>
                <div className={card}>
                  <div className="font-semibold text-white">Lock</div>
                  <p className="text-xs text-gray-400">Locking stops payment forwarding, so it needs the passphrase.</p>
                  {currentSecretInput}
                  <button className={button} disabled={busy} onClick={onLock}>{busy ? 'Locking…' : 'Lock now'}</button>
                </div>
                <div className={card}>
                  <div className="font-semibold text-white">Re-key with a new passphrase</div>
                  <p className="text-xs text-gray-400">
                    Use this if the passphrase may have leaked. A changed passphrase alone keeps the same keys; this makes a
                    brand-new vault (new key pair, new data key, new recovery key) and moves every sealed secret to it. The old
                    passphrase can still restore from the backup below until you drop it.
                  </p>
                  <input type={kind} className={input} placeholder={`New passphrase (${MIN_PASSPHRASE_LENGTH}+ characters; 5-6 random words)`} value={newPass} onChange={(e) => setNewPass(e.target.value)} autoComplete="new-password" />
                  <input type={kind} className={input} placeholder="Repeat the new passphrase" value={newConfirm} onChange={(e) => setNewConfirm(e.target.value)} autoComplete="new-password" />
                  {eye}
                  {newConfirm && newPass !== newConfirm && <p className="text-sm text-red-400">The two passphrases do not match.</p>}
                  <button className={button} disabled={busy} onClick={onRekey}>{busy ? 'Re-keying… (do not close this page)' : 'Re-key'}</button>
                </div>
              </>
            ) : (
              <div className={card}>
                {currentSecretInput}
                <button className={button} disabled={busy} onClick={onUnlock}>{busy ? 'Unlocking…' : 'Unlock'}</button>
              </div>
            )}
            {retired.length > 0 && (
              <div className={card}>
                <div className="font-semibold text-white">Old-passphrase backups</div>
                <p className="text-xs text-gray-400">
                  Each re-key keeps the previous vault and its sealed values. If you are ever locked out of the current vault,
                  its OLD passphrase restores everything. While a backup exists, that old passphrase still opens it: drop it
                  once the new passphrase is proven.
                </p>
                <input type={kind} className={input} placeholder="Old passphrase (to restore)" value={oldPass} onChange={(e) => setOldPass(e.target.value)} autoComplete="off" />
                {retired.map((r) => (
                  <div key={r.retired_vault} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 p-3 text-sm">
                    <div>
                      <div className="font-mono text-xs">{r.retired_vault}</div>
                      <div className="text-gray-400">{r.values} values backed up</div>
                    </div>
                    <div className="flex gap-2">
                      <button className={button} disabled={busy || !oldPass} onClick={() => onRestore(r)}>Restore with old passphrase</button>
                      <button
                        className="rounded border border-red-500/50 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                        disabled={busy || !s.exists}
                        onClick={() => onDrop(r)}
                        title="Needs the CURRENT passphrase (above)"
                      >
                        Drop backup
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-500">CLI: <code>COINPAY_URL=https://coinpayportal.com COINPAY_ADMIN_TOKEN=… npx tsx scripts/operator-vault-unlock.mts [--lock]</code></p>
          </>
        )}
      </div>
    </div>
  );
}
