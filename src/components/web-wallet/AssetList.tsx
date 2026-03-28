'use client';

import { useState } from 'react';
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
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const handleCopyAddress = async (
    event: React.MouseEvent<HTMLButtonElement>,
    address: string
  ) => {
    event.stopPropagation();
    await navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    window.setTimeout(() => {
      setCopiedAddress((current) => (current === address ? null : current));
    }, 2000);
  };

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
        <div
          key={`${asset.chain}-${asset.address}-${i}`}
          onClick={() => onSelect?.(asset)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect?.(asset);
            }
          }}
          role="button"
          tabIndex={0}
          className="flex w-full items-center gap-3 rounded-xl border border-white/5 bg-white/5 p-4 text-left hover:bg-white/10 transition-colors cursor-pointer"
        >
          <ChainBadge chain={asset.chain} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">{getSymbol(asset.chain)}</p>
            <p className="truncate text-xs text-gray-400 font-mono">
              {asset.address.slice(0, 10)}...{asset.address.slice(-6)}
            </p>
          </div>
          {asset.chain !== 'LN' && (
            <button
              type="button"
              onClick={(event) => {
                void handleCopyAddress(event, asset.address);
              }}
              className="shrink-0 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
              aria-label={`Copy ${asset.chain} address`}
            >
              {copiedAddress === asset.address ? 'Copied' : 'Copy'}
            </button>
          )}
          <div className="text-right">
            <p className="text-sm font-medium text-white">
              {formatNativeBalance(asset.balance, asset.chain)} {getSymbol(asset.chain)}
            </p>
            {asset.chain === 'LN' && asset.usdValue !== undefined && asset.usdValue > 0 && (
              <p className="text-xs text-gray-400">
                ≈ ${asset.usdValue.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            )}
            {asset.chain !== 'LN' && asset.usdValue !== undefined && (
              <p className="text-xs text-gray-400">
                ${asset.usdValue.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatNativeBalance(balance: string, chain: string): string {
  const raw = parseFloat(balance || '0');
  if (!Number.isFinite(raw)) return balance;

  if (chain === 'LN') {
    return Math.round(raw * 100_000_000).toLocaleString('en-US');
  }

  if (Math.abs(raw) > 0 && Math.abs(raw) < 0.000001) {
    return raw.toFixed(8).replace(/0+$/, '').replace(/\.$/, '') || '0';
  }

  return raw.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

function getSymbol(chain: string): string {
  const map: Record<string, string> = {
    BTC: 'BTC',
    LN: '⚡ sats',
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
