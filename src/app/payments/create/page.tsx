'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

interface Business {
  id: string;
  name: string;
}

interface BusinessWallet {
  id: string;
  cryptocurrency: string;
  wallet_address: string;
  is_active: boolean;
}

const PAYMENT_EXPIRY_MINUTES = 15;
const POLL_INTERVAL_MS = 5000;
const BALANCE_CHECK_INTERVAL_MS = 15000; // Check blockchain balance every 15 seconds

export default function CreatePaymentPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessWallets, setBusinessWallets] = useState<BusinessWallet[]>([]);
  const [loadingWallets, setLoadingWallets] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    business_id: '',
    amount_usd: '',
    currency: '',
    description: '',
  });
  const [createdPayment, setCreatedPayment] = useState<any>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(PAYMENT_EXPIRY_MINUTES * 60);
  const [paymentStatus, setPaymentStatus] = useState<string>('pending');
  const [networkFees, setNetworkFees] = useState<Record<string, number>>({});
  const [feesLoading, setFeesLoading] = useState(true);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const balanceCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastBalanceCheckRef = useRef<number>(0);
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

  // Fetch real-time network fees from API
  const fetchNetworkFees = useCallback(async () => {
    try {
      setFeesLoading(true);
      const response = await fetch('/api/fees');
      const data = await response.json();

      if (data.success && data.fees) {
        const feesMap: Record<string, number> = {};
        data.fees.forEach((fee: { blockchain: string; fee_usd: number }) => {
          feesMap[fee.blockchain.toLowerCase()] = fee.fee_usd;
        });
        setNetworkFees(feesMap);
      }
    } catch (err) {
      console.error('Failed to fetch network fees:', err);
      // Fallback fees will be used from the static list
    } finally {
      setFeesLoading(false);
    }
  }, []);

  // Fetch fees on component mount
  useEffect(() => {
    fetchNetworkFees();
    // Refresh fees every 2 minutes
    const interval = setInterval(fetchNetworkFees, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchNetworkFees]);

  // Check blockchain balance directly
  const checkBlockchainBalance = useCallback(async (paymentId: string) => {
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
          const paymentResult = await authFetch(`/api/payments/${paymentId}`, {});
          if (paymentResult && paymentResult.response.ok) {
            if (paymentResult.data.success && paymentResult.data.payment) {
              setCreatedPayment((prev: any) => ({
                ...prev,
                ...paymentResult.data.payment,
              }));
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
  }, []);

  // Poll for payment status
  const pollPaymentStatus = useCallback(async (paymentId: string) => {
    try {
      const result = await authFetch(`/api/payments/${paymentId}`, {});
      if (!result) return;

      const { response, data } = result;

      if (response.ok) {
        if (data.success && data.payment) {
          setPaymentStatus(data.payment.status);
          // Update the full payment object including tx_hash
          setCreatedPayment((prev: any) => ({
            ...prev,
            status: data.payment.status,
            tx_hash: data.payment.tx_hash,
            forward_tx_hash: data.payment.forward_tx_hash,
            blockchain: data.payment.blockchain,
          }));

          // Stop polling if payment is complete or failed AND we have tx_hash
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
        checkBlockchainBalance(paymentId);
      }
    } catch (err) {
      console.error('Failed to poll payment status:', err);
    }
  }, [checkBlockchainBalance]);

  // Start polling and timer when payment is created
  // Also continue polling for confirmed status until we have tx_hash
  useEffect(() => {
    const needsPolling = paymentStatus === 'pending' ||
      paymentStatus === 'detected' ||
      paymentStatus === 'forwarding' ||
      // Continue polling for confirmed/forwarded until we have tx_hash
      ((paymentStatus === 'confirmed' || paymentStatus === 'forwarded') &&
       !createdPayment?.tx_hash && !createdPayment?.forward_tx_hash);
    
    if (createdPayment?.id && needsPolling) {
      paymentCreatedAtRef.current = new Date();
      
      // Start polling for payment status
      pollIntervalRef.current = setInterval(() => {
        pollPaymentStatus(createdPayment.id);
      }, POLL_INTERVAL_MS);

      // Start blockchain balance checking (more frequent for faster detection)
      // Do an immediate check first
      checkBlockchainBalance(createdPayment.id);
      lastBalanceCheckRef.current = Date.now();
      
      balanceCheckIntervalRef.current = setInterval(() => {
        checkBlockchainBalance(createdPayment.id);
      }, BALANCE_CHECK_INTERVAL_MS);

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
        if (balanceCheckIntervalRef.current) {
          clearInterval(balanceCheckIntervalRef.current);
        }
      };
    }
  }, [createdPayment?.id, paymentStatus, pollPaymentStatus, checkBlockchainBalance]);

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

  // Get blockchain explorer URL for transaction
  const getExplorerUrl = (blockchain: string, txHash: string): string => {
    const explorers: Record<string, string> = {
      btc: `https://mempool.space/tx/${txHash}`,
      bitcoin: `https://mempool.space/tx/${txHash}`,
      bch: `https://blockchair.com/bitcoin-cash/transaction/${txHash}`,
      'bitcoin-cash': `https://blockchair.com/bitcoin-cash/transaction/${txHash}`,
      eth: `https://etherscan.io/tx/${txHash}`,
      ethereum: `https://etherscan.io/tx/${txHash}`,
      usdt: `https://etherscan.io/tx/${txHash}`,
      usdc: `https://etherscan.io/tx/${txHash}`,
      usdc_eth: `https://etherscan.io/tx/${txHash}`,
      usdc_pol: `https://polygonscan.com/tx/${txHash}`,
      usdc_sol: `https://solscan.io/tx/${txHash}`,
      bnb: `https://bscscan.com/tx/${txHash}`,
      pol: `https://polygonscan.com/tx/${txHash}`,
      polygon: `https://polygonscan.com/tx/${txHash}`,
      sol: `https://solscan.io/tx/${txHash}`,
      solana: `https://solscan.io/tx/${txHash}`,
      doge: `https://dogechain.info/tx/${txHash}`,
      dogecoin: `https://dogechain.info/tx/${txHash}`,
      xrp: `https://xrpscan.com/tx/${txHash}`,
      ripple: `https://xrpscan.com/tx/${txHash}`,
      ada: `https://cardanoscan.io/transaction/${txHash}`,
      cardano: `https://cardanoscan.io/transaction/${txHash}`,
    };
    return explorers[blockchain?.toLowerCase()] || `https://blockchair.com/search?q=${txHash}`;
  };

  // Base currency definitions (fees will be fetched from API)
  const baseCurrencies = [
    { value: 'btc', label: 'Bitcoin (BTC)', walletType: 'BTC', fallbackFee: 2.00 },
    { value: 'bch', label: 'Bitcoin Cash (BCH)', walletType: 'BCH', fallbackFee: 0.01 },
    { value: 'eth', label: 'Ethereum (ETH)', walletType: 'ETH', fallbackFee: 3.00 },
    { value: 'usdt', label: 'Tether (USDT)', walletType: 'USDT', fallbackFee: 3.00 },
    // Chain-specific USDC options - Polygon is cheapest!
    { value: 'usdc_pol', label: 'USDC (Polygon) - Recommended', walletType: 'USDC', fallbackFee: 0.01 },
    { value: 'usdc_sol', label: 'USDC (Solana)', walletType: 'USDC', fallbackFee: 0.001 },
    { value: 'usdc_eth', label: 'USDC (Ethereum)', walletType: 'USDC', fallbackFee: 3.00 },
    { value: 'bnb', label: 'Binance Coin (BNB)', walletType: 'BNB', fallbackFee: 0.10 },
    { value: 'sol', label: 'Solana (SOL)', walletType: 'SOL', fallbackFee: 0.001 },
    { value: 'xrp', label: 'Ripple (XRP)', walletType: 'XRP', fallbackFee: 0.001 },
    { value: 'ada', label: 'Cardano (ADA)', walletType: 'ADA', fallbackFee: 0.20 },
    { value: 'doge', label: 'Dogecoin (DOGE)', walletType: 'DOGE', fallbackFee: 0.05 },
    { value: 'pol', label: 'Polygon (POL)', walletType: 'POL', fallbackFee: 0.01 },
  ];

  // Build currencies with real-time fees
  const allCurrencies = baseCurrencies.map(currency => {
    // Get fee from API (use lowercase key) or fallback
    const fee = networkFees[currency.value] ?? currency.fallbackFee;
    const networkFee = fee < 0.01 ? `~$${fee.toFixed(4)}` : fee < 1 ? `~$${fee.toFixed(2)}` : `~$${fee.toFixed(2)}`;
    return {
      ...currency,
      networkFee,
      estimatedFee: fee,
    };
  });

  // Filter currencies to only show those with configured wallets
  // Uses walletType to match (e.g., USDC wallet enables all USDC chain options)
  const availableCurrencies = businessWallets.length > 0
    ? allCurrencies.filter(currency =>
        businessWallets.some(wallet =>
          wallet.cryptocurrency.toUpperCase() === currency.walletType && wallet.is_active
        )
      )
    : [];

  // Get estimated network fee for selected currency
  const getNetworkFee = () => {
    const currency = allCurrencies.find(c => c.value === formData.currency);
    return currency?.networkFee || 'varies';
  };

  // Get estimated fee amount for selected currency
  const getEstimatedFeeAmount = () => {
    const currency = allCurrencies.find(c => c.value === formData.currency);
    return currency?.estimatedFee || 0;
  };

  // Fetch wallets for a business
  const fetchBusinessWallets = async (businessId: string) => {
    if (!businessId) {
      setBusinessWallets([]);
      return;
    }

    setLoadingWallets(true);
    try {
      const result = await authFetch(`/api/businesses/${businessId}/wallets`, {});
      if (!result) return;

      const { response, data } = result;

      if (response.ok && data.success) {
        setBusinessWallets(data.wallets || []);
        // Auto-select first available currency if current selection is not available
        const activeWallets = (data.wallets || []).filter((w: BusinessWallet) => w.is_active);
        if (activeWallets.length > 0) {
          // Find the walletType for current selection
          const currentCurrency = allCurrencies.find(c => c.value === formData.currency);
          const currentWalletType = currentCurrency?.walletType || formData.currency.toUpperCase();
          const currentCurrencyAvailable = activeWallets.some(
            (w: BusinessWallet) => w.cryptocurrency.toUpperCase() === currentWalletType
          );
          if (!currentCurrencyAvailable) {
            // Find the first currency that matches an active wallet
            const firstAvailable = allCurrencies.find(c =>
              activeWallets.some((w: BusinessWallet) => w.cryptocurrency.toUpperCase() === c.walletType)
            );
            setFormData(prev => ({
              ...prev,
              currency: firstAvailable?.value || activeWallets[0].cryptocurrency.toLowerCase(),
            }));
          }
        } else {
          setFormData(prev => ({ ...prev, currency: '' }));
        }
      } else {
        setBusinessWallets([]);
      }
    } catch (err) {
      console.error('Failed to fetch business wallets:', err);
      setBusinessWallets([]);
    } finally {
      setLoadingWallets(false);
    }
  };

  // Calculate total amount customer will pay
  const getTotalAmount = () => {
    const baseAmount = parseFloat(formData.amount_usd) || 0;
    const networkFee = getEstimatedFeeAmount();
    return baseAmount + networkFee;
  };

  useEffect(() => {
    fetchBusinesses();
  }, []);

  // Fetch wallets when business changes
  useEffect(() => {
    if (formData.business_id) {
      fetchBusinessWallets(formData.business_id);
    }
  }, [formData.business_id]);

  const fetchBusinesses = async () => {
    try {
      const result = await authFetch('/api/businesses', {}, router);
      if (!result) return;

      const { response, data } = result;

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to load businesses');
        setLoading(false);
        return;
      }

      setBusinesses(data.businesses);
      if (data.businesses.length > 0) {
        const firstBusinessId = data.businesses[0].id;
        setFormData((prev) => ({
          ...prev,
          business_id: firstBusinessId,
        }));
        // Wallets will be fetched by the useEffect that watches business_id
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
      const result = await authFetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: formData.business_id,
          amount_usd: parseFloat(formData.amount_usd),
          currency: formData.currency,
          description: formData.description || undefined,
        }),
      }, router);
      if (!result) return;

      const { response, data } = result;

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
    if (balanceCheckIntervalRef.current) {
      clearInterval(balanceCheckIntervalRef.current);
      balanceCheckIntervalRef.current = null;
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

              {/* Shareable Payment Link */}
              {createdPayment.id && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">
                    Shareable Payment Link
                  </h3>
                  <div className="bg-purple-50 p-4 rounded-lg">
                    <p className="text-xs text-purple-700 mb-2">
                      Share this link with your customer to complete the payment:
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={`${typeof window !== 'undefined' ? window.location.origin : ''}/pay/${createdPayment.id}`}
                        className="flex-1 px-3 py-2 bg-white border border-purple-200 rounded-lg text-sm font-mono text-gray-900"
                      />
                      <button
                        onClick={() => copyToClipboard(`${window.location.origin}/pay/${createdPayment.id}`, 'paymentLink')}
                        className="flex-shrink-0 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500 transition-colors"
                      >
                        {copiedField === 'paymentLink' ? (
                          <span className="flex items-center gap-1">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Copied!
                          </span>
                        ) : (
                          'Copy Link'
                        )}
                      </button>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <a
                        href={`/pay/${createdPayment.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-purple-600 hover:text-purple-800"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Open Payment Page
                      </a>
                    </div>
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
                  {/* Transaction Links */}
                  {(createdPayment.tx_hash || createdPayment.forward_tx_hash) && (
                    <div className="mt-2 space-y-1">
                      {createdPayment.tx_hash && (
                        <p>
                          <strong>Incoming TX:</strong>{' '}
                          <a
                            href={getExplorerUrl(createdPayment.blockchain || createdPayment.currency, createdPayment.tx_hash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:opacity-80"
                          >
                            {createdPayment.tx_hash.slice(0, 8)}...{createdPayment.tx_hash.slice(-8)}
                          </a>
                        </p>
                      )}
                      {createdPayment.forward_tx_hash && (
                        <p>
                          <strong>Forward TX:</strong>{' '}
                          <a
                            href={getExplorerUrl(createdPayment.blockchain || createdPayment.currency, createdPayment.forward_tx_hash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:opacity-80"
                          >
                            {createdPayment.forward_tx_hash.slice(0, 8)}...{createdPayment.forward_tx_hash.slice(-8)}
                          </a>
                        </p>
                      )}
                    </div>
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
              {loadingWallets ? (
                <div className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500">
                  Loading wallets...
                </div>
              ) : availableCurrencies.length === 0 ? (
                <div className="w-full px-4 py-3 border border-yellow-300 rounded-lg bg-yellow-50 text-yellow-800 text-sm">
                  <p className="font-medium">No wallets configured</p>
                  <p className="mt-1">
                    Please{' '}
                    <a
                      href={`/businesses/${formData.business_id}`}
                      className="text-purple-600 hover:text-purple-500 underline"
                    >
                      add a wallet address
                    </a>{' '}
                    for this business before creating a payment.
                  </p>
                </div>
              ) : (
                <select
                  id="currency"
                  required
                  value={formData.currency}
                  onChange={(e) =>
                    setFormData({ ...formData, currency: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                >
                  {availableCurrencies.map((currency) => (
                    <option key={currency.value} value={currency.value}>
                      {currency.label}
                    </option>
                  ))}
                </select>
              )}
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

            <div className="bg-blue-50 p-4 rounded-lg space-y-3">
              <h4 className="text-sm font-semibold text-blue-900">Payment Breakdown</h4>
              <div className="text-sm text-blue-900 space-y-1">
                <div className="flex justify-between">
                  <span>Your Amount:</span>
                  <span>${parseFloat(formData.amount_usd || '0').toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-blue-700">
                  <span>+ Network Fee ({getNetworkFee()}):</span>
                  <span>${getEstimatedFeeAmount().toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-semibold border-t border-blue-200 pt-2 mt-2">
                  <span>Customer Pays:</span>
                  <span>${getTotalAmount().toFixed(2)}</span>
                </div>
              </div>
              <div className="text-xs text-blue-700 space-y-1 pt-2 border-t border-blue-200">
                <p>✓ Customer pays the network fee - you receive the full amount</p>
                <p>✓ 0.5% platform fee (${((parseFloat(formData.amount_usd || '0')) * 0.005).toFixed(2)}) deducted from forwarded amount</p>
              </div>
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
                disabled={creating || availableCurrencies.length === 0 || loadingWallets}
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