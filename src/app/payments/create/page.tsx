'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface Business {
  id: string;
  name: string;
}

const PAYMENT_EXPIRY_MINUTES = 15;
const POLL_INTERVAL_MS = 5000;

export default function CreatePaymentPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    business_id: '',
    amount_usd: '',
    currency: 'btc',
    description: '',
  });
  const [createdPayment, setCreatedPayment] = useState<any>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(PAYMENT_EXPIRY_MINUTES * 60);
  const [paymentStatus, setPaymentStatus] = useState<string>('pending');
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const paymentCreatedAtRef = useRef<Date | null>(null);

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Poll for payment status
  const pollPaymentStatus = useCallback(async (paymentId: string) => {
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
          setPaymentStatus(data.payment.status);
          setCreatedPayment((prev: any) => ({
            ...prev,
            status: data.payment.status,
          }));

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
          }
        }
      }
    } catch (err) {
      console.error('Failed to poll payment status:', err);
    }
  }, []);

  // Start polling and timer when payment is created
  useEffect(() => {
    if (createdPayment?.id && paymentStatus === 'pending') {
      paymentCreatedAtRef.current = new Date();
      
      // Start polling
      pollIntervalRef.current = setInterval(() => {
        pollPaymentStatus(createdPayment.id);
      }, POLL_INTERVAL_MS);

      // Start countdown timer
      timerIntervalRef.current = setInterval(() => {
        if (paymentCreatedAtRef.current) {
          const elapsed = Math.floor((Date.now() - paymentCreatedAtRef.current.getTime()) / 1000);
          const remaining = Math.max(0, PAYMENT_EXPIRY_MINUTES * 60 - elapsed);
          setTimeRemaining(remaining);

          if (remaining === 0) {
            setPaymentStatus('expired');
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
      }, 1000);

      // Cleanup on unmount
      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
        }
      };
    }
  }, [createdPayment?.id, paymentStatus, pollPaymentStatus]);

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

  const currencies = [
    { value: 'btc', label: 'Bitcoin (BTC)', networkFee: '$0.50-3.00' },
    { value: 'eth', label: 'Ethereum (ETH)', networkFee: '$0.50-5.00' },
    { value: 'matic', label: 'Polygon (MATIC)', networkFee: '$0.001-0.01' },
    { value: 'sol', label: 'Solana (SOL)', networkFee: '~$0.00025' },
  ];

  // Get estimated network fee for selected currency
  const getNetworkFee = () => {
    const currency = currencies.find(c => c.value === formData.currency);
    return currency?.networkFee || 'varies';
  };

  useEffect(() => {
    fetchBusinesses();
  }, []);

  const fetchBusinesses = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        router.push('/login');
        return;
      }

      const response = await fetch('/api/businesses', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to load businesses');
        setLoading(false);
        return;
      }

      setBusinesses(data.businesses);
      if (data.businesses.length > 0) {
        setFormData((prev) => ({
          ...prev,
          business_id: data.businesses[0].id,
        }));
      }
      setLoading(false);
    } catch (err) {
      setError('Failed to load businesses');
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCreating(true);

    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        router.push('/login');
        return;
      }

      const response = await fetch('/api/payments/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          business_id: formData.business_id,
          amount_usd: parseFloat(formData.amount_usd),
          currency: formData.currency,
          description: formData.description || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to create payment');
        setCreating(false);
        return;
      }

      setCreatedPayment(data.payment);
      setCreating(false);
    } catch (err) {
      setError('Failed to create payment');
      setCreating(false);
    }
  };

  const handleCreateAnother = () => {
    // Clear any existing intervals
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    
    setCreatedPayment(null);
    setPaymentStatus('pending');
    setTimeRemaining(PAYMENT_EXPIRY_MINUTES * 60);
    paymentCreatedAtRef.current = null;
    setFormData({
      business_id: businesses[0]?.id || '',
      amount_usd: '',
      currency: 'btc',
      description: '',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!loading && (!businesses || businesses.length === 0)) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
            </svg>
            <h3 className="mt-2 text-lg font-medium text-gray-900">
              No businesses found
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              You need to create a business before you can accept payments.
            </p>
            <div className="mt-6">
              <button
                onClick={() => router.push('/businesses')}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-500"
              >
                Create Business
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (createdPayment) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="bg-green-50 px-6 py-4 border-b border-green-200">
              <div className="flex items-center">
                <svg
                  className="h-6 w-6 text-green-600 mr-2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <h2 className="text-lg font-semibold text-green-900">
                  Payment Created Successfully!
                </h2>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  Payment Address
                </h3>
                <div className="bg-gray-50 p-4 rounded-lg flex items-center justify-between gap-3">
                  <p className="font-mono text-sm text-gray-900 break-all flex-1">
                    {createdPayment.payment_address}
                  </p>
                  <button
                    onClick={() => copyToClipboard(createdPayment.payment_address, 'address')}
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
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">
                    Amount (Crypto)
                  </h3>
                  <div className="flex items-center gap-2">
                    <p className="text-lg font-semibold text-gray-900">
                      {createdPayment.amount_crypto ? parseFloat(createdPayment.amount_crypto).toFixed(8) : 'N/A'}{' '}
                      {createdPayment.currency?.toUpperCase() || createdPayment.blockchain}
                    </p>
                    {createdPayment.amount_crypto && (
                      <button
                        onClick={() => copyToClipboard(parseFloat(createdPayment.amount_crypto).toFixed(8), 'amount')}
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
                    ${createdPayment.amount_usd ? parseFloat(createdPayment.amount_usd).toFixed(2) : 'N/A'}
                  </p>
                </div>
              </div>

              {createdPayment.id && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">
                    QR Code
                  </h3>
                  <div className="flex justify-center bg-white p-4 rounded-lg border border-gray-200">
                    <img
                      src={`/api/payments/${createdPayment.id}/qr`}
                      alt="Payment QR Code"
                      className="w-64 h-64"
                    />
                  </div>
                </div>
              )}

              {/* Status and Timer Section */}
              <div className={`p-4 rounded-lg ${getStatusDisplay(paymentStatus).color}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {paymentStatus === 'pending' && (
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent"></div>
                    )}
                    {(paymentStatus === 'confirmed' || paymentStatus === 'forwarded') && (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {(paymentStatus === 'expired' || paymentStatus === 'failed') && (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                    <span className="font-semibold">{getStatusDisplay(paymentStatus).text}</span>
                  </div>
                  {paymentStatus === 'pending' && timeRemaining > 0 && (
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="font-mono font-semibold">{formatTimeRemaining(timeRemaining)}</span>
                    </div>
                  )}
                </div>
                
                {/* Progress bar for pending payments */}
                {paymentStatus === 'pending' && timeRemaining > 0 && (
                  <div className="w-full bg-yellow-200 rounded-full h-2 mb-3">
                    <div
                      className="bg-yellow-500 h-2 rounded-full transition-all duration-1000"
                      style={{ width: `${(timeRemaining / (PAYMENT_EXPIRY_MINUTES * 60)) * 100}%` }}
                    ></div>
                  </div>
                )}

                <div className="text-sm opacity-80">
                  <p><strong>Payment ID:</strong> {createdPayment.id}</p>
                  {createdPayment.description && (
                    <p className="mt-1"><strong>Description:</strong> {createdPayment.description}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <button
                  onClick={() => router.push('/dashboard')}
                  className="text-gray-600 hover:text-gray-900 font-medium"
                >
                  Back to Dashboard
                </button>
                <button
                  onClick={handleCreateAnother}
                  className="px-4 py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-500"
                >
                  Create Another
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Create Payment
          </h1>
          <p className="text-gray-600">
            Generate a new crypto payment request
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="business_id"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Business *
              </label>
              <select
                id="business_id"
                required
                value={formData.business_id}
                onChange={(e) =>
                  setFormData({ ...formData, business_id: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
              >
                {businesses.map((business) => (
                  <option key={business.id} value={business.id}>
                    {business.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="amount_usd"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Amount (USD) *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 sm:text-sm">$</span>
                </div>
                <input
                  id="amount_usd"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={formData.amount_usd}
                  onChange={(e) =>
                    setFormData({ ...formData, amount_usd: e.target.value })
                  }
                  className="w-full pl-7 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                  placeholder="0.00"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                The amount will be converted to crypto at current rates
              </p>
            </div>

            <div>
              <label
                htmlFor="currency"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Cryptocurrency *
              </label>
              <select
                id="currency"
                required
                value={formData.currency}
                onChange={(e) =>
                  setFormData({ ...formData, currency: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
              >
                {currencies.map((currency) => (
                  <option key={currency.value} value={currency.value}>
                    {currency.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="description"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Description
              </label>
              <textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                placeholder="Optional payment description"
                rows={3}
              />
            </div>

            <div className="bg-blue-50 p-4 rounded-lg space-y-2">
              <p className="text-sm text-blue-900">
                <strong>Platform Fee:</strong> 0.5% of the payment amount
              </p>
              <p className="text-sm text-blue-900">
                <strong>Est. Network Fee:</strong> {getNetworkFee()} (deducted from forwarded amount)
              </p>
              <p className="text-xs text-blue-700 mt-1">
                Network fees are charged by the blockchain and vary based on congestion.
                They are deducted when funds are forwarded to your wallet.
              </p>
            </div>

            <div className="flex items-center justify-between pt-4">
              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="text-gray-600 hover:text-gray-900 font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="px-6 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? 'Creating...' : 'Create Payment'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}