'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';

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
}

// Get blockchain explorer URL for a transaction
const getExplorerUrl = (blockchain: string, txHash: string): string => {
  const explorers: Record<string, string> = {
    BTC: `https://blockstream.info/tx/${txHash}`,
    BCH: `https://blockchair.com/bitcoin-cash/transaction/${txHash}`,
    ETH: `https://etherscan.io/tx/${txHash}`,
    MATIC: `https://polygonscan.com/tx/${txHash}`,
    SOL: `https://solscan.io/tx/${txHash}`,
    USDC_ETH: `https://etherscan.io/tx/${txHash}`,
    USDC_MATIC: `https://polygonscan.com/tx/${txHash}`,
    USDC_SOL: `https://solscan.io/tx/${txHash}`,
  };
  return explorers[blockchain] || `https://blockchair.com/search?q=${txHash}`;
};

// Get blockchain explorer URL for an address
const getAddressExplorerUrl = (blockchain: string, address: string): string => {
  const explorers: Record<string, string> = {
    BTC: `https://blockstream.info/address/${address}`,
    BCH: `https://blockchair.com/bitcoin-cash/address/${address}`,
    ETH: `https://etherscan.io/address/${address}`,
    MATIC: `https://polygonscan.com/address/${address}`,
    SOL: `https://solscan.io/account/${address}`,
    USDC_ETH: `https://etherscan.io/address/${address}`,
    USDC_MATIC: `https://polygonscan.com/address/${address}`,
    USDC_SOL: `https://solscan.io/account/${address}`,
  };
  return explorers[blockchain] || `https://blockchair.com/search?q=${address}`;
};

