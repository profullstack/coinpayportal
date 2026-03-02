'use client';

import { useEffect, useState } from 'react';
import type { LnPayment } from '@/lib/lightning/types';

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
  const [payments, setPayments] = useState<LnPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPayments();
  }, [nodeId, walletId, businessId, offerId]);

  const fetchPayments = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nodeId) params.set('node_id', nodeId);
      if (walletId) params.set('wallet_id', walletId);
      if (businessId) params.set('business_id', businessId);
      if (offerId) params.set('offer_id', offerId);
      // Show all directions (incoming + outgoing)

      const res = await fetch(`/api/lightning/payments?${params}`);
      const json = await res.json();

      if (json.success) {
        setPayments(json.data.payments);
      } else {
        setError(json.error?.message || 'Failed to load payments');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

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
