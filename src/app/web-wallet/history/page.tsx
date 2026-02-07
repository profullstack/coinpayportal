'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWebWallet } from '@/components/web-wallet/WalletContext';
import { WalletHeader } from '@/components/web-wallet/WalletHeader';
import {
  TransactionList,
  type TransactionItem,
} from '@/components/web-wallet/TransactionList';
import type { WalletChain } from '@/lib/web-wallet/identity';

const CHAINS = [
  { value: '', label: 'All Chains' },
  { value: 'BTC', label: 'Bitcoin (BTC)' },
  { value: 'BCH', label: 'Bitcoin Cash (BCH)' },
  { value: 'ETH', label: 'Ethereum (ETH)' },
  { value: 'POL', label: 'Polygon (POL)' },
  { value: 'SOL', label: 'Solana (SOL)' },
  { value: 'BNB', label: 'BNB Chain' },
  { value: 'DOGE', label: 'Dogecoin (DOGE)' },
  { value: 'XRP', label: 'XRP' },
  { value: 'ADA', label: 'Cardano (ADA)' },
  { value: 'USDC_ETH', label: 'USDC (Ethereum)' },
  { value: 'USDC_POL', label: 'USDC (Polygon)' },
  { value: 'USDC_SOL', label: 'USDC (Solana)' },
];

const DIRECTIONS = [
  { value: '', label: 'All Types' },
  { value: 'incoming', label: 'Received' },
  { value: 'outgoing', label: 'Sent' },
];

const STATUSES = [
  { value: '', label: 'All Status' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirming', label: 'Confirming' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'failed', label: 'Failed' },
];

const PAGE_SIZE = 20;

interface Filters {
  chain: string;
  direction: string;
  status: string;
  fromDate: string;
  toDate: string;
}

export default function HistoryPage() {
  const router = useRouter();
  const { hasWallet, isUnlocked, isLoading: walletLoading, wallet } = useWebWallet();

  // Redirect to appropriate page
  useEffect(() => {
    if (walletLoading) return;
    if (!hasWallet) {
      router.replace('/web-wallet');
      return;
    }
    if (!isUnlocked) {
      router.replace('/web-wallet/unlock');
    }
  }, [hasWallet, isUnlocked, walletLoading, router]);

  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    chain: '',
    direction: '',
    status: '',
    fromDate: '',
    toDate: '',
  });
  const [showFilters, setShowFilters] = useState(false);

  const fetchTransactions = useCallback(async () => {
    if (!wallet) return;

    setLoading(true);
    try {
      const options: Record<string, string | number> = {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      };

      if (filters.chain) options.chain = filters.chain;
      if (filters.direction) options.direction = filters.direction;
      if (filters.status) options.status = filters.status;
      if (filters.fromDate) options.from_date = filters.fromDate;
      if (filters.toDate) options.to_date = filters.toDate;

      const data = await wallet.getTransactions(options);

      setTransactions(
        data.transactions.map((tx: any) => ({
          id: tx.id,
          txHash: tx.txHash || tx.tx_hash || tx.id,
          chain: tx.chain,
          type: tx.direction === 'outgoing' ? 'send' as const : 'receive' as const,
          amount: tx.amount,
          status: (tx.status === 'confirming' ? 'pending' : tx.status) as 'pending' | 'confirmed' | 'failed',
          fromAddress: tx.fromAddress || tx.from_address,
          toAddress: tx.toAddress || tx.to_address,
          createdAt: tx.createdAt || tx.created_at,
        }))
      );
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [wallet, page, filters]);

  useEffect(() => {
    if (wallet && isUnlocked) {
      fetchTransactions();
    }
  }, [wallet, isUnlocked, fetchTransactions]);

  const handleSync = async () => {
    if (!wallet || syncing) return;

    setSyncing(true);
    try {
      await wallet.syncHistory((filters.chain || undefined) as WalletChain | undefined);
      // Refetch after sync
      await fetchTransactions();
    } catch (err) {
      console.error('Failed to sync history:', err);
    } finally {
      setSyncing(false);
    }
  };

  const handleFilterChange = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0); // Reset to first page on filter change
  };

  const clearFilters = () => {
    setFilters({
      chain: '',
      direction: '',
      status: '',
      fromDate: '',
      toDate: '',
    });
    setPage(0);
  };

  const hasActiveFilters = Object.values(filters).some((v) => v !== '');
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Show loading while checking wallet state
  if (walletLoading || !isUnlocked) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      <WalletHeader />
      <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/web-wallet"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-white">Transaction History</h1>
              <p className="text-sm text-gray-400">
                {total > 0 ? `${total} transaction${total !== 1 ? 's' : ''}` : 'No transactions yet'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                showFilters || hasActiveFilters
                  ? 'border-purple-500 bg-purple-500/10 text-purple-400'
                  : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filters
              {hasActiveFilters && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-500 text-xs text-white">
                  {Object.values(filters).filter((v) => v !== '').length}
                </span>
              )}
            </button>

            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg
                className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {syncing ? 'Syncing...' : 'Sync'}
            </button>
          </div>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Chain Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Chain</label>
                <select
                  value={filters.chain}
                  onChange={(e) => handleFilterChange('chain', e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none"
                >
                  {CHAINS.map((chain) => (
                    <option key={chain.value} value={chain.value} className="bg-gray-900">
                      {chain.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Direction Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Type</label>
                <select
                  value={filters.direction}
                  onChange={(e) => handleFilterChange('direction', e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none"
                >
                  {DIRECTIONS.map((dir) => (
                    <option key={dir.value} value={dir.value} className="bg-gray-900">
                      {dir.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Status</label>
                <select
                  value={filters.status}
                  onChange={(e) => handleFilterChange('status', e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none"
                >
                  {STATUSES.map((status) => (
                    <option key={status.value} value={status.value} className="bg-gray-900">
                      {status.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* From Date */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">From Date</label>
                <input
                  type="date"
                  value={filters.fromDate}
                  onChange={(e) => handleFilterChange('fromDate', e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none [color-scheme:dark]"
                />
              </div>

              {/* To Date */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">To Date</label>
                <input
                  type="date"
                  value={filters.toDate}
                  onChange={(e) => handleFilterChange('toDate', e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none [color-scheme:dark]"
                />
              </div>

              {/* Clear Filters */}
              <div className="flex items-end">
                <button
                  onClick={clearFilters}
                  disabled={!hasActiveFilters}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-gray-400 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear Filters
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Transactions List */}
        <div>
          <TransactionList
            transactions={transactions}
            isLoading={loading}
            emptyMessage={
              hasActiveFilters
                ? 'No transactions match your filters.'
                : 'No transactions yet. Send or receive crypto to get started.'
            }
          />
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-white/10 pt-4">
            <div className="text-sm text-gray-400">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i;
                  } else if (page < 3) {
                    pageNum = i;
                  } else if (page > totalPages - 4) {
                    pageNum = totalPages - 5 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }

                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                        page === pageNum
                          ? 'bg-purple-600 text-white'
                          : 'border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {pageNum + 1}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Sync Info */}
        <div className="rounded-xl border border-white/5 bg-white/5 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10 text-blue-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-white">Sync On-Chain History</p>
              <p className="text-xs text-gray-400 mt-1">
                Click &quot;Sync&quot; to fetch transactions directly from the blockchain. This discovers deposits made to your addresses from external wallets or exchanges.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
