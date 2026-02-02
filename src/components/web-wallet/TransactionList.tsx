'use client';

import Link from 'next/link';
import { ChainBadge } from './AddressDisplay';

export interface TransactionItem {
  id: string;
  txHash: string;
  chain: string;
  type: 'send' | 'receive';
  amount: string;
  status: 'pending' | 'confirmed' | 'failed';
  fromAddress?: string;
  toAddress?: string;
  createdAt: string;
}

interface TransactionListProps {
  transactions: TransactionItem[];
  isLoading?: boolean;
  emptyMessage?: string;
}

export function TransactionList({
  transactions,
  isLoading,
  emptyMessage = 'No transactions yet',
}: TransactionListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/5 p-4 animate-pulse"
          >
            <div className="h-8 w-8 rounded-full bg-white/10" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-32 rounded bg-white/10" />
              <div className="h-3 w-48 rounded bg-white/10" />
            </div>
            <div className="h-4 w-20 rounded bg-white/10" />
          </div>
        ))}
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="rounded-xl border border-white/5 bg-white/5 p-8 text-center">
        <p className="text-sm text-gray-400">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {transactions.map((tx) => (
        <Link
          key={tx.id}
          href={`/web-wallet/tx/${tx.txHash}`}
          className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/5 p-4 hover:bg-white/10 transition-colors"
        >
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full ${
              tx.type === 'send'
                ? 'bg-red-500/10 text-red-400'
                : 'bg-green-500/10 text-green-400'
            }`}
          >
            {tx.type === 'send' ? '\u2191' : '\u2193'}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-white capitalize">
                {tx.type}
              </p>
              <ChainBadge chain={tx.chain} />
              <StatusBadge status={tx.status} />
            </div>
            <p className="truncate text-xs text-gray-400 font-mono">
              {tx.type === 'send'
                ? `To: ${tx.toAddress?.slice(0, 10)}...`
                : `From: ${tx.fromAddress?.slice(0, 10)}...`}
            </p>
          </div>

          <div className="text-right">
            <p
              className={`text-sm font-medium ${
                tx.type === 'send' ? 'text-red-400' : 'text-green-400'
              }`}
            >
              {tx.type === 'send' ? '-' : '+'}
              {tx.amount}
            </p>
            <p className="text-xs text-gray-400">
              {formatRelativeTime(tx.createdAt)}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-yellow-500/10 text-yellow-400',
    confirmed: 'bg-green-500/10 text-green-400',
    failed: 'bg-red-500/10 text-red-400',
  };

  return (
    <span
      className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
        styles[status] || styles.pending
      }`}
    >
      {status}
    </span>
  );
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}
