'use client';

import { useState } from 'react';

interface AddressDisplayProps {
  address: string;
  chain?: string;
  label?: string;
  truncate?: boolean;
}

export function AddressDisplay({
  address,
  chain,
  label,
  truncate = true,
}: AddressDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayed = truncate
    ? `${address.slice(0, 10)}...${address.slice(-8)}`
    : address;

  return (
    <div className="flex items-center gap-2">
      {chain && <ChainBadge chain={chain} />}
      <div className="min-w-0 flex-1">
        {label && <p className="text-xs text-gray-400">{label}</p>}
        <p className="truncate font-mono text-sm text-gray-300" title={address}>
          {displayed}
        </p>
      </div>
      <button
        onClick={handleCopy}
        className="shrink-0 rounded-lg bg-white/5 px-2 py-1 text-xs text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

const CHAIN_COLORS: Record<string, string> = {
  BTC: 'bg-orange-500/20 text-orange-400',
  BCH: 'bg-green-500/20 text-green-400',
  ETH: 'bg-blue-500/20 text-blue-400',
  POL: 'bg-purple-500/20 text-purple-400',
  SOL: 'bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent',
  USDC_ETH: 'bg-blue-500/20 text-blue-300',
  USDC_POL: 'bg-purple-500/20 text-purple-300',
  USDC_SOL: 'bg-cyan-500/20 text-cyan-300',
};

export function ChainBadge({ chain }: { chain: string }) {
  const color = CHAIN_COLORS[chain] || 'bg-gray-500/20 text-gray-400';
  const label = chain.replace('_', ' ');

  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {label}
    </span>
  );
}
