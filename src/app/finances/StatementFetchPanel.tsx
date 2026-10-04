'use client';

import { useCallback, useEffect, useState } from 'react';

type Cell = { month: string; statementId: string | null; state: 'have' | 'missing' | 'open' };
type AccountCoverage = { accountId: string; accountName: string; institutionKey: string; institutionLabel: string | null; months: Cell[]; missing: number };
type Run = {
  id: string;
  institutionKey: string;
  institutionLabel: string | null;
  status: 'ok' | 'login_needed' | 'no_statements' | 'error';
  filed: number;
  duplicates: number;
  unmatched: number;
  message: string | null;
  client: string | null;
  finishedAt: string;
};
type Coverage = { months: string[]; accounts: AccountCoverage[]; missing: number; fetchers: Run[] };

const STATUS: Record<Run['status'], { label: string; tone: string }> = {
  ok: { label: 'fetched', tone: 'border-emerald-500/40 text-emerald-300' },
  login_needed: { label: 'needs sign-in', tone: 'border-amber-500/40 text-amber-300' },
  no_statements: { label: 'no statements found', tone: 'border-amber-500/40 text-amber-300' },
  error: { label: 'failed', tone: 'border-red-500/40 text-red-300' },
};

const CELL: Record<Cell['state'], string> = {
  have: 'bg-emerald-500/70',
  missing: 'bg-slate-700',
  open: 'border border-slate-600',
};

function ago(iso: string): string {
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (hours < 1) return 'just now';
  return hours < 48 ? `${Math.round(hours)}h ago` : `${Math.round(hours / 24)}d ago`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
}

/**
 * Statements from the banks: which account-months have a statement, and
 * what each bank's last automatic fetch said. The fetching itself runs on the
 * merchant's machine (`coinpay finances statements fetch`), because the bank
 * sessions live in a local browser profile CoinPay never holds.
 */
export default function StatementFetchPanel({ authHeaders, refreshKey }: { authHeaders: () => HeadersInit; refreshKey: number }) {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/finances/statements/coverage?months=12', { headers: authHeaders(), cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setCoverage(await res.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (failed) return null;
  if (!coverage) return <div className="mt-4 text-xs text-gray-500">Loading statement coverage…</div>;

  const needsYou = coverage.fetchers.filter((r) => r.status !== 'ok');
  const firstBank = coverage.accounts[0]?.institutionKey ?? 'chase';

  return (
    <div className="mt-4 rounded border border-slate-800 bg-slate-950/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-200">From your banks</h3>
        <span className="text-xs text-gray-500">
          {coverage.missing === 0 ? 'Every closed month has a statement' : `${coverage.missing} account-month${coverage.missing === 1 ? '' : 's'} missing`} · last 12 months
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        SimpleFIN supplies transactions, not the PDFs. The CoinPay CLI downloads each bank&apos;s statements on your computer and files them here. You sign in to each bank once there; CoinPay never sees the bank session.
      </p>

      {coverage.fetchers.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {coverage.fetchers.map((r) => (
            <span
              key={r.id}
              title={r.message ?? undefined}
              className={`rounded border px-2 py-1 text-xs ${STATUS[r.status].tone}`}
            >
              {r.institutionLabel || r.institutionKey}: {STATUS[r.status].label} {ago(r.finishedAt)}
              {r.status === 'ok' && r.filed > 0 ? ` · ${r.filed} new` : ''}
              {r.unmatched > 0 ? ` · ${r.unmatched} to file by hand` : ''}
            </span>
          ))}
        </div>
      )}

      {coverage.accounts.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="text-xs text-gray-300">
            <thead>
              <tr>
                <th className="pr-3 text-left font-normal text-gray-500">Account</th>
                {coverage.months.map((m) => (
                  <th key={m} className="w-6 text-center font-normal text-gray-500" title={m}>
                    {monthLabel(m).slice(0, 1)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {coverage.accounts.map((a) => (
                <tr key={a.accountId}>
                  <td className="whitespace-nowrap pr-3 py-0.5">
                    {a.accountName} <span className="text-gray-500">· {a.institutionLabel || a.institutionKey}</span>
                  </td>
                  {a.months.map((cell) => (
                    <td key={cell.month} className="py-0.5 text-center">
                      <span
                        className={`inline-block h-3 w-3 rounded-sm ${CELL[cell.state]}`}
                        title={`${cell.month}: ${cell.state === 'have' ? 'statement on file' : cell.state === 'open' ? 'this month, not issued yet' : 'missing'}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 rounded bg-black/30 p-3 font-mono text-[11px] leading-5 text-gray-300">
        {coverage.fetchers.length === 0 || needsYou.some((r) => r.status === 'login_needed') ? (
          <div>
            <span className="text-gray-500"># once per bank, in a window:</span>
            <br />
            coinpay finances statements login {needsYou.find((r) => r.status === 'login_needed')?.institutionKey ?? firstBank}
          </div>
        ) : null}
        <div>
          <span className="text-gray-500"># every new statement, from every signed-in bank:</span>
          <br />
          coinpay finances statements fetch
        </div>
        <div>
          <span className="text-gray-500"># weekly, unattended (exits 3 when a bank needs you):</span>
          <br />
          (crontab -l; echo &apos;30 7 * * 1 coinpay finances statements fetch&apos;) | crontab -
        </div>
      </div>
    </div>
  );
}
