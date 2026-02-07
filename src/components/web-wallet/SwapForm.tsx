'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChainSelector } from './ChainSelector';
import { AmountInput } from './AmountInput';
import { useWebWallet } from './WalletContext';
import { type FiatCurrency, getFiatSymbol } from '@/lib/web-wallet/settings';
import {
  decryptWithPassword,
  loadWalletFromStorage,
} from '@/lib/web-wallet/client-crypto';
import type { WalletChain } from '@/lib/web-wallet/identity';

// All coins supported for swaps (must match changenow.ts SWAP_SUPPORTED_COINS)
const SWAP_COINS = [
  'BTC', 'BCH', 'ETH', 'POL', 'SOL', 'BNB', 'DOGE', 'XRP', 'ADA',
  'USDT', 'USDT_ETH', 'USDT_POL', 'USDT_SOL',
  'USDC', 'USDC_ETH', 'USDC_POL', 'USDC_SOL',
];

interface Quote {
  from: string;
  to: string;
  depositAmount: string;
  settleAmount: string;
  rate: string;
  minAmount?: number;
  provider: string;
}

interface SwapResult {
  id: string;
  depositAddress: string;
  depositAmount: string;
  settleAmount: string;
  status: string;
  expiresAt?: string;
}

interface BalanceInfo {
  balance: string;
  usdValue?: number;
}

interface SwapFormProps {
  walletId: string;
  addresses: Record<string, string>;
  balances?: Record<string, BalanceInfo>;
  displayCurrency?: FiatCurrency;
  onSwapCreated?: (swap: SwapResult) => void;
}

