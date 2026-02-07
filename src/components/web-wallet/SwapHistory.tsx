'use client';

import { useState, useEffect, useCallback } from 'react';

interface Swap {
  id: string;
  from_coin: string;
  to_coin: string;
  deposit_amount: string;
  settle_amount: string | null;
  deposit_address: string;
  settle_address: string;
  status: string;
  provider: string;
  created_at: string;
  provider_data?: {
    deposit_tx_hash?: string;
    [key: string]: any;
  };
}

// Explorer URLs for transaction links
const EXPLORER_TX_URLS: Record<string, string> = {
  BTC: 'https://blockstream.info/tx/',
  BCH: 'https://blockchair.com/bitcoin-cash/transaction/',
  ETH: 'https://etherscan.io/tx/',
  POL: 'https://polygonscan.com/tx/',
  SOL: 'https://explorer.solana.com/tx/',
  BNB: 'https://bscscan.com/tx/',
  DOGE: 'https://dogechain.info/tx/',
  XRP: 'https://xrpscan.com/tx/',
  ADA: 'https://cardanoscan.io/transaction/',
};

interface SwapHistoryProps {
  walletId: string;
  onSwapClick?: (swap: Swap) => void;
}

const STATUS_COLORS: Record<string, string> = {
  waiting: 'text-yellow-400 bg-yellow-400/10',
  pending: 'text-yellow-400 bg-yellow-400/10',
  confirming: 'text-blue-400 bg-blue-400/10',
  exchanging: 'text-blue-400 bg-blue-400/10',
  sending: 'text-purple-400 bg-purple-400/10',
  processing: 'text-blue-400 bg-blue-400/10',
  settling: 'text-purple-400 bg-purple-400/10',
  settled: 'text-green-400 bg-green-400/10',
  finished: 'text-green-400 bg-green-400/10',
  failed: 'text-red-400 bg-red-400/10',
  refunded: 'text-orange-400 bg-orange-400/10',
  expired: 'text-gray-400 bg-gray-400/10',
};

const STATUS_LABELS: Record<string, string> = {
  waiting: 'Waiting for deposit',
  pending: 'Waiting for deposit',
  confirming: 'Confirming deposit',
  exchanging: 'Exchanging',
  sending: 'Sending funds',
  processing: 'Processing',
  settling: 'Sending',
  settled: 'Completed',
  finished: 'Completed',
  failed: 'Failed',
  refunded: 'Refunded',
  expired: 'Expired',
};

export function SwapHistory({ walletId, onSwapClick }: SwapHistoryProps) {
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/swap/history?walletId=${walletId}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch history');
      }

      setSwaps(data.swaps || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [walletId]);

  useEffect(() => {
    fetchHistory();
    
    // Poll for updates every 30 seconds
    const interval = setInterval(fetchHistory, 30000);
    return () => clearInterval(interval);
  }, [fetchHistory]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={fetchHistory}
          className="mt-2 text-sm text-purple-400 hover:text-purple-300"
        >
          Try again
        </button>
      </div>
    );
  }

  if (swaps.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-400">No swaps yet</p>
        <p className="text-sm text-gray-500 mt-1">Your swap history will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {swaps.map((swap) => (
        <SwapCard 
          key={swap.id} 
          swap={swap} 
          onClick={() => onSwapClick?.(swap)} 
          onRefresh={() => fetchHistory()}
        />
      ))}
    </div>
  );
}

