'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';
import { SUPPORTED_FIAT_CURRENCIES, type FiatCurrency } from '@/lib/web-wallet/settings';

const CHAINS = [
  { value: 'BTC', label: 'Bitcoin (BTC)' },
  { value: 'BCH', label: 'Bitcoin Cash (BCH)' },
  { value: 'ETH', label: 'Ethereum (ETH)' },
  { value: 'POL', label: 'Polygon (POL)' },
  { value: 'SOL', label: 'Solana (SOL)' },
  { value: 'DOGE', label: 'Dogecoin (DOGE)' },
  { value: 'XRP', label: 'Ripple (XRP)' },
  { value: 'ADA', label: 'Cardano (ADA)' },
  { value: 'BNB', label: 'BNB Chain (BNB)' },
  { value: 'USDT', label: 'Tether (USDT)' },
  { value: 'USDC', label: 'USD Coin (USDC)' },
  { value: 'USDC_ETH', label: 'USDC (Ethereum)' },
  { value: 'USDC_POL', label: 'USDC (Polygon) — Low Fees' },
  { value: 'USDC_SOL', label: 'USDC (Solana) — Low Fees' },
];

const EXPIRY_OPTIONS = [
  { value: 24, label: '24 hours' },
  { value: 48, label: '48 hours' },
  { value: 72, label: '3 days' },
  { value: 168, label: '7 days' },
  { value: 336, label: '14 days' },
  { value: 720, label: '30 days' },
];

interface Business {
  id: string;
  name: string;
}

interface CreatedEscrow {
  id: string;
  escrow_address: string;
  depositor_address: string;
  beneficiary_address: string;
  chain: string;
  amount: number;
  amount_usd: number | null;
  fee_amount: number | null;
  deposited_amount: number | null;
  status: string;
  release_token: string;
  beneficiary_token: string;
  expires_at: string;
  created_at: string;
  metadata: Record<string, unknown>;
  business_id: string | null;
}

