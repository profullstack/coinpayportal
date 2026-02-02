'use client';

import { ChainBadge } from './AddressDisplay';

export interface AssetItem {
  chain: string;
  address: string;
  balance: string;
  usdValue?: number;
}

interface AssetListProps {
  assets: AssetItem[];
  isLoading?: boolean;
  onSelect?: (asset: AssetItem) => void;
  onDeriveAll?: () => void;
  isDeriving?: boolean;
}

export function AssetList({ assets, isLoading, onSelect, onDeriveAll, isDeriving }: AssetListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/5 p-4 animate-pulse"
          >
            <div className="h-8 w-16 rounded-md bg-white/10" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-24 rounded bg-white/10" />
              <div className="h-3 w-32 rounded bg-white/10" />
            </div>
            <div className="h-4 w-16 rounded bg-white/10" />
          </div>
        ))}
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="rounded-xl border border-white/5 bg-white/5 p-8 text-center">
        <p className="text-sm text-gray-400">No assets yet</p>
        <p className="mt-1 text-xs text-gray-500">
          Derive addresses for your wallet chains to get started
        </p>
        {onDeriveAll && (
          <button
            onClick={onDeriveAll}
            disabled={isDeriving}
            className="mt-4 rounded-xl bg-purple-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDeriving ? 'Deriving Addresses...' : 'Derive Addresses'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {assets.map((asset, i) => (
        <button
          key={`${asset.chain}-${asset.address}-${i}`}
          onClick={() => onSelect?.(asset)}
          className="flex w-full items-center gap-3 rounded-xl border border-white/5 bg-white/5 p-4 text-left hover:bg-white/10 transition-colors"
        >
          <ChainBadge chain={asset.chain} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">
              {asset.balance} {getSymbol(asset.chain)}
            </p>
            <p className="truncate text-xs text-gray-400 font-mono">
              {asset.address.slice(0, 10)}...{asset.address.slice(-6)}
            </p>
          </div>
          {asset.usdValue !== undefined && (
            <p className="text-sm text-gray-400">
              ${asset.usdValue.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          )}
        </button>
      ))}
    </div>
  );
}

function getSymbol(chain: string): string {
  const map: Record<string, string> = {
    BTC: 'BTC',
    BCH: 'BCH',
    ETH: 'ETH',
    POL: 'POL',
    SOL: 'SOL',
    USDC_ETH: 'USDC',
    USDC_POL: 'USDC',
    USDC_SOL: 'USDC',
  };
  return map[chain] || chain;
}
