'use client';

import { useEffect, useState } from 'react';
import { statementPage } from '@/lib/finances/statement-pages';

type Bank = { key: string; name: string; kind?: 'bank' | 'tax' | 'brokerage'; url: string | null; accounts: string[] };

/**
 * Where to download each linked bank's statements by hand, and how. For every
 * plan: the cloud and CLI fetchers are the automatic path, this is the one
 * that always works. The PDF then goes through the import form below.
 */
export default function BankStatementLinks({ authHeaders }: { authHeaders: () => HeadersInit }) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/finances/statements/cloud', { headers: authHeaders(), cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setBanks(data.banks ?? []);
      } catch {
        // The section stays hidden when the route is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authHeaders]);

  if (banks.length === 0) return null;

  return (
    <div className="mt-4 rounded border border-slate-800 bg-slate-950/40 p-4">
      <h3 className="text-sm font-semibold text-gray-200">Download by hand</h3>
      <p className="mt-1 text-xs text-gray-500">
        Each link opens the bank&apos;s own statements page; sign in there if asked. Download the PDF for the month you need, then import it below: pick the account, the month it covers, and the file.
      </p>
      <ul className="mt-3 space-y-1">
        {banks.map((bank) => {
          const page = statementPage(bank);
          const expanded = open === bank.key;
          return (
            <li key={bank.key} className="rounded border border-slate-800 p-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-gray-200">
                  {bank.name}
                  {bank.accounts.length > 0 && <span className="text-gray-500"> · {bank.accounts.length} account{bank.accounts.length === 1 ? '' : 's'}</span>}
                </span>
                <span className="flex gap-1">
                  <button type="button" onClick={() => setOpen(expanded ? null : bank.key)} className="rounded border border-slate-700 px-2 py-1 text-gray-400">
                    {expanded ? 'Hide steps' : 'Steps'}
                  </button>
                  {page.url && (
                    <a href={page.url} target="_blank" rel="noopener noreferrer" className="rounded border border-emerald-500/40 px-2 py-1 text-emerald-300">
                      {page.label} ↗
                    </a>
                  )}
                </span>
              </div>
              {expanded && <p className="mt-2 text-gray-400">{page.steps}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