export default function CreateEscrowPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [createdEscrow, setCreatedEscrow] = useState<CreatedEscrow | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [formData, setFormData] = useState({
    chain: 'USDC_POL',
    amount: '',
    depositor_address: '',
    beneficiary_address: '',
    arbiter_address: '',
    description: '',
    expires_in_hours: 168,
    business_id: '',
  });

  // Recurring escrow state
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringInterval, setRecurringInterval] = useState<'weekly' | 'biweekly' | 'monthly'>('monthly');
  const [maxPeriods, setMaxPeriods] = useState('');
  const [createdSeries, setCreatedSeries] = useState<Record<string, unknown> | null>(null);

  // Dual input system state
  const [fiatCurrency, setFiatCurrency] = useState<FiatCurrency>('USD');
  const [fiatAmount, setFiatAmount] = useState('');
  const [cryptoAmount, setCryptoAmount] = useState('');
  const [primaryInput, setPrimaryInput] = useState<'fiat' | 'crypto'>('fiat'); // Which input is editable
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState('');
  const debounceRef = useRef<NodeJS.Timeout>();

  // Check if user is logged in and fetch their businesses
  const fetchBusinesses = useCallback(async () => {
    try {
      const result = await authFetch('/api/businesses', {});
      if (result && result.response.ok && result.data.success) {
        setBusinesses(result.data.businesses || []);
        setIsLoggedIn(true);
        if (result.data.businesses?.length > 0) {
          setFormData(prev => ({ ...prev, business_id: result.data.businesses[0].id }));
        }
      }
    } catch {
      // Not logged in — that's fine, escrow works anonymously
    } finally {
      setLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    fetchBusinesses();
  }, [fetchBusinesses]);

  // Fetch exchange rate
  const fetchRate = useCallback(async (chain: string, fiat: string) => {
    if (!chain || !fiat) return;
    
    setRateLoading(true);
    setRateError('');
    
    try {
      const response = await fetch(`/api/rates?coin=${chain}&fiat=${fiat}`);
      const data = await response.json();
      
      if (data.success && data.rate) {
        setExchangeRate(data.rate);
      } else {
        setRateError('Failed to fetch exchange rate');
        setExchangeRate(null);
      }
    } catch (error) {
      setRateError('Failed to fetch exchange rate');
      setExchangeRate(null);
    } finally {
      setRateLoading(false);
    }
  }, []);

  // Debounced rate fetching
  const debouncedFetchRate = useCallback((chain: string, fiat: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      fetchRate(chain, fiat);
    }, 300);
  }, [fetchRate]);

  // Calculate crypto amount from fiat
  const calculateCryptoFromFiat = useCallback((fiatValue: string) => {
    if (!fiatValue || !exchangeRate || exchangeRate === 0) {
      setCryptoAmount('');
      return;
    }
    const fiatNum = parseFloat(fiatValue);
    if (isNaN(fiatNum) || fiatNum < 0) {
      setCryptoAmount('');
      return;
    }
    const cryptoValue = fiatNum / exchangeRate;
    setCryptoAmount(cryptoValue.toString());
  }, [exchangeRate]);

  // Calculate fiat amount from crypto
  const calculateFiatFromCrypto = useCallback((cryptoValue: string) => {
    if (!cryptoValue || !exchangeRate) {
      setFiatAmount('');
      return;
    }
    const cryptoNum = parseFloat(cryptoValue);
    if (isNaN(cryptoNum) || cryptoNum < 0) {
      setFiatAmount('');
      return;
    }
    const fiatValue = cryptoNum * exchangeRate;
    setFiatAmount(fiatValue.toFixed(2));
  }, [exchangeRate]);

  // Handle fiat input change
  const handleFiatChange = (value: string) => {
    setFiatAmount(value);
    if (primaryInput === 'fiat') {
      calculateCryptoFromFiat(value);
    }
  };

  // Handle crypto input change
  const handleCryptoChange = (value: string) => {
    setCryptoAmount(value);
    if (primaryInput === 'crypto') {
      calculateFiatFromCrypto(value);
    }
  };

  // Toggle primary input
  const togglePrimaryInput = () => {
    const newPrimary = primaryInput === 'fiat' ? 'crypto' : 'fiat';
    setPrimaryInput(newPrimary);
    
    // Recalculate based on new primary
    if (newPrimary === 'fiat' && fiatAmount) {
      calculateCryptoFromFiat(fiatAmount);
    } else if (newPrimary === 'crypto' && cryptoAmount) {
      calculateFiatFromCrypto(cryptoAmount);
    }
  };

  // Fetch rate when chain or fiat currency changes
  useEffect(() => {
    if (formData.chain && fiatCurrency) {
      debouncedFetchRate(formData.chain, fiatCurrency);
    }
  }, [formData.chain, fiatCurrency, debouncedFetchRate]);

  // Update form amount when crypto amount changes
  useEffect(() => {
    setFormData(prev => ({ ...prev, amount: cryptoAmount }));
  }, [cryptoAmount]);

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCreating(true);

    try {
      const body: Record<string, unknown> = {
        chain: formData.chain,
        amount: parseFloat(formData.amount),
        depositor_address: formData.depositor_address.trim(),
        beneficiary_address: formData.beneficiary_address.trim(),
        expires_in_hours: formData.expires_in_hours,
      };

      if (formData.arbiter_address.trim()) {
        body.arbiter_address = formData.arbiter_address.trim();
      }
      if (formData.description.trim()) {
        body.metadata = { description: formData.description.trim() };
      }
      // Associate with business if logged in
      if (formData.business_id) {
        body.business_id = formData.business_id;
      }

      if (isRecurring) {
        // Create recurring series — amount is crypto (same as single escrow)
        const seriesBody = {
          ...body,
          payment_method: 'crypto' as const,
          coin: formData.chain,
          interval: recurringInterval,
          ...(formData.description.trim() ? { description: formData.description.trim() } : {}),
          ...(maxPeriods ? { max_periods: parseInt(maxPeriods) } : {}),
        };

        const result = await authFetch('/api/escrow/series', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(seriesBody),
        });

        if (result && result.response.ok) {
          const data = result.data;
          setCreatedSeries(data.series || data);
          if (data.escrow) {
            setCreatedEscrow(data.escrow);
          }
        } else if (result) {
          setError(result.data?.error || 'Failed to create recurring escrow series');
        } else {
          const res = await fetch('/api/escrow/series', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(seriesBody),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            setError(errData?.error || `Failed to create series (${res.status})`);
          } else {
            const data = await res.json();
            setCreatedSeries(data.series || data);
            if (data.escrow) {
              setCreatedEscrow(data.escrow);
            }
          }
        }
      } else {
        // Use authFetch to include credentials (for logged-in merchants)
        const result = await authFetch('/api/escrow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (result && result.response.ok) {
          setCreatedEscrow(result.data);
        } else if (result) {
          setError(result.data?.error || 'Failed to create escrow');
        } else {
          // authFetch returned null (redirect to login) — try anonymous
          const res = await fetch('/api/escrow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            setError(errData?.error || `Failed to create escrow (${res.status})`);
          } else {
            setCreatedEscrow(await res.json());
          }
        }
      }
    } catch (err) {
      setError('Failed to create escrow. Please try again.');
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  // ── Success view ──────────────────────────────────────
  if (createdSeries) {
    const s = createdSeries;
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
          <div className="bg-green-50 dark:bg-green-900/30 px-6 py-4 border-b border-green-200 dark:border-green-800">
            <div className="flex items-center gap-2">
              <svg className="h-6 w-6 text-green-600" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h2 className="text-lg font-semibold text-green-900 dark:text-green-300">
                Recurring Escrow Series Created!
              </h2>
            </div>
          </div>
          <div className="px-6 py-4 space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <h3 className="font-semibold text-blue-900 dark:text-blue-300">Series ID</h3>
              <div className="flex items-center gap-2 mt-1">
                <code className="text-sm font-mono break-all">{String(s.id)}</code>
                <button
                  type="button"
                  className="text-blue-600 hover:text-blue-800 text-sm"
                  onClick={() => copyToClipboard(String(s.id), 'series_id')}
                >
                  {copiedField === 'series_id' ? '✓' : '📋'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Amount</p>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{String(s.amount)} {String(s.coin || s.currency || '')}</p>
                  <button type="button" className="text-blue-600 hover:text-blue-800 text-sm" onClick={() => copyToClipboard(String(s.amount), 'series_amount')}>
                    {copiedField === 'series_amount' ? '✓' : '📋'}
                  </button>
                </div>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Interval</p>
                <p className="font-medium capitalize">{String(s.interval)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Payment Method</p>
                <p className="font-medium capitalize">{String(s.payment_method)}</p>
              </div>
              {s.max_periods ? (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Max Periods</p>
                  <p className="font-medium">{String(s.max_periods)}</p>
                </div>
              ) : null}
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Status</p>
                <p className="font-medium capitalize">{String(s.status)}</p>
              </div>
              {s.next_charge_at ? (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Next Charge</p>
                  <p className="font-medium">{new Date(String(s.next_charge_at)).toLocaleString()}</p>
                </div>
              ) : null}
            </div>

            {(s.depositor_address || s.beneficiary_address) ? (
              <div className="space-y-2 text-sm">
                {s.depositor_address ? (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 dark:text-gray-400">Depositor:</span>
                    <code className="break-all flex-1">{String(s.depositor_address)}</code>
                    <button type="button" className="flex-shrink-0 text-blue-600 hover:text-blue-800 text-sm" onClick={() => copyToClipboard(String(s.depositor_address), 'series_depositor')}>
                      {copiedField === 'series_depositor' ? '✓' : '📋'}
                    </button>
                  </div>
                ) : null}
                {s.beneficiary_address ? (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 dark:text-gray-400">Beneficiary:</span>
                    <code className="break-all flex-1">{String(s.beneficiary_address)}</code>
                    <button type="button" className="flex-shrink-0 text-blue-600 hover:text-blue-800 text-sm" onClick={() => copyToClipboard(String(s.beneficiary_address), 'series_beneficiary')}>
                      {copiedField === 'series_beneficiary' ? '✓' : '📋'}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {s.description ? (
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Description</p>
                <p className="text-sm">{String(s.description)}</p>
              </div>
            ) : null}

            {/* Copy All button */}
            <button
              type="button"
              className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              onClick={() => {
                const lines = [
                  `Series ID: ${String(s.id)}`,
                  `Amount: ${String(s.amount)} ${String(s.coin || s.currency || '')}`,
                  `Interval: ${String(s.interval)}`,
                  `Payment Method: ${String(s.payment_method)}`,
                  ...(s.max_periods ? [`Max Periods: ${String(s.max_periods)}`] : []),
                  `Status: ${String(s.status)}`,
                  ...(s.next_charge_at ? [`Next Charge: ${new Date(String(s.next_charge_at)).toLocaleString()}`] : []),
                  ...(s.depositor_address ? [`Depositor: ${String(s.depositor_address)}`] : []),
                  ...(s.beneficiary_address ? [`Beneficiary: ${String(s.beneficiary_address)}`] : []),
                  ...(s.description ? [`Description: ${String(s.description)}`] : []),
                  ...(createdEscrow ? [
                    '',
                    '--- First Escrow ---',
                    `Escrow ID: ${createdEscrow.id}`,
                    `Deposit Address: ${createdEscrow.escrow_address}`,
                    `Amount: ${createdEscrow.amount} ${createdEscrow.chain}`,
                    `Release Token: ${createdEscrow.release_token}`,
                    `Beneficiary Token: ${createdEscrow.beneficiary_token}`,
                    `Expires: ${new Date(createdEscrow.expires_at).toLocaleString()}`,
                  ] : []),
                ];
                copyToClipboard(lines.join('\n'), 'series_all');
              }}
            >
              {copiedField === 'series_all' ? '✓ Copied!' : '📋 Copy All Info'}
            </button>

            {/* First escrow details if created */}
            {createdEscrow && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
                <h3 className="font-semibold text-green-800 dark:text-green-300">First Escrow Payment Created</h3>
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                  <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300 mb-2">⚠️ Save These Tokens!</p>
                  <div className="space-y-2">
                    <div>
                      <p className="text-xs text-gray-500">Release Token (for depositor)</p>
                      <div className="flex items-center gap-2">
                        <code className="text-sm break-all">{createdEscrow.release_token}</code>
                        <button type="button" className="text-blue-600 text-sm" onClick={() => copyToClipboard(createdEscrow.release_token, 'release')}>
                          {copiedField === 'release' ? '✓' : '📋'}
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Beneficiary Token (for recipient)</p>
                      <div className="flex items-center gap-2">
                        <code className="text-sm break-all">{createdEscrow.beneficiary_token}</code>
                        <button type="button" className="text-blue-600 text-sm" onClick={() => copyToClipboard(createdEscrow.beneficiary_token, 'beneficiary')}>
                          {copiedField === 'beneficiary' ? '✓' : '📋'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Deposit Address</p>
                    <div className="flex items-center gap-1">
                      <code className="text-xs break-all flex-1">{createdEscrow.escrow_address}</code>
                      <button type="button" className="flex-shrink-0 text-blue-600 hover:text-blue-800 text-sm" onClick={() => copyToClipboard(createdEscrow.escrow_address, 'series_esc_addr')}>
                        {copiedField === 'series_esc_addr' ? '✓' : '📋'}
                      </button>
                    </div>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Crypto Amount</p>
                    <div className="flex items-center gap-1">
                      <p className="font-medium">{createdEscrow.amount} {createdEscrow.chain}</p>
                      <button type="button" className="flex-shrink-0 text-blue-600 hover:text-blue-800 text-sm" onClick={() => copyToClipboard(String(createdEscrow.amount), 'series_esc_amount')}>
                        {copiedField === 'series_esc_amount' ? '✓' : '📋'}
                      </button>
                    </div>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Expires</p>
                    <p className="font-medium">{new Date(createdEscrow.expires_at).toLocaleString()}</p>
                  </div>
                  {createdEscrow.amount_usd != null && (
                    <div>
                      <p className="text-gray-500 dark:text-gray-400">USD Value</p>
                      <p className="font-medium">≈ ${createdEscrow.amount_usd.toFixed(2)}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="pt-4 flex gap-3">
              <button
                type="button"
                className="btn-primary px-4 py-2 text-sm"
                onClick={() => { setCreatedSeries(null); setCreatedEscrow(null); setError(''); }}
              >
                Create Another
              </button>
              <a href="/dashboard" className="btn-secondary px-4 py-2 text-sm">
                Go to Dashboard
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (createdEscrow) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
          <div className="bg-green-50 dark:bg-green-900/30 px-6 py-4 border-b border-green-200 dark:border-green-800">
            <div className="flex items-center gap-2">
              <svg className="h-6 w-6 text-green-600" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h2 className="text-lg font-semibold text-green-900 dark:text-green-300">
                Escrow Created!
              </h2>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Copy All */}
            <button
              type="button"
              className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              onClick={() => {
                const lines = [
                  `Escrow ID: ${createdEscrow.id}`,
                  `Deposit Address: ${createdEscrow.escrow_address}`,
                  `Amount: ${createdEscrow.amount} ${createdEscrow.chain}`,
                  ...(createdEscrow.amount_usd ? [`USD Value: ≈ $${createdEscrow.amount_usd.toFixed(2)}`] : []),
                  `Status: ${createdEscrow.status}`,
                  `Depositor: ${createdEscrow.depositor_address}`,
                  `Beneficiary: ${createdEscrow.beneficiary_address}`,
                  `Expires: ${new Date(createdEscrow.expires_at).toLocaleString()}`,
                  `Release Token: ${createdEscrow.release_token}`,
                  `Beneficiary Token: ${createdEscrow.beneficiary_token}`,
                  ...(createdEscrow.fee_amount ? [`Commission: ${createdEscrow.fee_amount} ${createdEscrow.chain}`] : []),
                ];
                copyToClipboard(lines.join('\n'), 'escrow_all');
              }}
            >
              {copiedField === 'escrow_all' ? '✓ Copied!' : '📋 Copy All Info'}
            </button>

            {/* Escrow ID — prominent, first thing shown */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <span className="text-blue-600 text-lg">🔑</span>
                <div className="flex-1">
                  <h3 className="font-semibold text-blue-900 dark:text-blue-300">Escrow ID</h3>
                  <p className="text-xs text-blue-700 dark:text-blue-400 mb-2">
                    Save this ID — you&apos;ll need it to manage your escrow.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-white dark:bg-gray-900 border border-blue-300 dark:border-blue-700 rounded px-3 py-2 text-sm break-all text-gray-900 dark:text-white">
                      {createdEscrow.id}
                    </code>
                    <button
                      onClick={() => copyToClipboard(createdEscrow.id, 'escrow_id')}
                      className="flex-shrink-0 px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition-colors"
                    >
                      {copiedField === 'escrow_id' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Escrow deposit address */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Deposit Address
              </h3>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2">
                <span>
                  Send exactly <strong>{createdEscrow.amount} {createdEscrow.chain}</strong> to this address to fund the escrow.
                </span>
                <button
                  onClick={() => copyToClipboard(createdEscrow.amount.toString(), 'amount')}
                  className="p-1 text-gray-500 hover:text-blue-600 rounded transition-colors"
                  title="Copy amount"
                >
                  {copiedField === 'amount' ? '✓' : '📋'}
                </button>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg flex items-center justify-between gap-3">
                <code className="text-sm text-gray-900 dark:text-white break-all flex-1">
                  {createdEscrow.escrow_address}
                </code>
                <button
                  onClick={() => copyToClipboard(createdEscrow.escrow_address, 'address')}
                  className="flex-shrink-0 p-2 text-gray-500 hover:text-blue-600 rounded-lg transition-colors"
                >
                  {copiedField === 'address' ? '✓' : '📋'}
                </button>
              </div>
            </div>

            {/* Amount + Chain */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount</h3>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">
                  {createdEscrow.amount} {createdEscrow.chain}
                </p>
                {createdEscrow.amount_usd && (
                  <p className="text-sm text-gray-500">≈ ${createdEscrow.amount_usd.toFixed(2)}</p>
                )}
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</h3>
                <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                  {createdEscrow.status}
                </span>
              </div>
            </div>

            {/* Tokens — CRITICAL section */}
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 space-y-4">
              <div className="flex items-start gap-2">
                <span className="text-amber-600 text-lg">⚠️</span>
                <div>
                  <h3 className="font-semibold text-amber-900 dark:text-amber-300">Save These Tokens!</h3>
                  <p className="text-sm text-amber-800 dark:text-amber-400">
                    These tokens are shown <strong>only once</strong>. They are needed to release or claim the escrow funds.
                  </p>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-amber-800 dark:text-amber-400 uppercase tracking-wide">
                  Release Token (for depositor)
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-700 rounded px-3 py-2 text-xs break-all text-gray-900 dark:text-white">
                    {createdEscrow.release_token}
                  </code>
                  <button
                    onClick={() => copyToClipboard(createdEscrow.release_token, 'release')}
                    className="flex-shrink-0 px-3 py-2 bg-amber-600 text-white text-xs font-medium rounded hover:bg-amber-700 transition-colors"
                  >
                    {copiedField === 'release' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div className="mt-2">
                  <button
                    onClick={() => copyToClipboard(`${window.location.origin}/escrow/manage?id=${createdEscrow.id}&token=${createdEscrow.release_token}`, 'depositor_link')}
                    className="text-xs text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 underline"
                  >
                    {copiedField === 'depositor_link' ? 'Link copied!' : 'Share depositor link'}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-amber-800 dark:text-amber-400 uppercase tracking-wide">
                  Beneficiary Token (for recipient)
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-700 rounded px-3 py-2 text-xs break-all text-gray-900 dark:text-white">
                    {createdEscrow.beneficiary_token}
                  </code>
                  <button
                    onClick={() => copyToClipboard(createdEscrow.beneficiary_token, 'beneficiary')}
                    className="flex-shrink-0 px-3 py-2 bg-amber-600 text-white text-xs font-medium rounded hover:bg-amber-700 transition-colors"
                  >
                    {copiedField === 'beneficiary' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div className="mt-2">
                  <button
                    onClick={() => copyToClipboard(`${window.location.origin}/escrow/manage?id=${createdEscrow.id}&token=${createdEscrow.beneficiary_token}`, 'beneficiary_link')}
                    className="text-xs text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 underline"
                  >
                    {copiedField === 'beneficiary_link' ? 'Link copied!' : 'Share beneficiary link'}
                  </button>
                </div>
              </div>
            </div>

            {/* Addresses */}
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 dark:text-gray-400">Depositor:</span>
                <code className="text-gray-900 dark:text-white break-all flex-1">{createdEscrow.depositor_address}</code>
                <button
                  onClick={() => copyToClipboard(createdEscrow.depositor_address, 'depositor_addr')}
                  className="flex-shrink-0 text-gray-500 hover:text-blue-600 transition-colors"
                >
                  {copiedField === 'depositor_addr' ? '✓' : '📋'}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 dark:text-gray-400">Beneficiary:</span>
                <code className="text-gray-900 dark:text-white break-all flex-1">{createdEscrow.beneficiary_address}</code>
                <button
                  onClick={() => copyToClipboard(createdEscrow.beneficiary_address, 'beneficiary_addr')}
                  className="flex-shrink-0 text-gray-500 hover:text-blue-600 transition-colors"
                >
                  {copiedField === 'beneficiary_addr' ? '✓' : '📋'}
                </button>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Expires:</span>
                <span className="ml-2 text-gray-900 dark:text-white">
                  {new Date(createdEscrow.expires_at).toLocaleString()}
                </span>
              </div>
              {createdEscrow.fee_amount != null && createdEscrow.fee_amount > 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                  <span className="text-sm font-medium text-amber-800 dark:text-amber-300">Platform Commission:</span>
                  <span className="ml-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                    {createdEscrow.fee_amount} {createdEscrow.chain} ({((createdEscrow.fee_amount / createdEscrow.amount) * 100).toFixed(1)}%)
                  </span>
                  {createdEscrow.business_id && <span className="text-green-600 dark:text-green-400 ml-1 text-xs">(paid tier rate)</span>}
                  <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                    Beneficiary will receive: {(createdEscrow.amount - createdEscrow.fee_amount).toFixed(6)} {createdEscrow.chain}
                  </p>
                </div>
              )}
              {createdEscrow.business_id && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Business:</span>
                  <span className="ml-2 text-gray-900 dark:text-white">
                    {businesses.find(b => b.id === createdEscrow.business_id)?.name || createdEscrow.business_id}
                  </span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
              <Link
                href="/escrow"
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium"
              >
                ← Back to Escrows
              </Link>
              <button
                onClick={() => {
                  setCreatedEscrow(null);
                  setFormData(prev => ({
                    ...prev,
                    amount: '',
                    depositor_address: '',
                    beneficiary_address: '',
                    arbiter_address: '',
                    description: '',
                  }));
                  // Reset dual input state
                  setFiatAmount('');
                  setCryptoAmount('');
                  setPrimaryInput('fiat');
                  setExchangeRate(null);
                  setRateError('');
                  // Reset recurring state
                  setIsRecurring(false);
                  setRecurringInterval('monthly');
                  setMaxPeriods('');
                }}
                className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                Create Another
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Form view ─────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <div className="mb-6">
        <Link href="/escrow" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          ← Back to Escrows
        </Link>
      </div>

      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Create Escrow</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Lock crypto in escrow for trustless transactions between parties
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Business selector (logged-in merchants only) */}
          {!loadingAuth && isLoggedIn && businesses.length > 0 && (
            <div>
              <label htmlFor="business" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Business
              </label>
              <select
                id="business"
                value={formData.business_id}
                onChange={(e) => setFormData({ ...formData, business_id: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="">No business (anonymous)</option>
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                ✓ Linked to your business — paid tier fee rate (0.5%) applies
              </p>
            </div>
          )}

          {!loadingAuth && !isLoggedIn && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm text-blue-700 dark:text-blue-300">
              <Link href="/login" className="font-medium underline hover:text-blue-900">Log in</Link> to associate this escrow with your business and get reduced fees (0.5% vs 1%).
            </div>
          )}

          {/* Chain */}
          <div>
            <label htmlFor="chain" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Cryptocurrency *
            </label>
            <select
              id="chain"
              required
              value={formData.chain}
              onChange={(e) => setFormData({ ...formData, chain: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
              {CHAINS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Dual Amount Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Amount *
            </label>
            
            {/* Fiat Currency Selector */}
            <div className="mb-3">
              <select
                value={fiatCurrency}
                onChange={(e) => setFiatCurrency(e.target.value as FiatCurrency)}
                className="w-32 px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                {SUPPORTED_FIAT_CURRENCIES.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code} ({currency.symbol})
                  </option>
                ))}
              </select>
            </div>

            {/* Dual Input Container */}
            <div className="space-y-3">
              {/* Fiat Input */}
              <div className="relative">
                <div className="flex items-center">
                  <span className="text-sm text-gray-500 dark:text-gray-400 w-12">
                    {SUPPORTED_FIAT_CURRENCIES.find(c => c.code === fiatCurrency)?.symbol}
                  </span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={fiatAmount}
                    onChange={(e) => handleFiatChange(e.target.value)}
                    disabled={primaryInput !== 'fiat'}
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:text-gray-500"
                    placeholder={`0.00 ${fiatCurrency}`}
                  />
                </div>
                {primaryInput === 'fiat' && (
                  <span className="absolute right-3 top-2.5 text-sm text-blue-600 dark:text-blue-400">Primary</span>
                )}
              </div>

              {/* Toggle Button */}
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={togglePrimaryInput}
                  className="p-2 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors"
                  title="Switch primary input"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                </button>
              </div>

              {/* Crypto Input */}
              <div className="relative">
                <div className="flex items-center">
                  <span className="text-sm text-gray-500 dark:text-gray-400 w-12">
                    {formData.chain}
                  </span>
                  <input
                    type="number"
                    step="any"
                    min="0.000001"
                    required
                    value={cryptoAmount}
                    onChange={(e) => handleCryptoChange(e.target.value)}
                    disabled={primaryInput !== 'crypto'}
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:text-gray-500"
                    placeholder={`0.000000 ${formData.chain}`}
                  />
                </div>
                {primaryInput === 'crypto' && (
                  <span className="absolute right-3 top-2.5 text-sm text-blue-600 dark:text-blue-400">Primary</span>
                )}
              </div>
            </div>

            {/* Exchange Rate Display */}
            <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {rateLoading ? (
                <span>Loading exchange rate...</span>
              ) : rateError ? (
                <span className="text-red-500">{rateError}</span>
              ) : exchangeRate ? (
                <span>
                  1 {formData.chain} = {SUPPORTED_FIAT_CURRENCIES.find(c => c.code === fiatCurrency)?.symbol}{exchangeRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} {fiatCurrency}
                </span>
              ) : null}
            </div>

            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              The depositor sends exactly <strong>{cryptoAmount || '0'} {formData.chain}</strong> to fund the escrow.
            </p>

            {/* Live commission estimate */}
            {parseFloat(cryptoAmount) > 0 && (
              <div className="mt-3 bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-700 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-2">💰 Fee Breakdown</h4>
                <div className="flex justify-between text-sm text-amber-800 dark:text-amber-300">
                  <span>Escrow amount:</span>
                  <span className="font-medium">{parseFloat(cryptoAmount).toFixed(6)} {formData.chain}</span>
                </div>
                <div className="flex justify-between text-sm text-amber-800 dark:text-amber-300 mt-1">
                  <span>Platform commission ({isLoggedIn && formData.business_id ? '0.5%' : '1%'}):</span>
                  <span className="font-medium">
                    −{(parseFloat(cryptoAmount) * (isLoggedIn && formData.business_id ? 0.005 : 0.01)).toFixed(6)} {formData.chain}
                  </span>
                </div>
                <hr className="my-2 border-amber-300 dark:border-amber-600" />
                <div className="flex justify-between text-sm font-semibold text-green-700 dark:text-green-400">
                  <span>Beneficiary receives:</span>
                  <span>
                    {(parseFloat(cryptoAmount) * (isLoggedIn && formData.business_id ? 0.995 : 0.99)).toFixed(6)} {formData.chain}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Depositor Address */}
          <div>
            <label htmlFor="depositor" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Depositor Address *
            </label>
            <input
              id="depositor"
              type="text"
              required
              value={formData.depositor_address}
              onChange={(e) => setFormData({ ...formData, depositor_address: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm"
              placeholder="Your wallet address (sender)"
            />
          </div>

          {/* Beneficiary Address */}
          <div>
            <label htmlFor="beneficiary" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Beneficiary Address *
            </label>
            <input
              id="beneficiary"
              type="text"
              required
              value={formData.beneficiary_address}
              onChange={(e) => setFormData({ ...formData, beneficiary_address: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm"
              placeholder="Recipient wallet address"
            />
          </div>

          {/* Arbiter Address (optional) */}
          <div>
            <label htmlFor="arbiter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Arbiter Address <span className="text-gray-400">(optional)</span>
            </label>
            <input
              id="arbiter"
              type="text"
              value={formData.arbiter_address}
              onChange={(e) => setFormData({ ...formData, arbiter_address: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm"
              placeholder="Third-party dispute resolver (optional)"
            />
          </div>

          {/* Expiry */}
          <div>
            <label htmlFor="expires" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Expiry
            </label>
            <select
              id="expires"
              value={formData.expires_in_hours}
              onChange={(e) => setFormData({ ...formData, expires_in_hours: parseInt(e.target.value) })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
              {EXPIRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Description <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              placeholder="What is this escrow for? (e.g., freelance job, NFT trade)"
              rows={3}
            />
          </div>

          {/* Make Recurring Toggle */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
                className="w-5 h-5 text-blue-600 bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Make Recurring</span>
            </label>

            {isRecurring && (
              <div className="space-y-4 pl-8">
                <div>
                  <label htmlFor="interval" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Interval
                  </label>
                  <select
                    id="interval"
                    value={recurringInterval}
                    onChange={(e) => setRecurringInterval(e.target.value as 'weekly' | 'biweekly' | 'monthly')}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="maxPeriods" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Max Periods <span className="text-gray-400">(leave empty for infinite)</span>
                  </label>
                  <input
                    id="maxPeriods"
                    type="number"
                    min="1"
                    value={maxPeriods}
                    onChange={(e) => setMaxPeriods(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    placeholder="∞"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Info box */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4 rounded-lg text-sm text-blue-800 dark:text-blue-300 space-y-2">
            <p><strong>How it works:</strong></p>
            <ol className="list-decimal list-inside space-y-1 text-blue-700 dark:text-blue-400">
              <li>You create the escrow — we generate a deposit address</li>
              <li>Depositor sends crypto to the escrow address</li>
              <li>Once funded, depositor can release funds to the beneficiary</li>
              <li>If there&apos;s a dispute, the arbiter (or platform) resolves it</li>
            </ol>
            <p className="text-xs text-blue-600 dark:text-blue-500 mt-2">
              Platform fee: {isLoggedIn && formData.business_id ? '0.5% (paid tier)' : '1% (0.5% for logged-in merchants)'}. No fee on refunds.
            </p>
          </div>

          {/* Submit */}
          <div className="flex items-center justify-between pt-4">
            <Link
              href="/escrow"
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={creating}
              className="px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? 'Creating...' : 'Create Escrow'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