function SwapCard({ swap, onClick, onRefresh }: { swap: Swap; onClick?: () => void; onRefresh?: (id: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const statusColor = STATUS_COLORS[swap.status] || 'text-gray-400 bg-gray-400/10';
  const statusLabel = STATUS_LABELS[swap.status] || swap.status;
  const isPending = ['waiting', 'pending', 'confirming', 'exchanging', 'sending', 'processing', 'settling'].includes(swap.status);

  const copyId = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(swap.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const checkStatus = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRefreshing(true);
    try {
      await fetch(`/api/swap/${swap.id}`);
      onRefresh?.(swap.id);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-white/10 bg-white/5 p-4 ${onClick ? 'cursor-pointer hover:bg-white/10 transition-colors' : ''}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white">{swap.from_coin}</span>
          <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
          <span className="font-semibold text-white">{swap.to_coin}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={checkStatus}
            disabled={refreshing}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title="Check status"
          >
            <svg 
              className={`h-4 w-4 text-gray-400 ${refreshing ? 'animate-spin' : ''}`} 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <span className={`text-xs px-2 py-1 rounded-full ${statusColor}`}>
            {isPending && (
              <span className="inline-block h-2 w-2 rounded-full bg-current animate-pulse mr-1" />
            )}
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-gray-500 text-xs">Sent</p>
          <p className="text-white">{swap.deposit_amount} {swap.from_coin}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs">Received</p>
          <p className={swap.settle_amount ? 'text-green-400' : 'text-gray-400'}>
            {swap.settle_amount ? `${swap.settle_amount} ${swap.to_coin}` : '—'}
          </p>
        </div>
      </div>

      {/* Deposit TX Hash */}
      {swap.provider_data?.deposit_tx_hash && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">Deposit TX</span>
            <div className="flex items-center gap-2">
              <a
                href={`${EXPLORER_TX_URLS[swap.from_coin] || EXPLORER_TX_URLS.ETH}${swap.provider_data.deposit_tx_hash}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-mono text-purple-400 hover:text-purple-300 underline"
              >
                {swap.provider_data.deposit_tx_hash.slice(0, 10)}...{swap.provider_data.deposit_tx_hash.slice(-6)}
              </a>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(swap.provider_data!.deposit_tx_hash!);
                }}
                className="p-1 hover:bg-white/10 rounded transition-colors"
                title="Copy TX hash"
              >
                <svg className="h-3 w-3 text-gray-400 hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-gray-500">{new Date(swap.created_at).toLocaleString()}</span>
        <button
          onClick={copyId}
          className="flex items-center gap-1 font-mono text-gray-400 hover:text-white transition-colors"
          title="Copy swap ID"
        >
          {swap.id}
          {copied ? (
            <svg className="h-3 w-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

// Separate component for pending swaps with live status updates
export function PendingSwaps({ walletId }: { walletId: string }) {
  const [pendingSwaps, setPendingSwaps] = useState<Swap[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPending = useCallback(async () => {
    try {
      // Fetch pending swaps
      const res = await fetch(`/api/swap/history?walletId=${walletId}&status=pending`);
      const data = await res.json();

      if (res.ok && data.swaps) {
        // For each pending swap, fetch latest status from provider
        const updatedSwaps = await Promise.all(
          data.swaps.map(async (swap: Swap) => {
            try {
              const statusRes = await fetch(`/api/swap/${swap.id}`);
              const statusData = await statusRes.json();
              if (statusRes.ok && statusData.swap) {
                return { ...swap, status: statusData.swap.status };
              }
            } catch {
              // Keep original status on error
            }
            return swap;
          })
        );
        setPendingSwaps(updatedSwaps.filter(s => 
          ['waiting', 'pending', 'confirming', 'exchanging', 'sending', 'processing', 'settling'].includes(s.status)
        ));
      }
    } catch {
      // Silently fail - this is supplementary info
    } finally {
      setLoading(false);
    }
  }, [walletId]);

  useEffect(() => {
    fetchPending();
    
    // Poll more frequently for pending swaps
    const interval = setInterval(fetchPending, 15000);
    return () => clearInterval(interval);
  }, [fetchPending]);

  if (loading || pendingSwaps.length === 0) {
    return null;
  }

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
        Pending Swaps ({pendingSwaps.length})
      </h3>
      <div className="space-y-3">
        {pendingSwaps.map((swap) => (
          <PendingSwapCard key={swap.id} swap={swap} />
        ))}
      </div>
    </div>
  );
}

function PendingSwapCard({ swap }: { swap: Swap }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(swap.deposit_address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
      <div 
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white">{swap.from_coin}</span>
          <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
          <span className="font-semibold text-white">{swap.to_coin}</span>
        </div>
        <span className="text-xs px-2 py-1 rounded-full text-yellow-400 bg-yellow-400/10">
          <span className="inline-block h-2 w-2 rounded-full bg-yellow-400 animate-pulse mr-1" />
          {STATUS_LABELS[swap.status] || swap.status}
        </span>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3">
          <div className="text-sm">
            <p className="text-gray-400 text-xs mb-1">Send {swap.deposit_amount} {swap.from_coin} to:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-black/30 p-2 rounded break-all text-white">
                {swap.deposit_address}
              </code>
              <button
                onClick={(e) => { e.stopPropagation(); copyAddress(); }}
                className="p-2 rounded bg-white/10 hover:bg-white/20 transition-colors"
              >
                {copied ? (
                  <svg className="h-4 w-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          
          <p className="text-xs text-gray-500">
            Created: {new Date(swap.created_at).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}