export default function PaymentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const paymentId = params.id as string;

  const [payment, setPayment] = useState<Payment | null>(null);
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

  // Check blockchain balance directly
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
          const token = localStorage.getItem('auth_token');
          if (token) {
            const paymentResponse = await fetch(`/api/payments/${paymentId}`, {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            });
            if (paymentResponse.ok) {
              const paymentData = await paymentResponse.json();
              if (paymentData.success && paymentData.payment) {
                setPayment(paymentData.payment);
              }
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

  // Poll for payment status
  const pollPaymentStatus = useCallback(async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;

      const response = await fetch(`/api/payments/${paymentId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.payment) {
          setPayment(data.payment);
          setPaymentStatus(data.payment.status);

          // Stop polling if payment is complete or failed
          if (['confirmed', 'forwarded', 'expired', 'failed'].includes(data.payment.status)) {
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

  // Fetch payment on mount
  useEffect(() => {
    const fetchPayment = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (!token) {
          router.push('/login');
          return;
        }

        const response = await fetch(`/api/payments/${paymentId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          setError(data.error || 'Failed to load payment');
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
        
        setLoading(false);
      } catch (err) {
        setError('Failed to load payment');
        setLoading(false);
      }
    };

    if (paymentId) {
      fetchPayment();
    }
  }, [paymentId, router, calculateTimeRemaining]);

  // Start polling and timer when payment is loaded and pending
  useEffect(() => {
    if (payment?.id && (paymentStatus === 'pending' || paymentStatus === 'detected')) {
      // Start polling for payment status
      pollIntervalRef.current = setInterval(() => {
        pollPaymentStatus();
      }, POLL_INTERVAL_MS);

      // Start blockchain balance checking (more frequent for faster detection)
      // Do an immediate check first
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

          // Only set expired on client if timer reaches 0 AND status is still pending
          // The server will also mark it expired, so this is just for UI feedback
          if (remaining === 0 && paymentStatus === 'pending') {
            // Don't immediately set to expired - let the next poll confirm it
            // This prevents the QR from disappearing before the server confirms
            // Just stop the timer
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

  // Format time remaining as MM:SS
  const formatTimeRemaining = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Get status color and text
  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'pending':
        return { color: 'text-yellow-600 bg-yellow-50', text: 'Waiting for payment...' };
      case 'detected':
        return { color: 'text-blue-600 bg-blue-50', text: 'Payment detected! Confirming...' };
      case 'confirmed':
        return { color: 'text-green-600 bg-green-50', text: 'Payment confirmed!' };
      case 'forwarding':
        return { color: 'text-blue-600 bg-blue-50', text: 'Forwarding payment...' };
      case 'forwarded':
        return { color: 'text-green-600 bg-green-50', text: 'Payment complete!' };
      case 'expired':
        return { color: 'text-red-600 bg-red-50', text: 'Payment expired' };
      case 'failed':
        return { color: 'text-red-600 bg-red-50', text: 'Payment failed' };
      default:
        return { color: 'text-gray-600 bg-gray-50', text: status };
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading payment...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <svg
              className="mx-auto h-12 w-12 text-red-400"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
            <h3 className="mt-2 text-lg font-medium text-gray-900">
              Payment Not Found
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {error}
            </p>
            <div className="mt-6">
              <button
                onClick={() => router.push('/payments/history')}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-500"
              >
                View Payment History
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!payment) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className={`px-6 py-4 border-b ${getStatusDisplay(paymentStatus).color.replace('text-', 'border-').split(' ')[0]}-200`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                {paymentStatus === 'pending' && (
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-yellow-600 border-t-transparent mr-2"></div>
                )}
                {paymentStatus === 'detected' && (
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent mr-2"></div>
                )}
                {(paymentStatus === 'confirmed' || paymentStatus === 'forwarded') && (
                  <svg className="h-5 w-5 text-green-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {(paymentStatus === 'expired' || paymentStatus === 'failed') && (
                  <svg className="h-5 w-5 text-red-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                <h2 className="text-lg font-semibold">
                  {getStatusDisplay(paymentStatus).text}
                </h2>
              </div>
              {(paymentStatus === 'pending' || paymentStatus === 'detected') && timeRemaining > 0 && (
                <div className="flex items-center gap-2 text-sm font-mono">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {formatTimeRemaining(timeRemaining)}
                </div>
              )}
            </div>
            
            {/* Progress bar for pending payments */}
            {(paymentStatus === 'pending' || paymentStatus === 'detected') && timeRemaining > 0 && (
              <div className="mt-3 w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-1000 ${
                    paymentStatus === 'detected' ? 'bg-blue-500' : 'bg-yellow-500'
                  }`}
                  style={{ width: `${(timeRemaining / (PAYMENT_EXPIRY_MINUTES * 60)) * 100}%` }}
                ></div>
              </div>
            )}
          </div>

          <div className="p-6 space-y-6">
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                Payment Address
              </h3>
              {payment.payment_address ? (
                <div className="bg-gray-50 p-4 rounded-lg flex items-center justify-between gap-3">
                  <p className="font-mono text-sm text-gray-900 break-all flex-1">
                    {payment.payment_address}
                  </p>
                  <button
                    onClick={() => copyToClipboard(payment.payment_address, 'address')}
                    className="flex-shrink-0 p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                    title="Copy address"
                  >
                    {copiedField === 'address' ? (
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
              ) : (
                <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                  <p className="text-sm text-yellow-800">
                    Payment address is being generated. Please refresh the page in a moment.
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  Amount (Crypto)
                </h3>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-semibold text-gray-900">
                    {payment.crypto_amount ? parseFloat(payment.crypto_amount).toFixed(8) : 'N/A'}{' '}
                    {payment.crypto_currency?.toUpperCase() || payment.blockchain}
                  </p>
                  {payment.crypto_amount && (
                    <button
                      onClick={() => copyToClipboard(parseFloat(payment.crypto_amount).toFixed(8), 'amount')}
                      className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors"
                      title="Copy amount"
                    >
                      {copiedField === 'amount' ? (
                        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  Amount (USD)
                </h3>
                <p className="text-lg font-semibold text-gray-900">
                  ${payment.amount ? parseFloat(payment.amount).toFixed(2) : 'N/A'}
                </p>
              </div>
            </div>

            {payment.id && payment.payment_address && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  QR Code
                  {(paymentStatus !== 'pending' && paymentStatus !== 'detected') && (
                    <span className="ml-2 text-xs text-gray-500 font-normal">(for reference)</span>
                  )}
                </h3>
                <div className="flex justify-center bg-white p-4 rounded-lg border border-gray-200">
                  {!qrError ? (
                    <>
                      {!qrLoaded && (
                        <div className="w-64 h-64 flex items-center justify-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                        </div>
                      )}
                      <img
                        key={`qr-${payment.id}`}
                        src={`/api/payments/${payment.id}/qr`}
                        alt="Payment QR Code"
                        className={`w-64 h-64 ${qrLoaded ? '' : 'hidden'}`}
                        onLoad={() => setQrLoaded(true)}
                        onError={() => {
                          setQrError(true);
                          setQrLoaded(false);
                        }}
                      />
                    </>
                  ) : (
                    <div className="w-64 h-64 flex items-center justify-center text-gray-500 text-sm">
                      <div className="text-center">
                        <svg className="w-12 h-12 mx-auto text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <p>QR code unavailable</p>
                        <p className="text-xs mt-1">Use the address above to pay</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Payment Details */}
            <div className="bg-gray-50 p-4 rounded-lg space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Payment ID:</span>
                <span className="font-mono text-gray-900">{payment.id}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Status:</span>
                <span className={`font-medium px-2 py-0.5 rounded ${
                  payment.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                  payment.status === 'detected' ? 'bg-blue-100 text-blue-800' :
                  payment.status === 'confirmed' || payment.status === 'forwarded' ? 'bg-green-100 text-green-800' :
                  payment.status === 'expired' || payment.status === 'failed' ? 'bg-red-100 text-red-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Blockchain:</span>
                <span className="text-gray-900">{payment.blockchain}</span>
              </div>
              {payment.payment_address && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Address:</span>
                  <a
                    href={getAddressExplorerUrl(payment.blockchain, payment.payment_address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-purple-600 hover:text-purple-800 hover:underline flex items-center gap-1"
                  >
                    {payment.payment_address.slice(0, 8)}...{payment.payment_address.slice(-6)}
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              )}
              {payment.tx_hash && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Transaction:</span>
                  <a
                    href={getExplorerUrl(payment.blockchain, payment.tx_hash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-purple-600 hover:text-purple-800 hover:underline flex items-center gap-1"
                  >
                    {payment.tx_hash.slice(0, 8)}...{payment.tx_hash.slice(-6)}
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              )}
              {payment.forward_tx_hash && payment.forward_tx_hash !== payment.tx_hash && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Forward TX:</span>
                  <a
                    href={getExplorerUrl(payment.blockchain, payment.forward_tx_hash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-purple-600 hover:text-purple-800 hover:underline flex items-center gap-1"
                  >
                    {payment.forward_tx_hash.slice(0, 8)}...{payment.forward_tx_hash.slice(-6)}
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              )}
              {payment.description && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Description:</span>
                  <span className="text-gray-900">{payment.description}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Created:</span>
                <span className="text-gray-900">
                  {new Date(payment.created_at).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <button
                onClick={() => router.push('/payments/history')}
                className="text-gray-600 hover:text-gray-900 font-medium"
              >
                View All Payments
              </button>
              <button
                onClick={() => router.push('/payments/create')}
                className="px-4 py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-500"
              >
                Create New Payment
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}