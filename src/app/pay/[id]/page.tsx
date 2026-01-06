'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

const PAYMENT_EXPIRY_MINUTES = 15;
const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds
const BALANCE_CHECK_INTERVAL_MS = 15000; // Check blockchain balance every 15 seconds

interface Payment {
  id: string;
  business_id: string;
  payment_address: string;
  amount: string;
  crypto_amount: string;
  currency?: string;
  crypto_currency?: string;
  blockchain: string;
  status: string;
  description?: string;
  created_at: string;
  expires_at?: string;
  tx_hash?: string;
  forward_tx_hash?: string;
  metadata?: {
    network_fee_usd?: number;
    total_amount_usd?: number;
    description?: string;
    redirect_url?: string;
  };
}

interface Business {
  id: string;
  name: string;
}

// Get blockchain explorer URL for a transaction
const getExplorerUrl = (blockchain: string, txHash: string): string => {
  const explorers: Record<string, string> = {
    BTC: `https://blockstream.info/tx/${txHash}`,
    BCH: `https://blockchair.com/bitcoin-cash/transaction/${txHash}`,
    ETH: `https://etherscan.io/tx/${txHash}`,
    POL: `https://polygonscan.com/tx/${txHash}`,
    SOL: `https://solscan.io/tx/${txHash}`,
    USDC_ETH: `https://etherscan.io/tx/${txHash}`,
    USDC_POL: `https://polygonscan.com/tx/${txHash}`,
    USDC_SOL: `https://solscan.io/tx/${txHash}`,
  };
  return explorers[blockchain] || `https://blockchair.com/search?q=${txHash}`;
};

// Get currency display name
const getCurrencyName = (blockchain: string): string => {
  const names: Record<string, string> = {
    BTC: 'Bitcoin',
    BCH: 'Bitcoin Cash',
    ETH: 'Ethereum',
    POL: 'Polygon',
    SOL: 'Solana',
    USDC_ETH: 'USDC (Ethereum)',
    USDC_POL: 'USDC (Polygon)',
    USDC_SOL: 'USDC (Solana)',
  };
  return names[blockchain] || blockchain;
};

// Get currency icon/color
const getCurrencyColor = (blockchain: string): string => {
  const colors: Record<string, string> = {
    BTC: 'bg-orange-500',
    BCH: 'bg-green-500',
    ETH: 'bg-blue-500',
    POL: 'bg-purple-500',
    SOL: 'bg-gradient-to-r from-purple-500 to-teal-400',
    USDC_ETH: 'bg-blue-400',
    USDC_POL: 'bg-purple-400',
    USDC_SOL: 'bg-teal-400',
  };
  return colors[blockchain] || 'bg-gray-500';
};

