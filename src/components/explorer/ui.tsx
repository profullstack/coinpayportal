/**
 * Shared presentation pieces for the explorer pages.
 */

import Link from 'next/link';
import type { ExplorerTransaction } from '@/lib/explorer';

/** Shorten a hash or address for display, keeping both ends recognisable. */
export function truncate(value: string, lead = 10, tail = 8): string {
  if (!value) return '';
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

export function SearchForm({ defaultValue = '' }: { defaultValue?: string }) {
  return (
    <form action="/explorer" method="get" className="w-full">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          name="q"
          defaultValue={defaultValue}
          placeholder="Address, transaction hash, or block height"
          aria-label="Search the blockchain"
          className="flex-1 rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-500"
        >
          Search
        </button>
      </div>
    </form>
  );
}

export function StatusPill({ status }: { status: ExplorerTransaction['status'] }) {
  const styles = {
    confirmed: 'bg-green-900/40 text-green-300 border-green-500/40',
    pending: 'bg-yellow-900/40 text-yellow-300 border-yellow-500/40',
    failed: 'bg-red-900/40 text-red-300 border-red-500/40',
  }[status];
  return (
    <span className={`rounded border px-2 py-0.5 text-xs font-medium ${styles}`}>{status}</span>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-gray-800 py-3 sm:grid sm:grid-cols-4 sm:gap-4">
      <dt className="text-sm text-gray-400">{label}</dt>
      <dd className="mt-1 break-all text-sm text-white sm:col-span-3 sm:mt-0">{children}</dd>
    </div>
  );
}

/** A compact transaction row, used on address and block pages. */
export function TxRow({ tx, symbol }: { tx: ExplorerTransaction; symbol: string }) {
  return (
    <li className="border-b border-gray-800 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/explorer/${tx.chainId}/tx/${tx.hash}`}
          className="font-mono text-sm text-blue-400 hover:text-blue-300"
        >
          {truncate(tx.hash, 16, 10)}
        </Link>
        <div className="flex items-center gap-3">
          {tx.amount !== '' && (
            <span className="text-sm text-white">
              {tx.amount} {symbol}
            </span>
          )}
          <StatusPill status={tx.status} />
        </div>
      </div>
      <div className="mt-1 text-xs text-gray-500">
        {tx.blockHeight !== null ? `Block ${tx.blockHeight.toLocaleString()}` : 'Unconfirmed'}
        {tx.timestamp ? ` · ${formatTime(tx.timestamp)}` : ''}
      </div>
    </li>
  );
}
