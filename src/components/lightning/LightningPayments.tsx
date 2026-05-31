'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LnPayment } from '@/lib/lightning/types';
import { useWebWallet } from '@/components/web-wallet/WalletContext';

interface LightningPaymentsProps {
  nodeId?: string;
  walletId?: string;
  businessId?: string;
  offerId?: string;
}

/**
 * Lists Lightning payments (incoming + outgoing) with status and amount.
 */
export function LightningPayments({ nodeId, walletId, businessId, offerId }: LightningPaymentsProps) {
  const { wallet } = useWebWallet();
  const [payments, setPayments] = useState<LnPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!wallet || (walletId && wallet.walletId !== walletId)) throw new Error('Wallet is locked');
      setPayments(await wallet.listLightningPayments(20, { nodeId, businessId, offerId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [businessId, nodeId, offerId, wallet, walletId]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-gray-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-900/30 p-4 text-sm text-red-400">
        {error}
      </div>
    );
  }

  if (payments.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-sm text-gray-400">
        <div className="mb-2 text-2xl">⚡</div>
        No Lightning payments yet
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="divide-y divide-white/10 rounded-xl border border-white/10 bg-white/5">
        {payments.map((payment) => (
          <div key={payment.id} className="flex items-center justify-between p-4">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    payment.status === 'settled' ? 'bg-green-500' : 'bg-yellow-500'
                  }`}
                />
                <span className={`text-sm font-medium ${payment.direction === 'outgoing' ? 'text-red-400' : 'text-green-400'}`}>
                  {payment.direction === 'outgoing' ? '−' : '+'}{Math.floor(payment.amount_msat / 1000)} sats
                </span>
                <span className="text-xs text-gray-500">
                  {payment.direction === 'outgoing' ? 'Sent' : 'Received'}
                </span>
              </div>
              {payment.payer_note && (
                <p className="mt-1 text-xs text-gray-400">{payment.payer_note}</p>
              )}
              {payment.direction === 'outgoing' && payment.fee_msat != null && payment.fee_msat !== 0 && (
                <p className="mt-0.5 text-xs text-gray-500">Fee: {Math.ceil(Math.abs(payment.fee_msat) / 1000)} sat{Math.ceil(Math.abs(payment.fee_msat) / 1000) !== 1 ? 's' : ''}</p>
              )}
              <p className="mt-1 text-xs text-gray-500 font-mono">
                {payment.payment_hash.substring(0, 16)}...
              </p>
            </div>
            <div className="text-right text-xs text-gray-400">
              <div className={payment.status === 'settled' ? 'text-green-400' : 'text-yellow-400'}>{payment.status}</div>
              <div>
                {payment.settled_at
                  ? new Date(payment.settled_at).toLocaleString()
                  : new Date(payment.created_at).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
