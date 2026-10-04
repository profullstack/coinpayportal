'use client';

import { useCallback, useEffect, useState } from 'react';

type CloudSession = {
  institutionKey: string;
  state: 'pending' | 'active' | 'login_needed' | 'disconnected';
  schedule: 'weekly' | 'off';
  nextFetchAt: string | null;
  lastLoginAt: string | null;
  lastFetchAt: string | null;
  lastStatus: string | null;
  keepalive?: boolean;
  lastTouchAt?: string | null;
  fetchedRows: number;
};
type Bank = { key: string; name: string; accounts: string[]; cloud: CloudSession | null };
type Access = { allowed: boolean; reason: string; message: string };

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (hours < 1) return 'just now';
  return hours < 48 ? `${Math.round(hours)}h ago` : `${Math.round(hours / 24)}d ago`;
}

/**
 * CoinPay cloud: connect a bank once through CoinPay's cloud browser and the
 * statements arrive on their own, weekly. Professional plan; free for admins.
 */
export default function CloudStatementsSection({ authHeaders, onChanged }: { authHeaders: () => HeadersInit; onChanged: () => void }) {
  const [access, setAccess] = useState<Access | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/finances/statements/cloud', { headers: authHeaders(), cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setAccess(data.access);
      setBanks(data.banks ?? []);
    } catch {
      // The section stays hidden when the route is unavailable.
    }
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const call = async (key: string, input: RequestInfo, init: RequestInit, done: (data: Record<string, unknown>) => void) => {
    setBusy(key);
    setMessage(null);
    try {
      const res = await fetch(input, { ...init, headers: { ...(authHeaders() as Record<string, string>), 'Content-Type': 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(data?.error?.message ?? 'That did not work');
      else done(data);
    } finally {
      setBusy(null);
      void load();
    }
  };

  const connect = (bank: Bank) =>
    call(bank.key, '/api/finances/statements/cloud/connect', { method: 'POST', body: JSON.stringify({ institutionKey: bank.key }) }, (data) => {
      // Built from the session id, never navigated to as a server-supplied URL.
      const id = String((data.live as { id?: unknown } | undefined)?.id ?? '');
      if (/^[A-Za-z0-9_-]{16,64}$/.test(id)) window.location.assign(`/finances/statements/connect/${id}`);
      else setMessage('The sign-in session did not start');
    });
  const fetchNow = (bank: Bank) =>
    call(bank.key, '/api/finances/statements/cloud/fetch', { method: 'POST', body: JSON.stringify({ institutionKey: bank.key }) }, () => {
      setMessage(`Fetching ${bank.name} statements in CoinPay cloud. New ones appear in the library as they land.`);
      onChanged();
    });
  const schedule = (bank: Bank, value: 'weekly' | 'off') =>
    call(bank.key, `/api/finances/statements/cloud/banks/${bank.key}`, { method: 'PATCH', body: JSON.stringify({ schedule: value }) }, () => undefined);
  const disconnect = (bank: Bank) => {
    if (!window.confirm(`Forget the saved ${bank.name} session? Imported statements stay.`)) return;
    void call(bank.key, `/api/finances/statements/cloud/banks/${bank.key}`, { method: 'DELETE' }, () => undefined);
  };

  if (!access || banks.length === 0) return null;

  return (
    <div className="mt-4 rounded border border-slate-800 bg-slate-950/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-200">CoinPay cloud</h3>
        <span className="text-xs text-gray-500">{access.message}</span>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Sign in to a bank once in CoinPay&apos;s browser and its statements arrive here every week, with nothing running on your computer. CoinPay keeps the session your bank issues (encrypted), never your password, and you can forget it at any time.
      </p>
      {!access.allowed ? (
        <a href="/pricing" className="mt-3 inline-block rounded border border-emerald-500/40 px-3 py-2 text-xs text-emerald-300">
          Upgrade to Professional
        </a>
      ) : (
        <div className="mt-3 space-y-2">
          {banks.map((bank) => {
            const cloud = bank.cloud;
            const state = !cloud ? 'not connected' : cloud.state === 'login_needed' ? 'needs sign-in' : cloud.state === 'active' ? 'connected' : cloud.state;
            const tone = !cloud ? 'text-gray-500' : cloud.state === 'active' ? 'text-emerald-300' : 'text-amber-300';
            return (
              <div key={bank.key} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 p-2">
                <div className="text-xs">
                  <span className="text-gray-200">{bank.name}</span> <span className={tone}>· {state}</span>
                  {cloud && (
                    <span className="text-gray-500">
                      {' '}
                      · last fetch {ago(cloud.lastFetchAt)}
                      {cloud.lastStatus ? ` (${cloud.lastStatus})` : ''}
                      {cloud.schedule === 'weekly' ? ' · weekly' : ' · schedule off'}
                      {cloud.state === 'active' && cloud.keepalive !== false ? ` · kept alive ${ago(cloud.lastTouchAt ?? null)}` : ''}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {(!cloud || cloud.state !== 'active') && (
                    <button type="button" disabled={busy !== null} onClick={() => void connect(bank)} className="rounded bg-emerald-600 px-2 py-1 text-xs text-white disabled:opacity-40">
                      {cloud ? 'Reconnect' : 'Connect'}
                    </button>
                  )}
                  {cloud?.state === 'active' && (
                    <button type="button" disabled={busy !== null} onClick={() => void fetchNow(bank)} className="rounded border border-slate-600 px-2 py-1 text-xs text-gray-200 disabled:opacity-40">
                      Fetch now
                    </button>
                  )}
                  {cloud && (
                    <>
                      <button type="button" disabled={busy !== null} onClick={() => void schedule(bank, cloud.schedule === 'weekly' ? 'off' : 'weekly')} className="rounded border border-slate-700 px-2 py-1 text-xs text-gray-400 disabled:opacity-40">
                        {cloud.schedule === 'weekly' ? 'Pause weekly' : 'Fetch weekly'}
                      </button>
                      <button type="button" disabled={busy !== null} onClick={() => disconnect(bank)} className="rounded border border-red-500/30 px-2 py-1 text-xs text-red-300 disabled:opacity-40">
                        Forget
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {message && <p className="mt-2 text-xs text-amber-300">{message}</p>}
    </div>
  );
}
