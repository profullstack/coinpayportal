'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface CryptoPayment {
  id: string;
  business_id: string;
  amount_crypto: string;
  amount_usd: string;
  currency: string;
  status: string;
  payment_address: string;
  tx_hash: string | null;
  confirmations: number;
  created_at: string;
  expires_at: string;
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

type TabType = 'all' | 'crypto' | 'card';

export default function PaymentHistoryPage() {
  const router = useRouter();
  const [cryptoPayments, setCryptoPayments] = useState<CryptoPayment[]>([]);
  const [cardTransactions, setCardTransactions] = useState<CardTransaction[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Current tab
  const [activeTab, setActiveTab] = useState<TabType>('all');
  
  // Filters
  const [selectedBusiness, setSelectedBusiness] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedCurrency, setSelectedCurrency] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    fetchBusinesses();
    fetchPayments();
  }, []);

  useEffect(() => {
    // Refetch when filters or tab change
    fetchPayments();
  }, [selectedBusiness, selectedStatus, selectedCurrency, searchQuery, dateFrom, dateTo, activeTab]);

  const fetchBusinesses = async () => {
    try {
      const result = await authFetch('/api/businesses', {}, router);
      if (!result) return;

      const { response, data } = result;
      if (response.ok && data.success) {
        setBusinesses(data.businesses || []);
      }
    } catch (error) {
      console.error('Error fetching businesses:', error);
    }
  };

  const fetchPayments = async () => {
    try {
      setLoading(true);
      
      const promises = [];

      // Fetch crypto payments if needed
      if (activeTab === 'all' || activeTab === 'crypto') {
        const cryptoParams = new URLSearchParams();
        if (selectedBusiness) cryptoParams.append('business_id', selectedBusiness);
        if (selectedStatus) cryptoParams.append('status', selectedStatus);
        if (selectedCurrency) cryptoParams.append('currency', selectedCurrency);
        if (dateFrom) cryptoParams.append('date_from', dateFrom);
        if (dateTo) cryptoParams.append('date_to', dateTo);
        cryptoParams.append('limit', '100'); // Get more for history page

        promises.push(authFetch(`/api/payments?${cryptoParams}`, {}, router));
      }

      // Fetch card transactions if needed  
      if (activeTab === 'all' || activeTab === 'card') {
        const cardParams = new URLSearchParams();
        if (selectedBusiness) cardParams.append('business_id', selectedBusiness);
        if (selectedStatus) cardParams.append('status', selectedStatus);
        if (dateFrom) cardParams.append('date_from', dateFrom);
        if (dateTo) cardParams.append('date_to', dateTo);
        cardParams.append('limit', '100');

        promises.push(authFetch(`/api/stripe/transactions?${cardParams}`, {}, router));
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
        setCryptoPayments(cryptoResults.data.payments || []);
      } else if (activeTab === 'crypto' || activeTab === 'all') {
        setCryptoPayments([]);
      }

      // Process card results
      if (cardResults && cardResults.response.ok && cardResults.data.success) {
        setCardTransactions(cardResults.data.transactions || []);
      } else if (activeTab === 'card' || activeTab === 'all') {
        setCardTransactions([]);
      }

    } catch (error) {
      console.error('Error fetching payments:', error);
      setError('Failed to load payment history');
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
  };

  const exportToCSV = () => {
    let dataToExport: any[] = [];
    let filename = '';

    if (activeTab === 'all') {
      // Export both crypto and card data
      const cryptoData = cryptoPayments.map(p => ({
        type: 'crypto',
        id: p.id,
        business_id: p.business_id,
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
        business_id: t.business_id,
        business_name: t.business_name,
        amount_usd: t.amount_usd,
        amount_crypto: '',
        currency: t.currency,
        status: t.status,
        created_at: t.created_at,
        payment_address: '',
        tx_hash: t.stripe_charge_id || '',
      }));
      dataToExport = [...cryptoData, ...cardData];
      filename = 'all-payment-history';
    } else if (activeTab === 'crypto') {
      dataToExport = cryptoPayments.map(p => ({
        id: p.id,
        business_id: p.business_id,
        amount_usd: p.amount_usd,
        amount_crypto: p.amount_crypto,
        currency: p.currency,
        status: p.status,
        created_at: p.created_at,
        expires_at: p.expires_at,
        payment_address: p.payment_address,
        tx_hash: p.tx_hash || '',
        confirmations: p.confirmations,
      }));
      filename = 'crypto-payment-history';
    } else if (activeTab === 'card') {
      dataToExport = cardTransactions.map(t => ({
        id: t.id,
        business_id: t.business_id,
        business_name: t.business_name,
        amount_usd: t.amount_usd,
        currency: t.currency,
        status: t.status,
        created_at: t.created_at,
        updated_at: t.updated_at,
        stripe_payment_intent_id: t.stripe_payment_intent_id,
        stripe_charge_id: t.stripe_charge_id || '',
        last4: t.last4 || '',
        brand: t.brand || '',
      }));
      filename = 'card-payment-history';
    }

    if (dataToExport.length === 0) {
      alert('No data to export');
      return;
    }

    // Simple CSV export (could use Papa Parse here if imported)
    const csvContent = [
      Object.keys(dataToExport[0]).join(','),
      ...dataToExport.map(row => Object.values(row).map(val => 
        typeof val === 'string' && val.includes(',') ? `"${val}"` : val
      ).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
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
  };

  const clearFilters = () => {
    setSelectedBusiness('');
    setSelectedStatus('');
    setSelectedCurrency('');
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
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

  const formatAmount = (amount: string, decimals: number): string => {
    const num = parseFloat(amount);
    return isNaN(num) ? '0' : num.toFixed(decimals);
  };

  const renderAllPayments = () => {
    // Combine and sort crypto + card transactions
    const allPayments = [
      ...cryptoPayments.map(p => ({ ...p, type: 'crypto' })),
      ...cardTransactions.map(t => ({ ...t, type: 'card' }))
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Apply search filter
    const filteredPayments = searchQuery 
      ? allPayments.filter(payment => 
          payment.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (payment.type === 'crypto' && (payment as any).payment_address?.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (payment.type === 'crypto' && (payment as any).tx_hash?.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (payment.type === 'card' && (payment as any).stripe_charge_id?.toLowerCase().includes(searchQuery.toLowerCase()))
        )
      : allPayments;

    if (filteredPayments.length === 0) {
      return (
        <div className="px-6 py-12 text-center">
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No payments found</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {searchQuery || selectedBusiness || selectedStatus ? 'Try adjusting your filters.' : 'Get started by creating your first payment.'}
          </p>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Payment ID</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Amount</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Created</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Details</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
            {filteredPayments.map((payment: any) => (
              <tr key={`${payment.type}-${payment.id}`} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="px-4 py-4 whitespace-nowrap text-sm">
                  <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                    payment.type === 'crypto' ? 'text-blue-600 bg-blue-100' : 'text-purple-600 bg-purple-100'
                  }`}>
                    {payment.type === 'crypto' ? 'Crypto' : 'Card'}
                  </span>
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                  <Link
                    href={`/payments/${payment.id}`}
                    className="text-purple-600 hover:text-purple-800 hover:underline"
                  >
                    {payment.id.slice(0, 8)}...
                  </Link>
                </td>
                <td className="px-4 py-4 text-sm text-gray-900 dark:text-gray-100">
                  <div className="font-medium">${formatAmount(payment.amount_usd, 2)}</div>
                  {payment.type === 'crypto' && payment.amount_crypto && (
                    <div className="text-gray-500 text-xs">
                      {formatAmount(payment.amount_crypto, 8)} {payment.currency?.toUpperCase()}
                    </div>
                  )}
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(payment.status)}`}>
                    {payment.status}
                  </span>
                </td>
                <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
                  {new Date(payment.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
                  {payment.type === 'crypto' ? (
                    payment.payment_address ? `${payment.payment_address.slice(0, 10)}...` : 'N/A'
                  ) : (
                    payment.business_name || 'N/A'
                  )}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm">
                  <Link
                    href={`/payments/${payment.id}`}
                    className="text-purple-600 hover:text-purple-800"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderCryptoPayments = () => {
    const filteredPayments = searchQuery 
      ? cryptoPayments.filter(payment => 
          payment.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
          payment.payment_address.toLowerCase().includes(searchQuery.toLowerCase()) ||
          payment.tx_hash?.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : cryptoPayments;

    if (filteredPayments.length === 0) {
      return (
        <div className="px-6 py-12 text-center">
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No crypto payments found</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {searchQuery || selectedBusiness || selectedStatus ? 'Try adjusting your filters.' : 'Create your first crypto payment to see it here.'}
          </p>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Payment ID</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Amount</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Chain</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Address</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">TX Hash</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Created</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
            {filteredPayments.map((payment) => (
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
                  <div className="font-medium">${formatAmount(payment.amount_usd, 2)}</div>
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
                  {payment.payment_address.slice(0, 10)}...
                </td>
                <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
                  {payment.tx_hash ? `${payment.tx_hash.slice(0, 10)}...` : 'Pending'}
                </td>
                <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
                  {new Date(payment.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm">
                  <Link
                    href={`/payments/${payment.id}`}
                    className="text-purple-600 hover:text-purple-800"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderCardTransactions = () => {
    const filteredTransactions = searchQuery 
      ? cardTransactions.filter(transaction => 
          transaction.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
          transaction.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          transaction.stripe_charge_id?.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : cardTransactions;

    if (filteredTransactions.length === 0) {
      return (
        <div className="px-6 py-12 text-center">
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No card transactions found</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {searchQuery || selectedBusiness || selectedStatus ? 'Try adjusting your filters.' : 'Card payments will appear here once processed.'}
          </p>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Transaction ID</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Amount</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Business</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Last4</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Brand</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Stripe Charge</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Created</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
            {filteredTransactions.map((transaction) => (
              <tr key={transaction.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                  <span className="text-purple-600">
                    {transaction.id.slice(0, 8)}...
                  </span>
                </td>
                <td className="px-4 py-4 text-sm text-gray-900 dark:text-gray-100">
                  <div className="font-medium">${formatAmount(transaction.amount_usd, 2)}</div>
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
                  {transaction.last4 ? `****${transaction.last4}` : 'N/A'}
                </td>
                <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
                  {transaction.brand || 'N/A'}
                </td>
                <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
                  {transaction.stripe_charge_id ? `${transaction.stripe_charge_id.slice(0, 10)}...` : 'N/A'}
                </td>
                <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
                  {new Date(transaction.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm">
                  <span className="text-gray-400">View</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
            <div className="mb-4 lg:mb-0">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Payment History</h1>
              <p className="mt-2 text-gray-600 dark:text-gray-300">
                View and manage all your crypto and card transactions
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={exportToCSV}
                className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
                Export CSV
              </button>
              <Link
                href="/payments/create"
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-500"
              >
                <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path>
                </svg>
                Create Payment
              </Link>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-4">
            {/* Business Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Business
              </label>
              <select
                value={selectedBusiness}
                onChange={(e) => setSelectedBusiness(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700"
              >
                <option value="">All Businesses</option>
                {businesses.map((business) => (
                  <option key={business.id} value={business.id}>
                    {business.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Status
              </label>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700"
              >
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="detected">Detected</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="expired">Expired</option>
              </select>
            </div>

            {/* Currency Filter (only show for crypto tab) */}
            {(activeTab === 'crypto' || activeTab === 'all') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Currency
                </label>
                <select
                  value={selectedCurrency}
                  onChange={(e) => setSelectedCurrency(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700"
                >
                  <option value="">All Currencies</option>
                  <option value="btc">Bitcoin (BTC)</option>
                  <option value="eth">Ethereum (ETH)</option>
                  <option value="pol">Polygon (POL)</option>
                  <option value="sol">Solana (SOL)</option>
                </select>
              </div>
            )}

            {/* Search */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Search
              </label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ID, address, charge..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700"
              />
            </div>

            {/* Date From */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                From Date
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700"
              />
            </div>

            {/* Date To */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                To Date
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700"
              />
            </div>
          </div>

          {/* Clear Filters Button */}
          <div className="flex justify-end">
            <button
              onClick={clearFilters}
              className="text-sm text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300"
            >
              Clear all filters
            </button>
          </div>
        </div>

        {/* Payments Table with Tabs */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            {/* Tab Navigation */}
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
                <span className="ml-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-300 py-0.5 px-2 rounded-full text-xs">
                  {cryptoPayments.length + cardTransactions.length}
                </span>
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
                <span className="ml-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-300 py-0.5 px-2 rounded-full text-xs">
                  {cryptoPayments.length}
                </span>
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
                <span className="ml-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-300 py-0.5 px-2 rounded-full text-xs">
                  {cardTransactions.length}
                </span>
              </button>
            </nav>
          </div>

          {/* Loading State */}
          {loading ? (
            <div className="px-6 py-12 text-center">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600"></div>
              <p className="mt-2 text-gray-600 dark:text-gray-300">Loading payments...</p>
            </div>
          ) : (
            <>
              {/* Tab Content */}
              {activeTab === 'all' && renderAllPayments()}
              {activeTab === 'crypto' && renderCryptoPayments()}
              {activeTab === 'card' && renderCardTransactions()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}