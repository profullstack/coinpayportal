'use client';

import { useState } from 'react';
import type { LnOffer } from '@/lib/lightning/types';

interface LightningOfferCardProps {
  offer: LnOffer;
}

/**
 * Displays a BOLT12 offer as a QR code with copy functionality.
 * Uses a simple SVG-based QR placeholder — in production, use a
 * proper QR library (qrcode.react or similar).
 */
export function LightningOfferCard({ offer }: LightningOfferCardProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(offer.bolt12_offer);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
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
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">{offer.description}</h3>
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            offer.status === 'active'
              ? 'bg-green-100 text-green-800'
              : 'bg-gray-100 text-gray-600'
          }`}
        >
          {offer.status}
        </span>
      </div>

      {/* QR Code placeholder — replace with qrcode.react in production */}
      <div className="mx-auto mb-4 flex h-48 w-48 items-center justify-center rounded-lg bg-gray-100">
        <div className="text-center text-sm text-gray-500">
          <div className="mb-1 text-2xl">⚡</div>
          <div>BOLT12 QR</div>
          <div className="mt-1 text-xs text-gray-400">
            {offer.bolt12_offer.substring(0, 20)}...
          </div>
        </div>
      </div>

      <div className="mb-3 text-center text-sm text-gray-600">{amountDisplay}</div>

      {/* Copy button */}
      <button
        onClick={copyToClipboard}
        className="w-full rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 transition-colors"
      >
        {copied ? '✓ Copied!' : 'Copy BOLT12 Offer'}
      </button>

      {/* Deep link */}
      <a
        href={`lightning:${offer.bolt12_offer}`}
        className="mt-2 block w-full rounded-md border border-amber-500 px-4 py-2 text-center text-sm font-medium text-amber-600 hover:bg-amber-50 transition-colors"
      >
        Open in Wallet
      </a>

      {/* Stats */}
      {offer.payment_count > 0 && (
        <div className="mt-4 flex justify-between border-t pt-3 text-xs text-gray-500">
          <span>{offer.payment_count} payments</span>
          <span>{Math.floor(offer.total_received_msat / 1000)} sats received</span>
        </div>
      )}
    </div>
  );
}
