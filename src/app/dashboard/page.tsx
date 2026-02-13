'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Papa from 'papaparse';
import { useRealtimePayments, type RealtimePayment } from '@/lib/realtime/useRealtimePayments';
import { authFetch, requireAuth } from '@/lib/auth/client';

interface CombinedStats {
  total_volume_usd: string;
  total_transactions: number;
  successful_transactions: number;
  crypto_volume_usd: string;
  crypto_transactions: number;
  card_volume_usd: string;
  card_transactions: number;
  total_fees_usd: string;
}

interface CryptoPayment {
  id: string;
  amount_crypto: string;
  amount_usd: string;
  currency: string;
  status: string;
  created_at: string;
  payment_address: string;
  merchant_wallet_address?: string;
  merchant_amount?: string;
  fee_amount?: string;
  forward_tx_hash?: string;
  forwarded_at?: string;
  tx_hash?: string;
}

interface CardTransaction {
  id: string;
  business_id: string;
  business_name: string;
  amount_usd: string;
  currency: string;
  status: string;
  stripe_payment_intent_id: string;
  stripe_charge_id: string | null;
  last4: string | null;
  brand: string | null;
  created_at: string;
  updated_at: string;
}

interface Business {
  id: string;
  name: string;
}

interface PlanInfo {
  id: string;
  commission_rate: number;
  commission_percent: string;
}

type TabType = 'all' | 'crypto' | 'card';

