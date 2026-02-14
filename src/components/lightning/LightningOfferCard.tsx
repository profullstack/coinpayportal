'use client';

import { useState, useEffect } from 'react';
import type { LnOffer } from '@/lib/lightning/types';

export interface LightningOfferCardProps {
  offer?: LnOffer;
  nodeId?: string;
  refreshKey?: number;
}

/**
 * Displays BOLT12 offer(s) as a QR code with copy functionality.
 * Pass `offer` directly, or `nodeId` to fetch offers for a node.
 */
export function LightningOfferCard({ offer: offerProp, nodeId, refreshKey }: LightningOfferCardProps) {
  const [offers, setOffers] = useState<LnOffer[]>(offerProp ? [offerProp] : []);
  const [loading, setLoading] = useState(!offerProp && !!nodeId);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (offerProp || !nodeId) return;
    fetch(`/api/lightning/offers?node_id=${nodeId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data?.offers) {
          setOffers(data.data.offers);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [nodeId, offerProp, refreshKey]);

  if (loading) {
    return <div className="text-center text-sm text-gray-400 py-8">Loading offers...</div>;
  }

  if (offers.length === 0) {
    return (
      <div className="text-center text-sm text-gray-500 py-8">
        No offers yet. Create one to start receiving payments.
      </div>
    );
  }

  // Render each offer
  return (
    <div className="space-y-4">
      {offers.map((offer) => (
        <SingleOfferCard key={offer.id} offer={offer} />
      ))}
    </div>
  );
}

function SingleOfferCard({ offer }: { offer: LnOffer }) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(offer.bolt12_offer);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = offer.bolt12_offer;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const amountDisplay = offer.amount_msat
    ? `${Math.floor(offer.amount_msat / 1000)} sats`
    : 'Any amount';

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-white">{offer.description}</h3>
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            offer.status === 'active'
              ? 'bg-green-900/40 text-green-400'
              : 'bg-white/10 text-gray-400'
          }`}
        >
          {offer.status}
        </span>
      </div>

      {/* Offer string preview */}
      <div className="mb-3 rounded-lg bg-black/20 p-3 font-mono text-xs text-gray-400 break-all">
        {offer.bolt12_offer.substring(0, 60)}...
      </div>

      <div className="mb-3 text-center text-sm text-gray-300">{amountDisplay}</div>

      {/* Copy button */}
      <button
        onClick={copyToClipboard}
        className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700 transition-colors"
      >
        {copied ? '✓ Copied!' : '📋 Copy BOLT12 Offer'}
      </button>

      {/* Deep link */}
      <a
        href={`lightning:${offer.bolt12_offer}`}
        className="mt-2 block w-full rounded-lg border border-purple-600 px-4 py-2.5 text-center text-sm font-medium text-purple-400 hover:bg-purple-900/20 transition-colors"
      >
        Open in Wallet
      </a>

      {/* Stats */}
      {offer.payment_count > 0 && (
        <div className="mt-4 flex justify-between border-t border-white/10 pt-3 text-xs text-gray-400">
          <span>{offer.payment_count} payments</span>
          <span>{Math.floor(offer.total_received_msat / 1000)} sats received</span>
        </div>
      )}
    </div>
  );
}
