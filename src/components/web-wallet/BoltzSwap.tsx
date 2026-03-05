'use client';

import { useState, useEffect, useCallback } from 'react';

interface BoltzPairInfo {
  limits: { minimal: number; maximal: number };
  fees: {
    percentage: number;
    percentageSwapIn: number;
    minerFees: {
      baseAsset: {
        normal: number;
        reverse: { claim: number; lockup: number };
      };
    };
  };
}

interface Props {
  walletId: string;
  btcAddress?: string;
  btcBalance?: string;
  lnBalance?: string;
}

type Direction = 'in' | 'out';
type SwapState = 'idle' | 'loading' | 'created' | 'polling' | 'complete' | 'error';

export function BoltzSwap({ walletId, btcAddress, btcBalance, lnBalance }: Props) {
  const [direction, setDirection] = useState<Direction>('in');
  const [amount, setAmount] = useState('');
  const [pairInfo, setPairInfo] = useState<BoltzPairInfo | null>(null);
  const [estimate, setEstimate] = useState<{ totalFee: number; receiveSats: number } | null>(null);
  const [swapState, setSwapState] = useState<SwapState>('idle');
  const [swapData, setSwapData] = useState<any>(null);
  const [swapStatus, setSwapStatus] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [btcPrice, setBtcPrice] = useState<number | null>(null);

  // Fetch pair info and BTC price on mount
  useEffect(() => {
    fetch('/api/swap/boltz')
      .then((r) => r.json())
      .then((d) => { if (d.success) setPairInfo(d.pair); })
      .catch(() => {});
    fetch('/api/rates/btc')
      .then((r) => r.json())
      .then((d) => { if (d.price) setBtcPrice(d.price); })
      .catch(() => {});
  }, []);

  // Estimate fees when amount changes
  useEffect(() => {
    const sats = Math.round(parseFloat(amount || '0') * 1e8);
    if (!sats || sats < (pairInfo?.limits.minimal || 25000)) {
      setEstimate(null);
      return;
    }
    const timer = setTimeout(() => {
      fetch('/api/swap/boltz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: 'estimate', amountSats: sats, swapDirection: direction }),
      })
        .then((r) => r.json())
        .then((d) => { if (d.success) setEstimate(d.estimate); })
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [amount, direction, pairInfo]);

  // Poll swap status
  useEffect(() => {
    if (swapState !== 'polling' || !swapData?.id) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/swap/boltz/${swapData.id}`);
        const data = await res.json();
        if (data.success) {
          setSwapStatus(data.status);
          // Success states
          if (['transaction.claimed', 'invoice.settled'].includes(data.status)) {
            setSwapState('complete');
            clearInterval(interval);
          }
          // Failure states
          if (['swap.expired', 'transaction.failed', 'transaction.lockupFailed', 'invoice.failedToPay', 'transaction.refunded'].includes(data.status)) {
            setSwapState('error');
            setError(`Swap ${data.status}`);
            clearInterval(interval);
          }
        }
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [swapState, swapData]);

  const handleSwap = async () => {
    setError('');
    setSwapState('loading');

    const sats = Math.round(parseFloat(amount) * 1e8);
    if (!sats) {
      setError('Enter a valid amount');
      setSwapState('idle');
      return;
    }

    try {
      if (direction === 'in') {
        // BTC → Lightning: first create LN invoice via LNBits, then create Boltz swap
        const invoiceRes = await fetch(`/api/lightning/invoices`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet_id: walletId, amount_sats: sats, description: `Boltz swap-in ${sats} sats` }),
        });
        const invoiceData = await invoiceRes.json();
        const bolt11 = invoiceData?.data?.invoice?.bolt11 || invoiceData?.payment_request;
        if (!bolt11) {
          const errMsg = invoiceData?.error?.message || invoiceData?.error || 'Failed to create Lightning invoice';
          throw new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
        }

        const swapRes = await fetch('/api/swap/boltz', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            direction: 'in',
            invoice: bolt11,
            refundAddress: btcAddress,
          }),
        });
        const swap = await swapRes.json();
        if (!swap.success) throw new Error(swap.error);
        setSwapData(swap.swap);
        setSwapState('polling');
      } else {
        // Lightning → BTC: create reverse swap
        if (!btcAddress) {
          throw new Error('No BTC address available. Derive a BTC address first.');
        }
        const swapRes = await fetch('/api/swap/boltz', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            direction: 'out',
            amountSats: sats,
            claimAddress: btcAddress,
          }),
        });
        const swap = await swapRes.json();
        if (!swap.success) throw new Error(swap.error);
        setSwapData(swap.swap);
        setSwapState('polling');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Swap failed');
      setSwapState('error');
    }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const minBtc = pairInfo ? (pairInfo.limits.minimal / 1e8).toFixed(8) : '0.00025000';
  const maxBtc = pairInfo ? (pairInfo.limits.maximal / 1e8).toFixed(8) : '0.25000000';

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Deposit BTC to Lightning
        </h3>
        <div className="text-right">
          <span className="text-xs text-gray-500">via Boltz Exchange</span>
          {btcPrice && <p className="text-xs text-gray-500">1 BTC = ${btcPrice.toLocaleString()} USD</p>}
        </div>
      </div>

      {/* Direction toggle */}
      <div className="flex rounded-xl bg-black/30 p-1">
        <button
          onClick={() => { setDirection('in'); setSwapState('idle'); setSwapData(null); }}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            direction === 'in' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          Deposit BTC → ⚡ Lightning
        </button>
        <button
          onClick={() => { setDirection('out'); setSwapState('idle'); setSwapData(null); }}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            direction === 'out' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          Withdraw ⚡ → On-chain BTC
        </button>
      </div>

      {/* Balances */}
      <div className="flex justify-between text-xs text-gray-400">
        <span>BTC: {btcBalance || '0'}</span>
        <span>⚡ LN: {lnBalance || '0'} sats</span>
      </div>

      {swapState === 'idle' || swapState === 'loading' ? (
        <>
          {/* Amount input */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Amount (BTC) — Min: {minBtc} / Max: {maxBtc}
            </label>
            <input
              type="number"
              step="0.00001"
              placeholder="0.001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-xl bg-black/30 border border-white/10 px-4 py-3 text-white text-lg focus:border-purple-500 focus:outline-none"
            />
            {amount && (
              <p className="text-xs text-gray-500 mt-1">
                = {Math.round(parseFloat(amount || '0') * 1e8).toLocaleString()} sats
                {btcPrice ? ` ≈ $${(parseFloat(amount || '0') * btcPrice).toFixed(2)} USD` : ''}
              </p>
            )}
          </div>

          {/* Fee estimate */}
          {estimate && (
            <div className="rounded-xl bg-black/20 p-3 space-y-1 text-sm">
              <div className="flex justify-between text-gray-400">
                <span>Fee</span>
                <span>{estimate.totalFee.toLocaleString()} sats</span>
              </div>
              <div className="flex justify-between text-white font-medium">
                <span>You receive</span>
                <span>{estimate.receiveSats.toLocaleString()} sats{btcPrice ? ` ≈ $${(estimate.receiveSats / 1e8 * btcPrice).toFixed(2)}` : ''}</span>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            onClick={handleSwap}
            disabled={swapState === 'loading' || !amount}
            className="w-full rounded-xl bg-purple-600 py-3 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {swapState === 'loading' ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Creating swap...
              </span>
            ) : direction === 'in' ? (
              'Deposit BTC to Lightning'
            ) : (
              'Withdraw to On-chain BTC'
            )}
          </button>
        </>
      ) : (
        /* Swap in progress */
        <div className="space-y-4">
          <div className="text-center">
            {swapState === 'complete' ? (
              <div className="mx-auto h-12 w-12 rounded-full bg-green-500/20 flex items-center justify-center mb-3">
                <svg className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            ) : swapState === 'error' ? (
              <div className="mx-auto h-12 w-12 rounded-full bg-red-500/20 flex items-center justify-center mb-3">
                <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            ) : (
              <div className="mx-auto h-12 w-12 rounded-full border-2 border-purple-400 border-t-transparent animate-spin mb-3" />
            )}
            <p className="text-white font-medium">
              {swapState === 'complete' ? 'Swap Complete!' :
               swapState === 'error' ? 'Swap Failed' :
               'Swap In Progress'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {swapStatus === 'swap.created' && '⏳ Waiting for BTC deposit...'}
              {swapStatus === 'transaction.mempool' && '📡 BTC transaction detected in mempool!'}
              {swapStatus === 'transaction.confirmed' && '✅ BTC confirmed on-chain, paying Lightning invoice...'}
              {swapStatus === 'invoice.paid' && '⚡ Lightning invoice paid, claiming...'}
              {swapStatus === 'invoice.pending' && '⚡ Lightning payment pending...'}
              {swapStatus === 'transaction.claimed' && '🎉 Swap complete!'}
              {swapStatus === 'invoice.settled' && '🎉 Swap complete!'}
              {swapStatus === 'transaction.server.mempool' && '📡 Server transaction in mempool...'}
              {swapStatus === 'transaction.server.confirmed' && '✅ Server transaction confirmed...'}
              {!swapStatus && '⏳ Waiting for BTC deposit...'}
              {swapStatus && !['swap.created','transaction.mempool','transaction.confirmed','invoice.paid','invoice.pending','transaction.claimed','invoice.settled','transaction.server.mempool','transaction.server.confirmed'].includes(swapStatus) && `Status: ${swapStatus}`}
            </p>
          </div>

          {/* Show deposit address for swap-in */}
          {direction === 'in' && swapData?.address && swapState === 'polling' && (
            <div className="rounded-xl bg-black/20 p-4 space-y-2">
              <p className="text-xs text-gray-400">Send BTC to this address:</p>
              <p className="text-sm text-white font-mono break-all">{swapData.address}</p>
              {swapData.expectedAmount && (
                <p className="text-xs text-gray-400">
                  Expected: {(swapData.expectedAmount / 1e8).toFixed(8)} BTC ({swapData.expectedAmount.toLocaleString()} sats)
                </p>
              )}
              <button
                onClick={() => copy(swapData.address, 'address')}
                className="w-full rounded-lg bg-purple-600/30 py-2 text-xs text-purple-300 hover:bg-purple-600/50 transition-colors"
              >
                {copied === 'address' ? '✓ Copied!' : 'Copy Address'}
              </button>
              {swapData.bip21 && (
                <button
                  onClick={() => copy(swapData.bip21, 'bip21')}
                  className="w-full rounded-lg bg-white/5 py-2 text-xs text-gray-400 hover:bg-white/10 transition-colors"
                >
                  {copied === 'bip21' ? '✓ Copied!' : 'Copy BIP21 URI'}
                </button>
              )}
            </div>
          )}

          {/* Show invoice for swap-out */}
          {direction === 'out' && swapData?.invoice && swapState === 'polling' && (
            <div className="rounded-xl bg-black/20 p-4 space-y-2">
              <p className="text-xs text-gray-400">Pay this Lightning invoice:</p>
              <p className="text-xs text-white font-mono break-all">{swapData.invoice}</p>
              <button
                onClick={() => copy(swapData.invoice, 'invoice')}
                className="w-full rounded-lg bg-purple-600/30 py-2 text-xs text-purple-300 hover:bg-purple-600/50 transition-colors"
              >
                {copied === 'invoice' ? '✓ Copied!' : 'Copy Invoice'}
              </button>
            </div>
          )}

          {error && <p className="text-sm text-red-400 text-center">{error}</p>}

          <button
            onClick={() => { setSwapState('idle'); setSwapData(null); setError(''); setSwapStatus(''); }}
            className="w-full rounded-xl border border-white/10 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            {swapState === 'complete' || swapState === 'error' ? 'New Swap' : 'Cancel'}
          </button>
        </div>
      )}
    </div>
  );
}