export default function DashboardPage() {
  const router = useRouter();
  const [combinedStats, setCombinedStats] = useState<CombinedStats | null>(null);
  const [cryptoPayments, setCryptoPayments] = useState<CryptoPayment[]>([]);
  const [cardTransactions, setCardTransactions] = useState<CardTransaction[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notification, setNotification] = useState<string | null>(null);

  // Real-time payment updates (for crypto)
  const { isConnected, payments: realtimePayments } = useRealtimePayments({
    onPaymentCreated: (payment) => {
      setNotification(`New payment created: ${payment.id.slice(0, 8)}...`);
      setTimeout(() => setNotification(null), 5000);
      // Add to crypto payments if on crypto tab
      if (activeTab === 'crypto' || activeTab === 'all') {
        setCryptoPayments((prev) => [{
          id: payment.id,
          amount_crypto: payment.amount_crypto,
          amount_usd: payment.amount_usd,
          currency: payment.currency,
          status: payment.status,
          created_at: payment.created_at,
          payment_address: payment.payment_address,
        }, ...prev.slice(0, 9)]);
      }
      // Update stats
      fetchCombinedStats(selectedBusinessId);
    },
    onPaymentCompleted: (payment) => {
      setNotification(`Payment completed: ${payment.id.slice(0, 8)}...`);
      setTimeout(() => setNotification(null), 5000);
      // Update payment in list
      setCryptoPayments((prev) =>
        prev.map((p) => p.id === payment.id ? {
          ...p,
          status: payment.status,
        } : p)
      );
      // Update stats
      fetchCombinedStats(selectedBusinessId);
    },
    onPaymentExpired: (payment) => {
      setNotification(`Payment expired: ${payment.id.slice(0, 8)}...`);
      setTimeout(() => setNotification(null), 5000);
      // Update payment in list
      setCryptoPayments((prev) =>
        prev.map((p) => p.id === payment.id ? {
          ...p,
          status: payment.status,
        } : p)
      );
      // Update stats
      fetchCombinedStats(selectedBusinessId);
    },
  });

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // Refetch when business filter or tab changes
  useEffect(() => {
    if (businesses.length > 0) {
      fetchDashboardData(selectedBusinessId);
    }
  }, [selectedBusinessId, activeTab]);

  const fetchDashboardData = async (businessId?: string) => {
    try {
      await Promise.all([
        fetchCombinedStats(businessId),
        fetchTransactionsData(businessId),
      ]);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const fetchCombinedStats = async (businessId?: string) => {
    try {
      // Fetch combined analytics
      let url = '/api/stripe/analytics';
      if (businessId) {
        url += `?business_id=${businessId}`;
      }

      const result = await authFetch(url, {}, router);
      if (!result) return; // Redirected to login

      const { response, data } = result;

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch analytics');
      }

      // Transform to combined stats format
      const analytics = data.analytics;
      setCombinedStats({
        total_volume_usd: analytics.combined.total_volume_usd,
        total_transactions: analytics.combined.total_transactions,
        successful_transactions: analytics.combined.successful_transactions,
        crypto_volume_usd: analytics.crypto.total_volume_usd,
        crypto_transactions: analytics.crypto.total_transactions,
        card_volume_usd: analytics.card.total_volume_usd,
        card_transactions: analytics.card.total_transactions,
        total_fees_usd: analytics.combined.total_fees_usd,
      });

      // Also fetch businesses and plan info from legacy dashboard endpoint
      const legacyResult = await authFetch('/api/dashboard/stats', {}, router);
      if (legacyResult && legacyResult.response.ok && legacyResult.data.success) {
        if (legacyResult.data.businesses && businesses.length === 0) {
          setBusinesses(legacyResult.data.businesses);
        }
        if (legacyResult.data.plan) {
          setPlanInfo(legacyResult.data.plan);
        }
      }

    } catch (error) {
      console.error('Error fetching combined stats:', error);
      setError(error instanceof Error ? error.message : 'Failed to load combined stats');
    }
  };

  const fetchTransactionsData = async (businessId?: string) => {
    try {
      const promises = [];

      // Fetch crypto payments if needed
      if (activeTab === 'all' || activeTab === 'crypto') {
        let cryptoUrl = '/api/payments?limit=10';
        if (businessId) {
          cryptoUrl += `&business_id=${businessId}`;
        }
        promises.push(authFetch(cryptoUrl, {}, router));
      }

      // Fetch card transactions if needed
      if (activeTab === 'all' || activeTab === 'card') {
        let cardUrl = '/api/stripe/transactions?limit=10';
        if (businessId) {
          cardUrl += `&business_id=${businessId}`;
        }
        promises.push(authFetch(cardUrl, {}, router));
      }

      const results = await Promise.all(promises);
      
      let cryptoResults = null;
      let cardResults = null;

      if (activeTab === 'all') {
        [cryptoResults, cardResults] = results;
      } else if (activeTab === 'crypto') {
        [cryptoResults] = results;
      } else if (activeTab === 'card') {
        [cardResults] = results;
      }

      // Process crypto results
      if (cryptoResults && cryptoResults.response.ok && cryptoResults.data.success) {
        const transformedCrypto = (cryptoResults.data.payments || []).map((p: any) => ({
          id: p.id,
          amount_crypto: p.amount_crypto,
          amount_usd: p.amount_usd,
          currency: p.currency,
          status: p.status,
          created_at: p.created_at,
          payment_address: p.payment_address,
          merchant_wallet_address: p.merchant_wallet_address,
          merchant_amount: p.merchant_amount,
          fee_amount: p.fee_amount,
          forward_tx_hash: p.forward_tx_hash,
          forwarded_at: p.forwarded_at,
          tx_hash: p.tx_hash,
        }));
        setCryptoPayments(transformedCrypto);
      }

      // Process card results
      if (cardResults && cardResults.response.ok && cardResults.data.success) {
        setCardTransactions(cardResults.data.transactions || []);
      }

    } catch (error) {
      console.error('Error fetching transactions data:', error);
    }
  };

  const handleBusinessChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedBusinessId(event.target.value);
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
  };

  const exportToCSV = async () => {
    try {
      setExporting(true);

      let dataToExport: any[] = [];
      let filename = '';

      if (activeTab === 'all') {
        // Export both crypto and card data
        const cryptoData = cryptoPayments.map(p => ({
          type: 'crypto',
          id: p.id,
          amount_usd: p.amount_usd,
          amount_crypto: p.amount_crypto,
          currency: p.currency,
          status: p.status,
          created_at: p.created_at,
          payment_address: p.payment_address,
          tx_hash: p.tx_hash || '',
        }));
        const cardData = cardTransactions.map(t => ({
          type: 'card',
          id: t.id,
          amount_usd: t.amount_usd,
          amount_crypto: '',
          currency: t.currency,
          status: t.status,
          created_at: t.created_at,
          payment_address: '',
          tx_hash: t.stripe_charge_id || '',
        }));
        dataToExport = [...cryptoData, ...cardData];
        filename = 'all-transactions';
      } else if (activeTab === 'crypto') {
        dataToExport = cryptoPayments.map(p => ({
          id: p.id,
          amount_usd: p.amount_usd,
          amount_crypto: p.amount_crypto,
          currency: p.currency,
          status: p.status,
          created_at: p.created_at,
          payment_address: p.payment_address,
          tx_hash: p.tx_hash || '',
        }));
        filename = 'crypto-payments';
      } else if (activeTab === 'card') {
        dataToExport = cardTransactions.map(t => ({
          id: t.id,
          amount_usd: t.amount_usd,
          currency: t.currency,
          status: t.status,
          created_at: t.created_at,
          stripe_charge_id: t.stripe_charge_id || '',
          business_name: t.business_name,
        }));
        filename = 'card-transactions';
      }

      if (dataToExport.length === 0) {
        alert('No data to export');
        return;
      }

      const csv = Papa.unparse(dataToExport);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${filename}-${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export data');
    } finally {
      setExporting(false);
    }
  };

  const formatAmount = (amount: string, decimals: number): string => {
    const num = parseFloat(amount);
    return isNaN(num) ? '0' : num.toFixed(decimals);
  };

  const getStatusColor = (status: string): string => {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'forwarded':
        return 'text-green-600 bg-green-100';
      case 'pending':
      case 'detected':
        return 'text-yellow-600 bg-yellow-100';
      case 'failed':
      case 'expired':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const renderAllTransactions = () => {
    // Combine and sort crypto + card transactions
    const allTxns = [
      ...cryptoPayments.map(p => ({ ...p, type: 'crypto' })),
      ...cardTransactions.map(t => ({ ...t, type: 'card' }))
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (allTxns.length === 0) {
      return (
        <div className="px-6 py-12 text-center">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No transactions yet</h3>
          <p className="mt-1 text-sm text-gray-500">Get started by creating your first payment.</p>
        </div>
      );
    }

    return (
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Type</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">ID</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Amount</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Date</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Details</th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
          {allTxns.map((txn: any, index) => (
            <tr key={`${txn.type}-${txn.id}`} className="hover:bg-gray-50 dark:hover:bg-gray-800">
              <td className="px-4 py-4 whitespace-nowrap text-sm">
                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                  txn.type === 'crypto' ? 'text-blue-600 bg-blue-100' : 'text-purple-600 bg-purple-100'
                }`}>
                  {txn.type === 'crypto' ? 'Crypto' : 'Card'}
                </span>
              </td>
              <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                <Link
                  href={`/payments/${txn.id}`}
                  className="text-purple-600 hover:text-purple-800 hover:underline"
                >
                  {txn.id.slice(0, 8)}...
                </Link>
              </td>
              <td className="px-4 py-4 text-sm text-gray-900 dark:text-gray-100">
                <div className="font-medium">${formatAmount(txn.amount_usd, 2)} USD</div>
                {txn.type === 'crypto' && txn.amount_crypto && (
                  <div className="text-gray-500 text-xs">
                    {formatAmount(txn.amount_crypto, 8)} {txn.currency?.toUpperCase()}
                  </div>
                )}
              </td>
              <td className="px-4 py-4 whitespace-nowrap">
                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(txn.status)}`}>
                  {txn.status}
                </span>
              </td>
              <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
                {new Date(txn.created_at).toLocaleDateString()}
              </td>
              <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
                {txn.type === 'crypto' ? (
                  txn.payment_address ? `${txn.payment_address.slice(0, 10)}...` : 'N/A'
                ) : (
                  txn.business_name || 'N/A'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const renderCryptoTransactions = () => {
    if (cryptoPayments.length === 0) {
      return (
        <div className="px-6 py-12 text-center">
          <h3 className="mt-2 text-sm font-medium text-gray-900">No crypto payments yet</h3>
          <p className="mt-1 text-sm text-gray-500">Get started by creating your first crypto payment.</p>
        </div>
      );
    }

    return (
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Payment ID</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Amount</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Chain</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Address</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">TX Hash</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Date</th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
          {cryptoPayments.map((payment) => (
            <tr key={payment.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
              <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                <Link
                  href={`/payments/${payment.id}`}
                  className="text-purple-600 hover:text-purple-800 hover:underline"
                >
                  {payment.id.slice(0, 8)}...
                </Link>
              </td>
              <td className="px-4 py-4 text-sm text-gray-900 dark:text-gray-100">
                <div className="font-medium">${formatAmount(payment.amount_usd, 2)} USD</div>
                <div className="text-gray-500 text-xs">
                  {formatAmount(payment.amount_crypto, 8)} {payment.currency?.toUpperCase()}
                </div>
              </td>
              <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
                {payment.currency?.toUpperCase()}
              </td>
              <td className="px-4 py-4 whitespace-nowrap">
                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(payment.status)}`}>
                  {payment.status}
                </span>
              </td>
              <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
                {payment.payment_address ? `${payment.payment_address.slice(0, 10)}...` : 'N/A'}
              </td>
              <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
                {payment.tx_hash ? `${payment.tx_hash.slice(0, 10)}...` : 'Pending'}
              </td>
              <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
                {new Date(payment.created_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const renderCardTransactions = () => {
    if (cardTransactions.length === 0) {
      return (
        <div className="px-6 py-12 text-center">
          <h3 className="mt-2 text-sm font-medium text-gray-900">No card transactions yet</h3>
          <p className="mt-1 text-sm text-gray-500">Card payments will appear here once processed.</p>
        </div>
      );
    }

    return (
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Transaction ID</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Amount</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Business</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Stripe Charge</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Date</th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
          {cardTransactions.map((transaction) => (
            <tr key={transaction.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
              <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                <span className="text-purple-600">
                  {transaction.id.slice(0, 8)}...
                </span>
              </td>
              <td className="px-4 py-4 text-sm text-gray-900 dark:text-gray-100">
                <div className="font-medium">${formatAmount(transaction.amount_usd, 2)} USD</div>
                <div className="text-gray-500 text-xs">{transaction.currency.toUpperCase()}</div>
              </td>
              <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
                {transaction.business_name}
              </td>
              <td className="px-4 py-4 whitespace-nowrap">
                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(transaction.status)}`}>
                  {transaction.status}
                </span>
              </td>
              <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
                {transaction.stripe_charge_id ? `${transaction.stripe_charge_id.slice(0, 10)}...` : 'N/A'}
              </td>
              <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
                {new Date(transaction.created_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            <p className="mt-2 text-gray-600 dark:text-gray-300">Loading dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
            <p className="mt-2 text-gray-600 dark:text-gray-300">
              Overview of your payment activity
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Business Filter */}
            {businesses.length > 0 && (
              <div className="relative">
                <select
                  id="business-filter"
                  value={selectedBusinessId}
                  onChange={handleBusinessChange}
                  className="appearance-none bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg pl-10 pr-10 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 shadow-sm hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 cursor-pointer min-w-[200px]"
                >
                  <option value="">All Businesses</option>
                  {businesses.map((business) => (
                    <option key={business.id} value={business.id}>
                      {business.name}
                    </option>
                  ))}
                </select>
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            )}
            {/* Connection Status */}
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {isConnected ? 'Live updates' : 'Reconnecting...'}
              </span>
            </div>
          </div>
        </div>

        {/* Real-time Notification */}
        {notification && (
          <div className="mb-6 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 px-4 py-3 rounded-lg flex items-center gap-2 animate-pulse">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {notification}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Combined Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Total Volume */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Volume</p>
                <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
                  ${parseFloat(combinedStats?.total_volume_usd || '0').toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {combinedStats?.total_transactions || 0} transactions
                </p>
              </div>
              <div className="p-3 bg-purple-100 dark:bg-purple-900/20 rounded-full">
                <svg className="h-8 w-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Crypto Volume */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Crypto Volume</p>
                <p className="mt-2 text-3xl font-bold text-blue-600">
                  ${parseFloat(combinedStats?.crypto_volume_usd || '0').toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {combinedStats?.crypto_transactions || 0} payments
                </p>
              </div>
              <div className="p-3 bg-blue-100 dark:bg-blue-900/20 rounded-full">
                <svg className="h-8 w-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Card Volume */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Card Volume</p>
                <p className="mt-2 text-3xl font-bold text-green-600">
                  ${parseFloat(combinedStats?.card_volume_usd || '0').toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {combinedStats?.card_transactions || 0} transactions
                </p>
              </div>
              <div className="p-3 bg-green-100 dark:bg-green-900/20 rounded-full">
                <svg className="h-8 w-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Total Fees */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Platform Fees</p>
                <p className="mt-2 text-3xl font-bold text-orange-600">
                  ${parseFloat(combinedStats?.total_fees_usd || '0').toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {planInfo?.commission_percent || '1%'} commission
                </p>
              </div>
              <div className="p-3 bg-orange-100 dark:bg-orange-900/20 rounded-full">
                <svg className="h-8 w-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Transactions Section with Tabs */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Transactions</h2>
              <button
                onClick={exportToCSV}
                disabled={exporting}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {exporting ? (
                  <>
                    <svg className="animate-spin h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Exporting...
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Export CSV
                  </>
                )}
              </button>
            </div>

            {/* Tab Navigation */}
            <div className="mt-4">
              <nav className="flex space-x-8">
                <button
                  onClick={() => handleTabChange('all')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'all'
                      ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  All
                  {combinedStats && (
                    <span className="ml-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-300 py-0.5 px-2 rounded-full text-xs">
                      {combinedStats.total_transactions}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => handleTabChange('crypto')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'crypto'
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  Crypto
                  {combinedStats && (
                    <span className="ml-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-300 py-0.5 px-2 rounded-full text-xs">
                      {combinedStats.crypto_transactions}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => handleTabChange('card')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'card'
                      ? 'border-green-500 text-green-600 dark:text-green-400'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  Credit Card
                  {combinedStats && (
                    <span className="ml-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-300 py-0.5 px-2 rounded-full text-xs">
                      {combinedStats.card_transactions}
                    </span>
                  )}
                </button>
              </nav>
            </div>
          </div>

          {/* Tab Content */}
          <div className="overflow-x-auto">
            {activeTab === 'all' && renderAllTransactions()}
            {activeTab === 'crypto' && renderCryptoTransactions()}
            {activeTab === 'card' && renderCardTransactions()}
          </div>
        </div>
      </div>
    </div>
  );
}