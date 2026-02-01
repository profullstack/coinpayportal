'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWebWallet } from '@/components/web-wallet/WalletContext';
import { WalletHeader } from '@/components/web-wallet/WalletHeader';
import { ChainBadge, AddressDisplay } from '@/components/web-wallet/AddressDisplay';

interface TxDetail {
  id: string;
  txHash: string;
  chain: string;
  type: string;
  status: string;
  amount: string;
  fee: string;
  fromAddress: string;
  toAddress: string;
  blockHeight: number | null;
  confirmations: number;
  createdAt: string;
  confirmedAt: string | null;
}

export default function TransactionDetailPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = use(params);
  const router = useRouter();
  const { wallet, isUnlocked } = useWebWallet();
  const [tx, setTx] = useState<TxDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isUnlocked) {
      router.replace('/web-wallet/unlock');
    }
  }, [isUnlocked, router]);

  useEffect(() => {
    if (!wallet || !hash) return;

    const fetchTx = async () => {
      setIsLoading(true);
      try {
        const data = await wallet.getTransaction(hash);
        setTx({
          id: data.id,
          txHash: data.txHash || hash,
          chain: data.chain,
          type: data.direction === 'outgoing' ? 'send' : 'receive',
          status: data.status === 'confirming' ? 'pending' : data.status,
          amount: data.amount,
          fee: data.feeAmount || '0',
          fromAddress: data.fromAddress || '',
          toAddress: data.toAddress || '',
          blockHeight: data.blockNumber || null,
          confirmations: data.confirmations || 0,
          createdAt: data.createdAt,
          confirmedAt: data.blockTimestamp || null,
        });
      } catch (err: any) {
        setError(err.message || 'Failed to load transaction');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTx();
  }, [wallet, hash]);

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
    confirmed: 'bg-green-500/10 text-green-400 border-green-500/30',
    failed: 'bg-red-500/10 text-red-400 border-red-500/30',
  };

  return (
    <>
      <WalletHeader />
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="mb-6">
          <Link
            href="/web-wallet/history"
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            &larr; History
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-white">
            Transaction Details
          </h1>
        </div>

        {isLoading && (
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-white/5 animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {tx && !isLoading && (
          <div className="space-y-6">
            {/* Status header */}
            <div
              className={`rounded-xl border p-4 text-center ${
                statusColors[tx.status] || statusColors.pending
              }`}
            >
              <p className="text-lg font-semibold capitalize">{tx.status}</p>
              {tx.confirmations > 0 && (
                <p className="text-xs opacity-70">
                  {tx.confirmations} confirmation{tx.confirmations !== 1 ? 's' : ''}
                </p>
              )}
            </div>

            {/* Amount */}
            <div className="text-center">
              <p
                className={`text-3xl font-bold ${
                  tx.type === 'send' ? 'text-red-400' : 'text-green-400'
                }`}
              >
                {tx.type === 'send' ? '-' : '+'}
                {tx.amount}
              </p>
              <div className="mt-2 flex items-center justify-center gap-2">
                <ChainBadge chain={tx.chain} />
                <span className="text-sm text-gray-500 capitalize">{tx.type}</span>
              </div>
            </div>

            {/* Details */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
              {tx.fromAddress && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">From</p>
                  <AddressDisplay address={tx.fromAddress} truncate={false} />
                </div>
              )}

              {tx.toAddress && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">To</p>
                  <AddressDisplay address={tx.toAddress} truncate={false} />
                </div>
              )}

              <hr className="border-white/10" />

              <DetailRow label="Fee" value={tx.fee} />
              <DetailRow label="TX Hash" value={tx.txHash} mono />
              {tx.blockHeight && (
                <DetailRow label="Block" value={String(tx.blockHeight)} />
              )}
              <DetailRow
                label="Created"
                value={new Date(tx.createdAt).toLocaleString()}
              />
              {tx.confirmedAt && (
                <DetailRow
                  label="Confirmed"
                  value={new Date(tx.confirmedAt).toLocaleString()}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-sm text-gray-500">{label}</span>
      <span
        className={`text-sm text-white text-right break-all ${
          mono ? 'font-mono text-xs' : ''
        }`}
      >
        {value}
      </span>
    </div>
  );
}