export function SwapForm({ walletId, addresses, balances, displayCurrency = 'USD', onSwapCreated }: SwapFormProps) {
  const { wallet } = useWebWallet();
  const [fromCoin, setFromCoin] = useState('');
  const [toCoin, setToCoin] = useState('');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [swap, setSwap] = useState<SwapResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'form' | 'confirm' | 'password' | 'sending' | 'complete'>('form');
  const [usdRate, setUsdRate] = useState<number | null>(null);
  
  // Deposit sending state
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [depositTxHash, setDepositTxHash] = useState<string | null>(null);

  // Fetch fiat rate for the selected "from" coin
  useEffect(() => {
    if (!fromCoin) {
      setUsdRate(null);
      return;
    }

    const fetchFiatRate = async () => {
      try {
        const res = await fetch(`/api/rates?coin=${fromCoin}&fiat=${displayCurrency}`);
        if (res.ok) {
          const data = await res.json();
          if (data.rate) {
            setUsdRate(data.rate);
          }
        }
      } catch {
        // Silently fail - fiat rate is just a nice-to-have
      }
    };

    fetchFiatRate();
  }, [fromCoin, displayCurrency]);

  // Debounced quote fetch
  const fetchQuote = useCallback(async () => {
    if (!fromCoin || !toCoin || !amount || parseFloat(amount) <= 0) {
      setQuote(null);
      return;
    }

    if (fromCoin === toCoin) {
      setError('Cannot swap a coin for itself');
      setQuote(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/swap/quote?from=${fromCoin}&to=${toCoin}&amount=${amount}`
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to get quote');
        setQuote(null);
      } else {
        setQuote(data.quote);
      }
    } catch (err) {
      setError('Network error fetching quote');
      setQuote(null);
    } finally {
      setLoading(false);
    }
  }, [fromCoin, toCoin, amount]);

  // Fetch quote when inputs change (debounced)
  useEffect(() => {
    const timer = setTimeout(fetchQuote, 500);
    return () => clearTimeout(timer);
  }, [fetchQuote]);

  // Go to password step
  const handleConfirmSwap = () => {
    if (!quote) return;

    // Determine settle address from wallet
    const settleAddress = addresses[toCoin] || addresses[getBaseChain(toCoin)];
    if (!settleAddress) {
      setError(`No ${toCoin} address in wallet. Derive it first.`);
      return;
    }

    setError(null);
    setStep('password');
  };

  // Create swap AND send deposit in one flow
  const handlePasswordSubmit = async () => {
    if (!wallet || !quote || !password) return;
    
    // Validate password first
    const stored = loadWalletFromStorage();
    if (!stored) {
      setPasswordError('Wallet data not found');
      return;
    }
    
    const decrypted = await decryptWithPassword(stored.encrypted, password);
    if (!decrypted) {
      setPasswordError('Incorrect password');
      return;
    }

    // Password valid - now create swap and send deposit
    setLoading(true);
    setStep('sending');
    setError(null);
    setPasswordError('');

    try {
      // Determine addresses
      const settleAddress = addresses[toCoin] || addresses[getBaseChain(toCoin)];
      const refundAddress = addresses[fromCoin] || addresses[getBaseChain(fromCoin)];
      const fromAddress = addresses[fromCoin] || addresses[getBaseChain(fromCoin)];

      if (!fromAddress) {
        throw new Error(`No ${fromCoin} address available`);
      }

      // Step 1: Create swap
      const res = await fetch('/api/swap/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromCoin,
          to: toCoin,
          amount,
          settleAddress,
          refundAddress,
          walletId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create swap');
      }

      const createdSwap = data.swap;
      setSwap(createdSwap);
      onSwapCreated?.(createdSwap);

      // Step 2: Send deposit immediately
      console.log('[Swap] Sending deposit:', {
        chain: fromCoin,
        fromAddress,
        toAddress: createdSwap.depositAddress,
        amount: createdSwap.depositAmount,
      });
      
      const result = await wallet.send({
        chain: fromCoin as WalletChain,
        fromAddress,
        toAddress: createdSwap.depositAddress,
        amount: createdSwap.depositAmount,
        priority: 'medium',
      });
      
      console.log('[Swap] Send result:', result);
      
      if (!result.txHash) {
        throw new Error('No transaction hash returned - deposit may have failed');
      }
      
      setDepositTxHash(result.txHash);
      setPassword('');
      setStep('complete');
    } catch (err: any) {
      console.error('Swap/deposit failed:', err);
      setError(err.message || 'Failed to complete swap');
      setStep('form'); // Go back to form on error
    } finally {
      setLoading(false);
    }
  };

  const handleSwapDirection = () => {
    const temp = fromCoin;
    setFromCoin(toCoin);
    setToCoin(temp);
    setQuote(null);
  };

  const resetForm = () => {
    setStep('form');
    setSwap(null);
    setQuote(null);
    setAmount('');
    setError(null);
    setPassword('');
    setPasswordError('');
    setDepositTxHash(null);
  };

  // Password step removed - now integrated into confirm step

  // Sending view
  if (step === 'sending') {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-6">
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
            <div className="text-center">
              <h3 className="font-semibold text-white">Sending Deposit</h3>
              <p className="text-sm text-gray-400 mt-1">
                Sending {swap?.depositAmount} {fromCoin}...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Complete view (deposit sent)
  if (step === 'complete' && swap) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-full bg-green-500 flex items-center justify-center">
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-white">Deposit Sent!</h3>
              <p className="text-sm text-gray-400">Your swap is being processed</p>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Swap ID</span>
              <span className="font-mono text-white">{swap.id.slice(0, 16)}...</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Sent</span>
              <span className="text-white">{swap.depositAmount} {fromCoin}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Receiving</span>
              <span className="text-green-400">≈ {swap.settleAmount} {toCoin}</span>
            </div>
            {depositTxHash && (
              <div className="flex justify-between items-start">
                <span className="text-gray-400">Deposit TX</span>
                <span className="font-mono text-xs text-purple-400 break-all max-w-[200px]">
                  {depositTxHash.slice(0, 16)}...
                </span>
              </div>
            )}
          </div>

          <div className="mt-6 p-4 rounded-lg bg-black/30">
            <p className="text-xs text-gray-400 mb-2">
              ⏱️ The swap typically completes in 10-30 minutes. Check the Swap History tab for status updates.
            </p>
          </div>
        </div>

        <button
          onClick={resetForm}
          className="w-full rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors"
        >
          New Swap
        </button>
      </div>
    );
  }

  // Password step - enter password then auto-create swap and send deposit
  if (step === 'password' && quote) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-full bg-purple-500 flex items-center justify-center">
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-white">Authorize Swap</h3>
              <p className="text-sm text-gray-400">Enter password to create swap and send deposit</p>
            </div>
          </div>

          <div className="space-y-3 text-sm mb-4">
            <div className="flex justify-between">
              <span className="text-gray-400">You send</span>
              <span className="text-white font-semibold">{quote.depositAmount} {fromCoin}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">You receive</span>
              <span className="text-green-400 font-semibold">≈ {parseFloat(quote.settleAmount).toFixed(8)} {toCoin}</span>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 mb-4">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Password input */}
          <div>
            <label htmlFor="swap-password" className="block text-sm font-medium text-gray-300 mb-2">
              Wallet Password
            </label>
            <input
              id="swap-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && password && handlePasswordSubmit()}
              placeholder="Enter your password"
              className={`w-full rounded-lg border bg-white/5 px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-1 ${
                passwordError
                  ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                  : 'border-white/10 focus:border-purple-500 focus:ring-purple-500'
              }`}
              autoFocus
            />
            {passwordError && (
              <p className="text-xs text-red-400 mt-1">{passwordError}</p>
            )}
          </div>
        </div>

        <button
          onClick={handlePasswordSubmit}
          disabled={!password || loading}
          className="w-full rounded-xl bg-purple-600 px-6 py-4 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Processing...' : `Swap ${quote.depositAmount} ${fromCoin} → ${toCoin}`}
        </button>

        <button
          onClick={() => { setStep('form'); setPassword(''); setPasswordError(''); }}
          className="w-full rounded-xl border border-white/10 bg-transparent px-6 py-3 text-sm font-medium text-gray-400 hover:bg-white/5 transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  // Confirm view - review details before creating swap
  if (step === 'confirm' && quote) {
    const settleAddress = addresses[toCoin] || addresses[getBaseChain(toCoin)];
    
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
          <h3 className="font-semibold text-white">Confirm Swap</h3>
          
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">You send</span>
              <span className="text-white">{quote.depositAmount} {fromCoin}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">You receive</span>
              <span className="text-green-400">≈ {parseFloat(quote.settleAmount).toFixed(8)} {toCoin}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Rate</span>
              <span className="text-gray-300">1 {fromCoin} = {parseFloat(quote.rate).toFixed(8)} {toCoin}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Receive to</span>
              <span className="font-mono text-xs text-gray-300">{settleAddress?.slice(0, 16)}...</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Provider</span>
              <span className="text-gray-300">ChangeNOW (no KYC)</span>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setStep('form')}
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-medium text-gray-300 hover:bg-white/10 transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleConfirmSwap}
            disabled={loading}
            className="flex-1 rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-50 transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  // Main form
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <ChainSelector
          value={fromCoin}
          onChange={(v) => { setFromCoin(v); setQuote(null); }}
          chains={SWAP_COINS}
          label="From"
          balances={balances}
        />

        <div className="space-y-1">
          <AmountInput
            value={amount}
            onChange={(v) => { setAmount(v); setQuote(null); }}
            label={fromCoin ? `Amount (${fromCoin})` : 'Amount'}
          />
          {amount && parseFloat(amount) > 0 && usdRate && (
            <p className="text-xs text-gray-400 pl-1">
              ≈ {getFiatSymbol(displayCurrency)}{(parseFloat(amount) * usdRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {displayCurrency}
            </p>
          )}
        </div>

        {/* Swap direction button */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleSwapDirection}
            className="rounded-full p-2 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
          >
            <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>

        <ChainSelector
          value={toCoin}
          onChange={(v) => { setToCoin(v); setQuote(null); }}
          chains={SWAP_COINS.filter(c => c !== fromCoin)}
          label="To"
          balances={balances}
        />
      </div>

      {/* Quote display */}
      {loading && (
        <div className="flex items-center justify-center py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
          <span className="ml-2 text-sm text-gray-400">Fetching quote...</span>
        </div>
      )}

      {!loading && quote && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">You receive</span>
            <span className="text-green-400 font-semibold">
              ≈ {parseFloat(quote.settleAmount).toFixed(8)} {toCoin}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Rate</span>
            <span className="text-gray-400">
              1 {fromCoin} = {parseFloat(quote.rate).toFixed(8)} {toCoin}
            </span>
          </div>
          {quote.minAmount && parseFloat(amount) < quote.minAmount && (
            <p className="text-xs text-yellow-400">
              Minimum: {quote.minAmount} {fromCoin}
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      <button
        onClick={() => setStep('confirm')}
        disabled={!quote || loading || !!error}
        className="w-full rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-50 transition-colors"
      >
        {!fromCoin || !toCoin ? 'Select coins' : 
         !amount ? 'Enter amount' : 
         loading ? 'Loading...' : 
         'Continue'}
      </button>

      <p className="text-xs text-center text-gray-500">
        Powered by ChangeNOW • No KYC • No registration
      </p>
    </div>
  );
}

// Helper to get base chain for tokens
function getBaseChain(coin: string): string {
  if (coin.endsWith('_ETH') || coin === 'USDT' || coin === 'USDC') return 'ETH';
  if (coin.endsWith('_POL')) return 'POL';
  if (coin.endsWith('_SOL')) return 'SOL';
  return coin;
}
