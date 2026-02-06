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
import { SwapForm } from '@/components/web-wallet/SwapForm';
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

type TabType = 'assets' | 'swap';

function DashboardView() {
  const router = useRouter();
  const { wallet, chains } = useWebWallet();
  const [activeTab, setActiveTab] = useState<TabType>('assets');
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
      const CHAIN_ORDER: Record<string, number> = {
        BTC: 0, ETH: 1, SOL: 2, POL: 3, BCH: 4,
        USDC_ETH: 5, USDC_SOL: 6, USDC_POL: 7,
      };
      const sorted = balanceData.balances
        .map((b) => ({
          chain: b.chain,
          address: b.address,
          balance: b.balance,
          usdValue: b.usdValue,
        }))
        .sort((a, b) => (CHAIN_ORDER[a.chain] ?? 99) - (CHAIN_ORDER[b.chain] ?? 99));
      setAssets(sorted);
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
      const walletChains = chains.length > 0 ? chains : [
        'BTC', 'BCH', 'ETH', 'POL', 'SOL',
        'DOGE', 'XRP', 'ADA', 'BNB',
        'USDT', 'USDC',
        'USDC_ETH', 'USDC_POL', 'USDC_SOL',
      ];
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

  // Build address and balance maps for swap form
  const addressMap: Record<string, string> = {};
  const balanceMap: Record<string, { balance: string; usdValue?: number }> = {};
  assets.forEach((asset) => {
    addressMap[asset.chain] = asset.address;
    balanceMap[asset.chain] = { balance: asset.balance, usdValue: asset.usdValue };
  });

  return (
    <>
      <WalletHeader />
      <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        <BalanceCard totalUsd={totalUsd} isLoading={loadingBalances} />

        {/* Tab Navigation */}
        <div className="flex gap-2 border-b border-white/10 pb-2">
          <button
            onClick={() => setActiveTab('assets')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === 'assets'
                ? 'text-white bg-white/10'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Assets
          </button>
          <button
            onClick={() => setActiveTab('swap')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-2 ${
              activeTab === 'swap'
                ? 'text-white bg-white/10'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
            Swap
          </button>
        </div>

        {activeTab === 'assets' && (
          <>
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
              <AssetList
                assets={assets}
                isLoading={loadingBalances}
                onSelect={(asset) => router.push(`/web-wallet/asset/${asset.chain}`)}
                onDeriveAll={handleDeriveAll}
                isDeriving={isDeriving}
              />
            </section>

            {/* Recent Transactions */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">
                  Recent Transactions
                </h2>
                <button
                  onClick={fetchData}
                  className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
                >
                  Refresh
                </button>
              </div>
              <TransactionList
                transactions={transactions}
                isLoading={loadingTx}
                emptyMessage="No transactions yet. Send or receive crypto to get started."
              />
            </section>
          </>
        )}

        {activeTab === 'swap' && (
          <section>
            <div className="max-w-md mx-auto">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-white">Swap Coins</h2>
                <p className="text-sm text-gray-400">
                  Exchange crypto instantly. No KYC required.
                </p>
              </div>
              <SwapForm 
                addresses={addressMap}
                balances={balanceMap}
                onSwapCreated={(swap) => {
                  console.log('Swap created:', swap);
                }}
              />
            </div>
          </section>
        )}
      </div>
    </>
  );
}
