'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWebWallet } from '@/components/web-wallet/WalletContext';
import { WalletHeader } from '@/components/web-wallet/WalletHeader';
import { ChainSelector } from '@/components/web-wallet/ChainSelector';
import {
  TransactionList,
  type TransactionItem,
} from '@/components/web-wallet/TransactionList';

const PAGE_SIZE = 20;

export default function HistoryPage() {
  const router = useRouter();
  const { wallet, chains, isUnlocked } = useWebWallet();

  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [chain, setChain] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    if (!isUnlocked) {
      router.replace('/web-wallet/unlock');
    }
  }, [isUnlocked, router]);

  const fetchTransactions = useCallback(async () => {
    if (!wallet) return;
    setIsLoading(true);
    try {
      const opts: any = {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      };
      if (chain) opts.chain = chain;
      if (statusFilter) opts.status = statusFilter;
      if (dateFrom) opts.startDate = dateFrom;
      if (dateTo) opts.endDate = dateTo;

      const data = await wallet.getTransactions(opts);
      const mapped = data.transactions.map((tx: any): TransactionItem => ({
        id: tx.id,
        txHash: tx.txHash || tx.id,
        chain: tx.chain,
        type: tx.direction === 'outgoing' ? 'send' : 'receive',
        amount: tx.amount,
        status: (tx.status === 'confirming' ? 'pending' : tx.status) as 'pending' | 'confirmed' | 'failed',
        fromAddress: tx.fromAddress,
        toAddress: tx.toAddress,
        createdAt: tx.createdAt,
      }));

      if (page === 0) {
        setTransactions(mapped);
      } else {
        setTransactions((prev) => [...prev, ...mapped]);
      }
      setHasMore(mapped.length === PAGE_SIZE);
    } catch {
      if (page === 0) setTransactions([]);
    } finally {
      setIsLoading(false);
    }
  }, [wallet, chain, statusFilter, dateFrom, dateTo, page]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // Reset page on filter change
  useEffect(() => {
    setPage(0);
  }, [chain, statusFilter, dateFrom, dateTo]);

  return (
    <>
      <WalletHeader />
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-6">
          <Link
            href="/web-wallet"
            className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            &larr; Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-white">
            Transaction History
          </h1>
        </div>

        {/* Filters */}
        <div className="mb-6 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <ChainSelector
                value={chain}
                onChange={setChain}
                chains={chains}
                label="Chain"
              />
            </div>
            <div className="flex-1 space-y-2">
              <label htmlFor="status-filter" className="block text-sm font-medium text-gray-300">
                Status
              </label>
              <select
                id="status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 appearance-none"
              >
                <option value="" className="bg-slate-900">All</option>
                <option value="pending" className="bg-slate-900">Pending</option>
                <option value="confirmed" className="bg-slate-900">Confirmed</option>
                <option value="failed" className="bg-slate-900">Failed</option>
              </select>
            </div>
          </div>

          {/* Date range filter */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 space-y-2">
              <label htmlFor="date-from" className="block text-sm font-medium text-gray-300">
                From Date
              </label>
              <input
                id="date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 [color-scheme:dark]"
              />
            </div>
            <div className="flex-1 space-y-2">
              <label htmlFor="date-to" className="block text-sm font-medium text-gray-300">
                To Date
              </label>
              <input
                id="date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 [color-scheme:dark]"
              />
            </div>
            {(dateFrom || dateTo) && (
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                  }}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-400 hover:bg-white/10 transition-colors"
                  aria-label="Clear date filters"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>

        <TransactionList transactions={transactions} isLoading={isLoading && page === 0} />

        {hasMore && !isLoading && (
          <div className="mt-4 text-center">
            <button
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg bg-white/5 px-6 py-2 text-sm text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              Load more
            </button>
          </div>
        )}

        {isLoading && page > 0 && (
          <div className="mt-4 flex justify-center" aria-busy="true">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
          </div>
        )}
      </div>
    </>
  );
}
