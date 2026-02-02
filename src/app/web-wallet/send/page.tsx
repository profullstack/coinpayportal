'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWebWallet } from '@/components/web-wallet/WalletContext';
import { WalletHeader } from '@/components/web-wallet/WalletHeader';
import { ChainSelector } from '@/components/web-wallet/ChainSelector';
import { AmountInput } from '@/components/web-wallet/AmountInput';
import {
  decryptWithPassword,
  loadWalletFromStorage,
} from '@/lib/web-wallet/client-crypto';
import type { WalletChain } from '@/lib/web-wallet/identity';

type Step = 'form' | 'confirm' | 'password' | 'sending' | 'success' | 'error';
type Priority = 'low' | 'medium' | 'high';

interface FeeInfo {
  fee: string;
  feeCurrency: string;
}

interface WalletAddress {
  id: string;
  address: string;
  chain: string;
}

export default function SendPage() {
  const router = useRouter();
  const { wallet, chains, isUnlocked } = useWebWallet();

  const [step, setStep] = useState<Step>('form');
  const [chain, setChain] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [addresses, setAddresses] = useState<WalletAddress[]>([]);
  const [loadingAddrs, setLoadingAddrs] = useState(false);
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [fees, setFees] = useState<Record<Priority, FeeInfo> | null>(null);
  const [loadingFees, setLoadingFees] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');
  const [addressError, setAddressError] = useState('');
  const [amountError, setAmountError] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [txStatus, setTxStatus] = useState<'pending' | 'confirming' | 'confirmed' | 'failed'>('pending');
  const [txConfirmations, setTxConfirmations] = useState(0);
  const [redirectCountdown, setRedirectCountdown] = useState(0);
  const txPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isUnlocked) {
      router.replace('/web-wallet/unlock');
    }
  }, [isUnlocked, router]);

  // Fetch addresses for selected chain
  const fetchAddresses = useCallback(async () => {
    if (!wallet || !chain) {
      setAddresses([]);
      setFromAddress('');
      return;
    }
    setLoadingAddrs(true);
    try {
      const data = await wallet.getAddresses({ chain: chain as WalletChain });
      const mapped = data.map((a) => ({
        id: a.addressId,
        address: a.address,
        chain: a.chain,
      }));
      setAddresses(mapped);
      if (mapped.length > 0) {
        setFromAddress(mapped[0].address);
      } else {
        setFromAddress('');
      }
    } catch (err) {
      console.error('Failed to fetch addresses:', err);
      setAddresses([]);
      setFromAddress('');
    } finally {
      setLoadingAddrs(false);
    }
  }, [wallet, chain]);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  // Fetch fee estimates when chain changes
  const fetchFees = useCallback(async () => {
    if (!wallet || !chain) return;
    setLoadingFees(true);
    try {
      const estimate = await wallet.estimateFee(chain as WalletChain);
      setFees({
        low: { fee: estimate.low.fee, feeCurrency: estimate.low.feeCurrency },
        medium: { fee: estimate.medium.fee, feeCurrency: estimate.medium.feeCurrency },
        high: { fee: estimate.high.fee, feeCurrency: estimate.high.feeCurrency },
      });
    } catch (err) {
      console.error('Failed to fetch fee estimates:', err);
      setFees(null);
    } finally {
      setLoadingFees(false);
    }
  }, [wallet, chain]);

  useEffect(() => {
    fetchFees();
  }, [fetchFees]);

  const validateForm = (): boolean => {
    let valid = true;

    if (!fromAddress) {
      valid = false;
    }

    if (!toAddress.trim()) {
      setAddressError('Address is required');
      valid = false;
    } else {
      setAddressError('');
    }

    if (!amount || parseFloat(amount) <= 0) {
      setAmountError('Amount must be greater than 0');
      valid = false;
    } else {
      setAmountError('');
    }

    return valid;
  };

  const handleReview = () => {
    if (!validateForm()) return;
    setStep('confirm');
  };

  const handleConfirmSend = () => {
    setPassword('');
    setPasswordError('');
    setStep('password');
  };

  const handlePasswordSubmit = async () => {
    if (!password) {
      setPasswordError('Password is required');
      return;
    }

    // Verify password by attempting to decrypt
    const stored = loadWalletFromStorage();
    if (!stored) {
      setPasswordError('Wallet data not found');
      return;
    }

    const result = await decryptWithPassword(stored.encrypted, password);
    if (!result) {
      setPasswordError('Incorrect password');
      return;
    }

    // Password verified, proceed with send
    setPassword('');
    await handleSend();
  };

  const handleSend = async () => {
    if (!wallet) return;
    setStep('sending');
    setError('');

    try {
      const result = await wallet.send({
        chain: chain as WalletChain,
        fromAddress,
        toAddress: toAddress.trim(),
        amount,
        priority,
      });
      setTxHash(result.txHash);
      setStep('success');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
      setStep('error');
    }
  };

  // Poll for tx confirmation after broadcast
  useEffect(() => {
    if (step !== 'success' || !wallet || !txHash) return;

    const TX_POLL_MS = 10_000;
    const REDIRECT_AFTER_MS = 5_000;

    const pollTxStatus = async () => {
      try {
        // Find the tx by looking at recent outgoing transactions
        const txData = await wallet.getTransactions({
          limit: 5,
          direction: 'outgoing',
        });
        const tx = txData.transactions.find((t) => t.txHash === txHash);
        if (tx) {
          setTxStatus(tx.status as typeof txStatus);
          setTxConfirmations(tx.confirmations);

          if (tx.status === 'confirmed') {
            // Stop polling once confirmed
            if (txPollRef.current) {
              clearInterval(txPollRef.current);
              txPollRef.current = null;
            }
          }
        }
      } catch (err) {
        console.error('Failed to poll tx status:', err);
      }
    };

    // Initial check
    pollTxStatus();
    txPollRef.current = setInterval(pollTxStatus, TX_POLL_MS);

    return () => {
      if (txPollRef.current) {
        clearInterval(txPollRef.current);
        txPollRef.current = null;
      }
    };
  }, [step, wallet, txHash]);

  // Auto-redirect countdown after success
  useEffect(() => {
    if (step !== 'success') return;

    const REDIRECT_DELAY_MS = 5_000;
    const seconds = Math.ceil(REDIRECT_DELAY_MS / 1000);
    setRedirectCountdown(seconds);

    const countdownInterval = setInterval(() => {
      setRedirectCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const redirectTimer = setTimeout(() => {
      router.push('/web-wallet');
    }, REDIRECT_DELAY_MS);

    return () => {
      clearInterval(countdownInterval);
      clearTimeout(redirectTimer);
    };
  }, [step, router]);

  const getSymbol = (c: string) => {
    const map: Record<string, string> = {
      BTC: 'BTC', BCH: 'BCH', ETH: 'ETH', POL: 'POL', SOL: 'SOL',
      USDC_ETH: 'USDC', USDC_POL: 'USDC', USDC_SOL: 'USDC',
    };
    return map[c] || c;
  };

  const priorityLabels: Record<Priority, string> = {
    low: 'Slow',
    medium: 'Standard',
    high: 'Fast',
  };

  return (
    <>
      <WalletHeader />
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="mb-6">
          <Link
            href="/web-wallet"
            className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            &larr; Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-white">Send</h1>
        </div>

        {step === 'form' && (
          <div className="space-y-6">
            <ChainSelector
              value={chain}
              onChange={(c) => {
                setChain(c);
                setFromAddress('');
              }}
              chains={chains}
              label="Chain"
            />

            {/* From address selector */}
            {chain && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">
                  From Address
                </label>
                {loadingAddrs ? (
                  <div className="h-12 rounded-lg bg-white/5 animate-pulse" aria-busy="true" />
                ) : addresses.length > 0 ? (
                  <select
                    value={fromAddress}
                    onChange={(e) => setFromAddress(e.target.value)}
                    aria-label="From address"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white font-mono text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 appearance-none"
                  >
                    {addresses.map((a) => (
                      <option key={a.id} value={a.address} className="bg-slate-900">
                        {a.address.slice(0, 12)}...{a.address.slice(-8)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3" role="alert">
                    <p className="text-xs text-yellow-400">
                      No {chain} addresses found.{' '}
                      <Link
                        href="/web-wallet/receive"
                        className="underline hover:text-yellow-300"
                      >
                        Derive one first
                      </Link>
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="recipient-address" className="block text-sm font-medium text-gray-300">
                Recipient Address
              </label>
              <input
                id="recipient-address"
                type="text"
                value={toAddress}
                onChange={(e) => {
                  setToAddress(e.target.value);
                  setAddressError('');
                }}
                placeholder="Enter recipient address"
                className={`w-full rounded-lg border bg-white/5 px-4 py-3 text-white placeholder-gray-500 font-mono text-sm focus:outline-none focus:ring-1 ${
                  addressError
                    ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                    : 'border-white/10 focus:border-purple-500 focus:ring-purple-500'
                }`}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!addressError}
                aria-describedby={addressError ? 'address-error' : undefined}
              />
              {addressError && (
                <p id="address-error" className="text-xs text-red-400" role="alert">{addressError}</p>
              )}
            </div>

            <AmountInput
              value={amount}
              onChange={(v) => {
                setAmount(v);
                setAmountError('');
              }}
              symbol={chain ? getSymbol(chain) : ''}
              label="Amount"
              error={amountError}
            />

            {/* Fee selector */}
            {chain && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">
                  Transaction Speed
                </label>
                {loadingFees ? (
                  <div className="h-16 rounded-lg bg-white/5 animate-pulse" aria-busy="true" />
                ) : (
                  <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Transaction speed">
                    {(['low', 'medium', 'high'] as const).map((level) => (
                      <button
                        key={level}
                        type="button"
                        role="radio"
                        aria-checked={priority === level}
                        onClick={() => setPriority(level)}
                        className={`rounded-lg border p-3 text-center transition-colors ${
                          priority === level
                            ? 'border-purple-500 bg-purple-500/10 text-white'
                            : 'border-white/10 bg-white/5 text-gray-400 hover:border-white/20'
                        }`}
                      >
                        <p className="text-xs font-medium">
                          {priorityLabels[level]}
                        </p>
                        {fees && (
                          <p className="mt-1 text-[10px] text-gray-400">
                            {fees[level].fee} {fees[level].feeCurrency}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleReview}
              disabled={!chain || !fromAddress || !toAddress || !amount}
              className="w-full rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Review Transaction
            </button>
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-6">
            <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-white">
                Confirm Transaction
              </h2>

              <div className="space-y-3">
                <Row label="Chain" value={chain} />
                <Row
                  label="From"
                  value={`${fromAddress.slice(0, 10)}...${fromAddress.slice(-6)}`}
                  mono
                />
                <Row
                  label="To"
                  value={`${toAddress.slice(0, 10)}...${toAddress.slice(-6)}`}
                  mono
                />
                <Row
                  label="Amount"
                  value={`${amount} ${getSymbol(chain)}`}
                />
                <Row label="Speed" value={priorityLabels[priority]} />
                {fees && (
                  <Row
                    label="Est. Fee"
                    value={`${fees[priority].fee} ${fees[priority].feeCurrency}`}
                  />
                )}
              </div>
            </div>

            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4" role="alert">
              <p className="text-xs text-yellow-400">
                Please verify the address carefully. Transactions cannot be reversed.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('form')}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm text-gray-300 hover:bg-white/10 transition-colors"
              >
                Edit
              </button>
              <button
                onClick={handleConfirmSend}
                className="flex-1 rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors"
              >
                Send Now
              </button>
            </div>
          </div>
        )}

        {step === 'password' && (
          <div className="space-y-6">
            <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-white">
                Enter Password
              </h2>
              <p className="text-sm text-gray-400">
                Enter your wallet password to authorize this transaction.
              </p>

              <div className="space-y-2">
                <label htmlFor="send-password" className="block text-sm font-medium text-gray-300">
                  Password
                </label>
                <input
                  id="send-password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handlePasswordSubmit();
                  }}
                  placeholder="Enter your password"
                  className={`w-full rounded-lg border bg-white/5 px-4 py-3 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-1 ${
                    passwordError
                      ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                      : 'border-white/10 focus:border-purple-500 focus:ring-purple-500'
                  }`}
                  autoFocus
                  aria-invalid={!!passwordError}
                  aria-describedby={passwordError ? 'password-error' : undefined}
                />
                {passwordError && (
                  <p id="password-error" className="text-xs text-red-400" role="alert">{passwordError}</p>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setPassword('');
                  setPasswordError('');
                  setStep('confirm');
                }}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm text-gray-300 hover:bg-white/10 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handlePasswordSubmit}
                disabled={!password}
                className="flex-1 rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Authorize & Send
              </button>
            </div>
          </div>
        )}

        {step === 'sending' && (
          <div className="flex flex-col items-center justify-center py-16 space-y-4" aria-busy="true">
            <div className="h-12 w-12 animate-spin rounded-full border-3 border-purple-500 border-t-transparent" />
            <p className="text-sm text-gray-400">Signing & broadcasting...</p>
          </div>
        )}

        {step === 'success' && (
          <div className="space-y-6 text-center py-8">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
              <svg
                className="h-8 w-8 text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Transaction Sent</h2>
              <p className="mt-1 text-sm text-gray-400">
                {amount} {getSymbol(chain)} sent successfully
              </p>
            </div>

            {/* Live tx status */}
            <div className="flex items-center justify-center gap-2">
              {txStatus === 'confirmed' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 border border-green-500/30 px-3 py-1 text-xs font-medium text-green-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                  Confirmed ({txConfirmations} {txConfirmations === 1 ? 'confirmation' : 'confirmations'})
                </span>
              ) : txStatus === 'confirming' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/30 px-3 py-1 text-xs font-medium text-yellow-400">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400" />
                  </span>
                  Confirming... ({txConfirmations} {txConfirmations === 1 ? 'confirmation' : 'confirmations'})
                </span>
              ) : txStatus === 'failed' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 border border-red-500/30 px-3 py-1 text-xs font-medium text-red-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                  Failed
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-500/10 border border-purple-500/30 px-3 py-1 text-xs font-medium text-purple-400">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-purple-400" />
                  </span>
                  Pending...
                </span>
              )}
            </div>

            {txHash && (
              <p className="text-xs text-gray-400 font-mono break-all">
                TX: {txHash}
              </p>
            )}

            <p className="text-xs text-gray-500">
              Redirecting to dashboard in {redirectCountdown}s...
            </p>

            <div className="flex gap-3">
              <Link
                href="/web-wallet"
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm text-gray-300 hover:bg-white/10 transition-colors text-center"
              >
                Dashboard
              </Link>
              <Link
                href={`/web-wallet/tx/${txHash}`}
                className="flex-1 rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors text-center"
              >
                View Details
              </Link>
            </div>
          </div>
        )}

        {step === 'error' && (
          <div className="space-y-6 text-center py-8">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20">
              <svg
                className="h-8 w-8 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Transaction Failed</h2>
              <p className="mt-2 text-sm text-red-400">{error}</p>
            </div>
            <button
              onClick={() => setStep('form')}
              className="rounded-xl bg-purple-600 px-8 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-400">{label}</span>
      <span
        className={`text-sm text-white ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}
