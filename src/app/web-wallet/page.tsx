'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWebWallet } from '@/components/web-wallet/WalletContext';
import { WalletHeader } from '@/components/web-wallet/WalletHeader';
import { BalanceCard } from '@/components/web-wallet/BalanceCard';
import { AssetList, type AssetItem } from '@/components/web-wallet/AssetList';
import {
  TransactionList,
  type TransactionItem,
} from '@/components/web-wallet/TransactionList';
import type { WalletChain } from '@/lib/web-wallet/identity';

export default function WebWalletPage() {
  const router = useRouter();
  const { hasWallet, isUnlocked, isLoading, wallet } = useWebWallet();

  // Redirect to appropriate page
  useEffect(() => {
    if (isLoading) return;
    if (!hasWallet) return; // Show landing
    if (!isUnlocked) {
      router.replace('/web-wallet/unlock');
    }
  }, [hasWallet, isUnlocked, isLoading, router]);

  // Show landing page if no wallet
  if (!isLoading && !hasWallet) {
    return <LandingView />;
  }

  // Show loading
  if (isLoading || !isUnlocked) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
      </div>
    );
  }

  return <DashboardView />;
}

function LandingView() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center space-y-8">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-purple-600 to-pink-600">
          <svg
            className="h-10 w-10 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3"
            />
          </svg>
        </div>

        <div>
          <h1 className="text-3xl font-bold text-white">CoinPay Wallet</h1>
          <p className="mt-2 text-gray-400">
            Non-custodial multi-chain wallet. Your keys, your crypto.
          </p>
        </div>

        <div className="space-y-3">
          <Link
            href="/web-wallet/create"
            className="block w-full rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors"
          >
            Create New Wallet
          </Link>
          <Link
            href="/web-wallet/import"
            className="block w-full rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-medium text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            Import Existing Wallet
          </Link>
        </div>

        <div className="space-y-2 text-xs text-gray-400">
          <p>No email. No KYC. No tracking.</p>
          <p>Your seed phrase is your identity.</p>
        </div>
      </div>
    </div>
  );
}

function DashboardView() {
  const { wallet, chains } = useWebWallet();
  const [totalUsd, setTotalUsd] = useState(0);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(true);
  const [loadingTx, setLoadingTx] = useState(true);
  const [isDeriving, setIsDeriving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!wallet) return;

    // Fetch balances
    try {
      setLoadingBalances(true);
      const balanceData = await wallet.getTotalBalanceUSD();
      setTotalUsd(balanceData.totalUsd);
      setAssets(
        balanceData.balances.map((b) => ({
          chain: b.chain,
          address: b.address,
          balance: b.balance,
          usdValue: b.usdValue,
        }))
      );
    } catch (err) {
      console.error('Failed to fetch balances:', err);
      setAssets([]);
    } finally {
      setLoadingBalances(false);
    }

    // Fetch recent transactions
    try {
      setLoadingTx(true);
      const txData = await wallet.getTransactions({ limit: 5 });
      setTransactions(
        txData.transactions.map((tx) => ({
          id: tx.id,
          txHash: tx.txHash || tx.id,
          chain: tx.chain,
          type: tx.direction === 'outgoing' ? 'send' as const : 'receive' as const,
          amount: tx.amount,
          status: (tx.status === 'confirming' ? 'pending' : tx.status) as 'pending' | 'confirmed' | 'failed',
          fromAddress: tx.fromAddress,
          toAddress: tx.toAddress,
          createdAt: tx.createdAt,
        }))
      );
    } catch (err) {
      console.error('Failed to fetch recent transactions:', err);
      setTransactions([]);
    } finally {
      setLoadingTx(false);
    }
  }, [wallet]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDeriveAll = useCallback(async () => {
    if (!wallet || isDeriving) return;
    setIsDeriving(true);
    try {
      const walletChains = chains.length > 0 ? chains : ['BTC', 'BCH', 'ETH', 'POL', 'SOL'];
      for (const chain of walletChains) {
        try {
          await wallet.deriveAddress(chain as WalletChain);
        } catch (err) {
          console.error(`Failed to derive address for ${chain}:`, err);
          // May already exist or fail for individual chains — continue
        }
      }
      await fetchData();
    } catch (err) {
      console.error('Failed during derive-all:', err);
    } finally {
      setIsDeriving(false);
    }
  }, [wallet, chains, isDeriving, fetchData]);

  return (
    <>
      <WalletHeader />
      <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        <BalanceCard totalUsd={totalUsd} isLoading={loadingBalances} />

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Link
            href="/web-wallet/send"
            className="flex flex-col items-center gap-1.5 sm:gap-2 rounded-xl border border-white/5 bg-white/5 p-3 sm:p-4 hover:bg-white/10 transition-colors"
          >
            <span className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-purple-600/20 text-purple-400">
              &uarr;
            </span>
            <span className="text-xs sm:text-sm text-gray-300">Send</span>
          </Link>
          <Link
            href="/web-wallet/receive"
            className="flex flex-col items-center gap-1.5 sm:gap-2 rounded-xl border border-white/5 bg-white/5 p-3 sm:p-4 hover:bg-white/10 transition-colors"
          >
            <span className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-green-600/20 text-green-400">
              &darr;
            </span>
            <span className="text-xs sm:text-sm text-gray-300">Receive</span>
          </Link>
          <Link
            href="/web-wallet/history"
            className="flex flex-col items-center gap-1.5 sm:gap-2 rounded-xl border border-white/5 bg-white/5 p-3 sm:p-4 hover:bg-white/10 transition-colors"
          >
            <span className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-blue-600/20 text-blue-400">
              &#x2630;
            </span>
            <span className="text-xs sm:text-sm text-gray-300">History</span>
          </Link>
        </div>

        {/* Assets */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Assets</h2>
            <button
              onClick={fetchData}
              className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
            >
              Refresh
            </button>
          </div>
          <AssetList assets={assets} isLoading={loadingBalances} onDeriveAll={handleDeriveAll} isDeriving={isDeriving} />
        </section>

        {/* Recent Transactions */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              Recent Transactions
            </h2>
            <Link
              href="/web-wallet/history"
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              View all
            </Link>
          </div>
          <TransactionList
            transactions={transactions}
            isLoading={loadingTx}
            emptyMessage="No transactions yet. Send or receive crypto to get started."
          />
        </section>
      </div>
    </>
  );
}