export default function PublicPaymentPage() {
  const params = useParams();
  const paymentId = params.id as string;

  const [payment, setPayment] = useState<Payment | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [paymentStatus, setPaymentStatus] = useState<string>('pending');
  const [qrLoaded, setQrLoaded] = useState(false);
  const [qrError, setQrError] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const balanceCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastBalanceCheckRef = useRef<number>(0);

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Calculate time remaining based on expires_at or created_at
  const calculateTimeRemaining = useCallback((payment: Payment) => {
    let expiresAt: Date;
    if (payment.expires_at) {
      expiresAt = new Date(payment.expires_at);
    } else {
      const created = new Date(payment.created_at);
      expiresAt = new Date(created.getTime() + PAYMENT_EXPIRY_MINUTES * 60 * 1000);
    }
    const now = new Date();
    const remaining = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
    return remaining;
  }, []);

  // Check blockchain balance directly (no auth required)
  const checkBlockchainBalance = useCallback(async () => {
    try {
      console.log(`Checking blockchain balance for payment ${paymentId}...`);
      
      const response = await fetch(`/api/payments/${paymentId}/check-balance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Balance check result:', data);
        
        if (data.status && data.status !== 'pending') {
          // Payment status changed, update UI
          setPaymentStatus(data.status);
          
          // Fetch full payment details
          const paymentResponse = await fetch(`/api/payments/${paymentId}`);
          if (paymentResponse.ok) {
            const paymentData = await paymentResponse.json();
            if (paymentData.success && paymentData.payment) {
              setPayment(paymentData.payment);
            }
          }
          
          // Stop checking if payment is no longer pending
          if (['confirmed', 'forwarded', 'expired', 'failed'].includes(data.status)) {
            if (balanceCheckIntervalRef.current) {
              clearInterval(balanceCheckIntervalRef.current);
              balanceCheckIntervalRef.current = null;
            }
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            if (timerIntervalRef.current) {
              clearInterval(timerIntervalRef.current);
              timerIntervalRef.current = null;
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to check blockchain balance:', err);
    }
  }, [paymentId]);

  // Poll for payment status (no auth required)
  const pollPaymentStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/payments/${paymentId}`);

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.payment) {
          setPayment(data.payment);
          setPaymentStatus(data.payment.status);

          // Stop polling if payment is complete or failed
          const isTerminalStatus = ['expired', 'failed'].includes(data.payment.status);
          const isCompleteWithTxHash = ['confirmed', 'forwarded'].includes(data.payment.status) &&
            (data.payment.tx_hash || data.payment.forward_tx_hash);
          
          if (isTerminalStatus || isCompleteWithTxHash) {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            if (timerIntervalRef.current) {
              clearInterval(timerIntervalRef.current);
              timerIntervalRef.current = null;
            }
            if (balanceCheckIntervalRef.current) {
              clearInterval(balanceCheckIntervalRef.current);
              balanceCheckIntervalRef.current = null;
            }
          }
        }
      }
      
      // Also check blockchain balance periodically during polling
      const now = Date.now();
      if (now - lastBalanceCheckRef.current >= BALANCE_CHECK_INTERVAL_MS) {
        lastBalanceCheckRef.current = now;
        checkBlockchainBalance();
      }
    } catch (err) {
      console.error('Failed to poll payment status:', err);
    }
  }, [paymentId, checkBlockchainBalance]);

  // Fetch payment on mount (no auth required)
  useEffect(() => {
    const fetchPayment = async () => {
      try {
        const response = await fetch(`/api/payments/${paymentId}`);
        const data = await response.json();

        if (!response.ok || !data.success) {
          setError(data.error || 'Payment not found');
          setLoading(false);
          return;
        }

        setPayment(data.payment);
        setPaymentStatus(data.payment.status);
        
        // Calculate initial time remaining
        if (data.payment.created_at) {
          const remaining = calculateTimeRemaining(data.payment);
          setTimeRemaining(remaining);
        }
        
        // Fetch business info
        if (data.payment.business_id) {
          try {
            const businessResponse = await fetch(`/api/businesses/${data.payment.business_id}`);
            if (businessResponse.ok) {
              const businessData = await businessResponse.json();
              if (businessData.success && businessData.business) {
                setBusiness(businessData.business);
              }
            }
          } catch (err) {
            // Business info is optional, don't fail if we can't get it
            console.error('Failed to fetch business info:', err);
          }
        }
        
        setLoading(false);
      } catch (err) {
        setError('Failed to load payment');
        setLoading(false);
      }
    };

    if (paymentId) {
      fetchPayment();
    }
  }, [paymentId, calculateTimeRemaining]);

  // Start polling and timer when payment is loaded and pending/forwarding
  useEffect(() => {
    const needsPolling = paymentStatus === 'pending' ||
      paymentStatus === 'detected' ||
      paymentStatus === 'forwarding' ||
      ((paymentStatus === 'confirmed' || paymentStatus === 'forwarded') &&
       !payment?.tx_hash && !payment?.forward_tx_hash);
    
    if (payment?.id && needsPolling) {
      // Start polling for payment status
      pollIntervalRef.current = setInterval(() => {
        pollPaymentStatus();
      }, POLL_INTERVAL_MS);

      // Start blockchain balance checking
      checkBlockchainBalance();
      lastBalanceCheckRef.current = Date.now();
      
      balanceCheckIntervalRef.current = setInterval(() => {
        checkBlockchainBalance();
      }, BALANCE_CHECK_INTERVAL_MS);

      // Start countdown timer
      timerIntervalRef.current = setInterval(() => {
        if (payment.created_at) {
          const remaining = calculateTimeRemaining(payment);
          setTimeRemaining(remaining);

          if (remaining === 0 && paymentStatus === 'pending') {
            if (timerIntervalRef.current) {
              clearInterval(timerIntervalRef.current);
              timerIntervalRef.current = null;
            }
          }
        }
      }, 1000);

      // Cleanup on unmount
      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
        }
        if (balanceCheckIntervalRef.current) {
          clearInterval(balanceCheckIntervalRef.current);
        }
      };
    }
  }, [payment?.id, payment?.created_at, paymentStatus, pollPaymentStatus, calculateTimeRemaining, checkBlockchainBalance]);

  // Auto-redirect when payment is complete and redirect_url is configured
  // Include 'forwarding' status since customer has already paid - they don't need to wait for internal forwarding
  useEffect(() => {
    const isComplete = paymentStatus === 'confirmed' || paymentStatus === 'forwarding' || paymentStatus === 'forwarded';
    const redirectUrl = payment?.metadata?.redirect_url;

    if (isComplete && redirectUrl) {
      // Wait 5 seconds before redirecting to let user see the success message
      const redirectTimeout = setTimeout(() => {
        window.location.href = redirectUrl;
      }, 5000);

      return () => clearTimeout(redirectTimeout);
    }
  }, [paymentStatus, payment?.metadata?.redirect_url]);

  // Format time remaining as MM:SS
  const formatTimeRemaining = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400 mx-auto"></div>
          <p className="mt-4 text-gray-300">Loading payment...</p>
        </div>
      </div>
    );
  }

  if (error || !payment) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl shadow-xl p-8 text-center border border-gray-700">
            <svg
              className="mx-auto h-16 w-16 text-red-400"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
            <h3 className="mt-4 text-xl font-semibold text-white">
              Payment Not Found
            </h3>
            <p className="mt-2 text-gray-400">
              {error || 'This payment link is invalid or has expired.'}
            </p>
            <div className="mt-6">
              <Link
                href="/"
                className="inline-flex items-center px-6 py-3 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-purple-600 hover:bg-purple-500 transition-colors"
              >
                Go to Homepage
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Customer's payment is complete once confirmed - forwarding is internal and shouldn't affect their experience
  const isPaymentComplete = paymentStatus === 'confirmed' || paymentStatus === 'forwarding' || paymentStatus === 'forwarded';
  const isPaymentFailed = paymentStatus === 'expired' || paymentStatus === 'failed';
  const isPaymentPending = paymentStatus === 'pending' || paymentStatus === 'detected';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 py-8 px-4">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <Link href="/" className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 transition-colors mb-4">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="font-semibold">CoinPay</span>
          </Link>
          {business && (
            <p className="text-gray-400 text-sm">Payment to {business.name}</p>
          )}
        </div>

        {/* Main Payment Card */}
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl shadow-xl overflow-hidden border border-gray-700">
          {/* Status Header */}
          <div className={`px-6 py-4 ${
            isPaymentComplete ? 'bg-green-500/20 border-b border-green-500/30' :
            isPaymentFailed ? 'bg-red-500/20 border-b border-red-500/30' :
            'bg-purple-500/20 border-b border-purple-500/30'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isPaymentPending && (
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-purple-400 border-t-transparent"></div>
                )}
                {isPaymentComplete && (
                  <div className="h-6 w-6 rounded-full bg-green-500 flex items-center justify-center">
                    <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
                {isPaymentFailed && (
                  <div className="h-6 w-6 rounded-full bg-red-500 flex items-center justify-center">
                    <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    {isPaymentComplete ? 'Payment Complete!' :
                     isPaymentFailed ? (paymentStatus === 'expired' ? 'Payment Expired' : 'Payment Failed') :
                     paymentStatus === 'detected' ? 'Payment Detected!' :
                     'Awaiting Payment'}
                  </h2>
                  {isPaymentPending && (
                    <p className="text-sm text-gray-300">
                      {paymentStatus === 'detected' ? 'Waiting for blockchain confirmation...' :
                       'Send the exact amount below'}
                    </p>
                  )}
                  {isPaymentComplete && (
                    <p className="text-sm text-gray-300">
                      Thank you! Your payment has been received.
                    </p>
                  )}
                </div>
              </div>
              {isPaymentPending && timeRemaining > 0 && (
                <div className="text-right">
                  <div className="text-2xl font-mono font-bold text-white">
                    {formatTimeRemaining(timeRemaining)}
                  </div>
                  <p className="text-xs text-gray-400">remaining</p>
                </div>
              )}
            </div>
            
            {/* Progress bar */}
            {isPaymentPending && timeRemaining > 0 && (
              <div className="mt-3 w-full bg-gray-700 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all duration-1000 ${
                    paymentStatus === 'detected' ? 'bg-blue-500' : 'bg-purple-500'
                  }`}
                  style={{ width: `${(timeRemaining / (PAYMENT_EXPIRY_MINUTES * 60)) * 100}%` }}
                ></div>
              </div>
            )}
          </div>

          <div className="p-6 space-y-6">
            {/* Amount Display */}
            <div className="text-center">
              <div className="flex items-center justify-center gap-3 mb-2">
                <div className={`w-10 h-10 rounded-full ${getCurrencyColor(payment.blockchain)} flex items-center justify-center`}>
                  <span className="text-white font-bold text-sm">
                    {payment.blockchain.slice(0, 1)}
                  </span>
                </div>
                <div>
                  <p className="text-3xl font-bold text-white">
                    {payment.crypto_amount ? parseFloat(payment.crypto_amount).toFixed(8) : 'N/A'}
                  </p>
                  <p className="text-sm text-gray-400">
                    {getCurrencyName(payment.blockchain)}
                  </p>
                </div>
              </div>

              {/* Fee Breakdown */}
              {payment.metadata?.network_fee_usd ? (
                <div className="bg-gray-900/50 rounded-lg p-3 mt-2 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>Product price:</span>
                    <span>${parseFloat(payment.amount).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Network fee:</span>
                    <span>${payment.metadata.network_fee_usd.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-white font-medium border-t border-gray-700 pt-2 mt-2">
                    <span>Total:</span>
                    <span>${payment.metadata.total_amount_usd?.toFixed(2) || (parseFloat(payment.amount) + payment.metadata.network_fee_usd).toFixed(2)}</span>
                  </div>
                </div>
              ) : (
                <p className="text-gray-400">
                  ≈ ${payment.amount ? parseFloat(payment.amount).toFixed(2) : 'N/A'} USD
                </p>
              )}

              {payment.crypto_amount && (
                <button
                  onClick={() => copyToClipboard(parseFloat(payment.crypto_amount).toFixed(8), 'amount')}
                  className="mt-2 inline-flex items-center gap-1 text-sm text-purple-400 hover:text-purple-300 transition-colors"
                >
                  {copiedField === 'amount' ? (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy amount
                    </>
                  )}
                </button>
              )}
            </div>

            {/* QR Code */}
            {payment.payment_address && !isPaymentFailed && (
              <div className="flex justify-center">
                <div className="bg-white p-4 rounded-xl">
                  {!qrError ? (
                    <>
                      {!qrLoaded && (
                        <div className="w-48 h-48 flex items-center justify-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                        </div>
                      )}
                      <img
                        key={`qr-${payment.id}`}
                        src={`/api/payments/${payment.id}/qr`}
                        alt="Payment QR Code"
                        className={`w-48 h-48 ${qrLoaded ? '' : 'hidden'}`}
                        onLoad={() => setQrLoaded(true)}
                        onError={() => {
                          setQrError(true);
                          setQrLoaded(false);
                        }}
                      />
                    </>
                  ) : (
                    <div className="w-48 h-48 flex items-center justify-center text-gray-500 text-sm">
                      <div className="text-center">
                        <svg className="w-12 h-12 mx-auto text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <p>QR unavailable</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Payment Address */}
            {payment.payment_address && !isPaymentFailed && (
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Send to this address:
                </label>
                <div className="bg-gray-900/50 rounded-xl p-4 flex items-center gap-3">
                  <p className="font-mono text-sm text-white break-all flex-1">
                    {payment.payment_address}
                  </p>
                  <button
                    onClick={() => copyToClipboard(payment.payment_address, 'address')}
                    className="flex-shrink-0 p-2 text-gray-400 hover:text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors"
                    title="Copy address"
                  >
                    {copiedField === 'address' ? (
                      <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Transaction Links (for completed payments) */}
            {isPaymentComplete && (payment.tx_hash || payment.forward_tx_hash) && (
              <div className="bg-green-500/10 rounded-xl p-4 space-y-2">
                <h4 className="text-sm font-medium text-green-400 mb-2">Transaction Details</h4>
                {payment.tx_hash && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Payment TX:</span>
                    <a
                      href={getExplorerUrl(payment.blockchain, payment.tx_hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-sm text-purple-400 hover:text-purple-300 flex items-center gap-1"
                    >
                      {payment.tx_hash.slice(0, 8)}...{payment.tx_hash.slice(-6)}
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                )}
                {payment.forward_tx_hash && payment.forward_tx_hash !== payment.tx_hash && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Forward TX:</span>
                    <a
                      href={getExplorerUrl(payment.blockchain, payment.forward_tx_hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-sm text-purple-400 hover:text-purple-300 flex items-center gap-1"
                    >
                      {payment.forward_tx_hash.slice(0, 8)}...{payment.forward_tx_hash.slice(-6)}
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Return to Merchant Button (for completed payments with redirect_url) */}
            {isPaymentComplete && payment.metadata?.redirect_url && (
              <div className="text-center">
                <a
                  href={payment.metadata.redirect_url}
                  className="inline-flex items-center justify-center gap-2 w-full px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-xl transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Return to Merchant
                </a>
                <p className="text-xs text-gray-500 mt-2">
                  You will be redirected automatically in a few seconds...
                </p>
              </div>
            )}

            {/* Description */}
            {payment.description && (
              <div className="bg-gray-900/50 rounded-xl p-4">
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Description
                </label>
                <p className="text-white">{payment.description}</p>
              </div>
            )}

            {/* Payment Info */}
            <div className="text-center text-xs text-gray-500 space-y-1">
              <p>Payment ID: {payment.id}</p>
              <p>Created: {new Date(payment.created_at).toLocaleString()}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-gray-500 text-sm">
            Powered by{' '}
            <Link href="/" className="text-purple-400 hover:text-purple-300 transition-colors">
              CoinPay
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
