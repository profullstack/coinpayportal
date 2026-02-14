'use client';

import { useState } from 'react';
import type { LnNode } from '@/lib/lightning/types';

interface LightningSetupProps {
  walletId: string;
  businessId?: string;
  mnemonic: string;
  onSetupComplete?: (node: LnNode) => void;
}

/**
 * One-click "Enable Lightning" component.
 * Provisions a Greenlight node for the wallet using the existing BIP39 seed.
 */
export function LightningSetup({
  walletId,
  businessId,
  mnemonic,
  onSetupComplete,
}: LightningSetupProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [node, setNode] = useState<LnNode | null>(null);

  const enableLightning = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/lightning/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_id: walletId,
          business_id: businessId,
          mnemonic,
        }),
      });

      const json = await res.json();

      if (json.success) {
        setNode(json.data.node);
        onSetupComplete?.(json.data.node);
      } else {
        setError(json.error?.message || 'Failed to enable Lightning');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (node) {
    return (
      <div className="rounded-xl border border-green-800 bg-green-900/30 p-6 text-center">
        <div className="mb-2 text-3xl">⚡</div>
        <h3 className="text-lg font-semibold text-green-400">Lightning Enabled!</h3>
        <p className="mt-1 text-sm text-green-500">
          Your node is ready to receive BOLT12 payments.
        </p>
        <p className="mt-2 text-xs text-green-600 font-mono">
          {node.node_pubkey?.substring(0, 20)}...
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center">
      <div className="mb-3 text-3xl">⚡</div>
      <h3 className="text-lg font-semibold text-white">Enable Lightning Network</h3>
      <p className="mt-1 mb-4 text-sm text-gray-400">
        Receive instant Bitcoin payments via BOLT12 offers.
        Your existing wallet seed derives the Lightning node identity.
      </p>

      {error && (
        <div className="mb-4 rounded-lg bg-red-900/30 border border-red-800 p-3 text-sm text-red-400">{error}</div>
      )}

      <button
        onClick={enableLightning}
        disabled={loading}
        className="w-full rounded-lg bg-purple-600 px-6 py-3 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            Provisioning node...
          </span>
        ) : (
          'Enable Lightning ⚡'
        )}
      </button>
    </div>
  );
}
