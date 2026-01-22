'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Papa from 'papaparse';
import { useRealtimePayments, type RealtimePayment } from '@/lib/realtime/useRealtimePayments';

interface DashboardStats {
  total_payments: number;
  successful_payments: number;
  pending_payments: number;
  failed_payments: number;
  total_volume: string;
  total_volume_usd: number;
  total_commission_usd: string;
}

interface RecentPayment {
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
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentPayments, setRecentPayments] = useState<RecentPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notification, setNotification] = useState<string | null>(null);

  // Real-time payment updates
  const { isConnected, payments: realtimePayments } = useRealtimePayments({
    onPaymentCreated: (payment) => {
      setNotification(`New payment created: ${payment.id.slice(0, 8)}...`);
      setTimeout(() => setNotification(null), 5000);
      // Add to recent payments
      setRecentPayments((prev) => [{
        id: payment.id,
        amount_crypto: payment.amount_crypto,
        amount_usd: payment.amount_usd,
        currency: payment.currency,
        status: payment.status,
        created_at: payment.created_at,
        payment_address: payment.payment_address,
      }, ...prev.slice(0, 9)]);
      // Update stats
      setStats((prev) => prev ? {
        ...prev,
        total_payments: prev.total_payments + 1,
        pending_payments: prev.pending_payments + 1,
      } : prev);
    },
    onPaymentCompleted: (payment) => {
      setNotification(`Payment completed: ${payment.id.slice(0, 8)}...`);
      setTimeout(() => setNotification(null), 5000);
      // Update payment in list
      setRecentPayments((prev) =>
        prev.map((p) => p.id === payment.id ? {
          ...p,
          status: payment.status,
        } : p)
      );
      // Update stats
      setStats((prev) => prev ? {
        ...prev,
        successful_payments: prev.successful_payments + 1,
        pending_payments: Math.max(0, prev.pending_payments - 1),
        total_volume_usd: prev.total_volume_usd + parseFloat(payment.amount_usd),
      } : prev);
    },
    onPaymentExpired: (payment) => {
      setNotification(`Payment expired: ${payment.id.slice(0, 8)}...`);
      setTimeout(() => setNotification(null), 5000);
      // Update payment in list
      setRecentPayments((prev) =>
        prev.map((p) => p.id === payment.id ? {
          ...p,
          status: payment.status,
        } : p)
      );
      // Update stats
      setStats((prev) => prev ? {
        ...prev,
        failed_payments: prev.failed_payments + 1,
        pending_payments: Math.max(0, prev.pending_payments - 1),
      } : prev);
    },
  });

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        router.push('/login');
        return;
      }

      const response = await fetch('/api/dashboard/stats', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to load dashboard data');
        setLoading(false);
        return;
      }

      setStats(data.stats);
      setRecentPayments(data.recent_payments);
      setLoading(false);
    } catch (err) {
      setError('Failed to load dashboard data');
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'pending':
      case 'detected':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
      case 'expired':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatAmount = (amount: string | null | undefined, decimals: number = 8) => {
    if (amount === null || amount === undefined || amount === '') return '0';
    const parsed = parseFloat(amount);
    if (isNaN(parsed)) return '0';
    return parsed.toFixed(decimals);
  };

  // Calculate fee split for display (0.5% platform fee)
  const calculateSplit = (amountCrypto: string) => {
    const total = parseFloat(amountCrypto) || 0;
    const platformFee = total * 0.005; // 0.5%
    const merchantAmount = total - platformFee;
    return { total, platformFee, merchantAmount };
  };

  // Export ALL payments as CSV (fetches from API)
  const exportToCSV = async () => {
    try {
      setExporting(true);
      const token = localStorage.getItem('auth_token');
      if (!token) {
        setError('Please log in to export payments');
        return;
      }

      // Fetch ALL payments from the API
      const response = await fetch('/api/payments', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        setError(result.error || 'Failed to fetch payments for export');
        return;
      }

      const payments = result.payments || [];
      if (payments.length === 0) {
        setNotification('No payments to export');
        setTimeout(() => setNotification(null), 3000);
        return;
      }

      const data = payments.map((payment: {
        id: string;
        business_name?: string;
        amount_crypto: string;
        amount_usd: string;
        currency: string;
        fee_amount?: string;
        merchant_amount?: string;
        status: string;
        created_at: string;
        tx_hash?: string;
      }) => {
        const split = calculateSplit(payment.amount_crypto);
        return {
          'Payment ID': payment.id,
          'Business': payment.business_name || 'Unknown',
          'Total Amount': formatAmount(payment.amount_crypto, 8),
          'Currency': payment.currency?.toUpperCase() || '',
          'USD Amount': formatAmount(payment.amount_usd, 2),
          'Commission': payment.fee_amount ? formatAmount(payment.fee_amount, 8) : formatAmount(split.platformFee.toString(), 8),
          'Take Home': payment.merchant_amount ? formatAmount(payment.merchant_amount, 8) : formatAmount(split.merchantAmount.toString(), 8),
          'Status': payment.status,
          'TX Hash': payment.tx_hash || '',
          'Date': formatDate(payment.created_at),
        };
      });

      const csv = Papa.unparse(data);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `payments-${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);

      setNotification(`Exported ${payments.length} payments`);
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      console.error('Export error:', err);
      setError('Failed to export payments');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="mt-2 text-gray-600">
              Overview of your payment activity
            </p>
          </div>
          {/* Connection Status */}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm text-gray-500">
              {isConnected ? 'Live updates' : 'Reconnecting...'}
            </span>
          </div>
        </div>

        {/* Real-time Notification */}
        {notification && (
          <div className="mb-6 bg-purple-50 border border-purple-200 text-purple-700 px-4 py-3 rounded-lg flex items-center gap-2 animate-pulse">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {notification}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Total Payments */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Total Payments
                </p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  {stats?.total_payments || 0}
                </p>
              </div>
              <div className="p-3 bg-purple-100 rounded-full">
                <svg
                  className="h-8 w-8 text-purple-600"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
                </svg>
              </div>
            </div>
          </div>

          {/* Successful Payments */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Successful</p>
                <p className="mt-2 text-3xl font-bold text-green-600">
                  {stats?.successful_payments || 0}
                </p>
              </div>
              <div className="p-3 bg-green-100 rounded-full">
                <svg
                  className="h-8 w-8 text-green-600"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
              </div>
            </div>
          </div>

          {/* Pending Payments */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Pending</p>
                <p className="mt-2 text-3xl font-bold text-yellow-600">
                  {stats?.pending_payments || 0}
                </p>
              </div>
              <div className="p-3 bg-yellow-100 rounded-full">
                <svg
                  className="h-8 w-8 text-yellow-600"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
              </div>
            </div>
          </div>

          {/* Failed Payments */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Failed</p>
                <p className="mt-2 text-3xl font-bold text-red-600">
                  {stats?.failed_payments || 0}
                </p>
              </div>
              <div className="p-3 bg-red-100 rounded-full">
                <svg
                  className="h-8 w-8 text-red-600"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Volume Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg shadow-md p-6 text-white">
            <p className="text-sm font-medium opacity-90">Total Volume (USD)</p>
            <p className="mt-2 text-4xl font-bold">
              ${stats?.total_volume_usd.toLocaleString() || '0.00'}
            </p>
            <p className="mt-2 text-sm opacity-75">
              From completed payments
            </p>
          </div>

          <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg shadow-md p-6 text-white">
            <p className="text-sm font-medium opacity-90">Commission Paid</p>
            <p className="mt-2 text-4xl font-bold">
              ${parseFloat(stats?.total_commission_usd || '0').toLocaleString()}
            </p>
            <p className="mt-2 text-sm opacity-75">
              0.5% platform fee
            </p>
          </div>

          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-md p-6 text-white">
            <p className="text-sm font-medium opacity-90">Success Rate</p>
            <p className="mt-2 text-4xl font-bold">
              {stats && stats.total_payments > 0
                ? Math.round(
                    (stats.successful_payments / stats.total_payments) * 100
                  )
                : 0}
              %
            </p>
            <p className="mt-2 text-sm opacity-75">
              {stats?.successful_payments || 0} of {stats?.total_payments || 0}{' '}
              payments
            </p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Quick Actions
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link
              href="/payments/create"
              className="flex items-center justify-center px-4 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-purple-600 hover:bg-purple-500 transition-colors"
            >
              <svg
                className="h-5 w-5 mr-2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path d="M12 4v16m8-8H4"></path>
              </svg>
              Create Payment
            </Link>
            <Link
              href="/businesses"
              className="flex items-center justify-center px-4 py-3 border border-gray-300 text-base font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 transition-colors"
            >
              <svg
                className="h-5 w-5 mr-2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
              </svg>
              Manage Businesses
            </Link>
          </div>
        </div>

        {/* Recent Payments */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">
              Recent Payments
            </h2>
            <button
              onClick={exportToCSV}
              disabled={exporting}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
                  <svg
                    className="h-4 w-4 mr-1.5"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export All CSV
                </>
              )}
            </button>
          </div>
          <div className="overflow-x-auto">
            {recentPayments.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <svg
                  className="mx-auto h-12 w-12 text-gray-400"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
                </svg>
                <h3 className="mt-2 text-sm font-medium text-gray-900">
                  No payments yet
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Get started by creating your first payment.
                </p>
                <div className="mt-6">
                  <Link
                    href="/payments/create"
                    className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-500"
                  >
                    <svg
                      className="h-5 w-5 mr-2"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path d="M12 4v16m8-8H4"></path>
                    </svg>
                    Create Payment
                  </Link>
                </div>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Payment ID
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Total
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Commission
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Take Home
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {recentPayments.map((payment) => {
                    const split = calculateSplit(payment.amount_crypto);

                    return (
                      <tr key={payment.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                          <Link
                            href={`/payments/${payment.id}`}
                            className="text-purple-600 hover:text-purple-800 hover:underline"
                          >
                            {payment.id.slice(0, 8)}...
                          </Link>
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-900">
                          <div className="font-medium">
                            {formatAmount(payment.amount_crypto, 8)} {payment.currency?.toUpperCase()}
                          </div>
                          <div className="text-gray-500 text-xs">
                            ${formatAmount(payment.amount_usd, 2)} USD
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-orange-600">
                          <div className="font-medium">
                            {payment.fee_amount
                              ? formatAmount(payment.fee_amount, 8)
                              : formatAmount(split.platformFee.toString(), 8)
                            } {payment.currency?.toUpperCase()}
                          </div>
                          <div className="text-orange-400 text-xs">0.5%</div>
                        </td>
                        <td className="px-4 py-4 text-sm text-green-600">
                          <div className="font-medium">
                            {payment.merchant_amount
                              ? formatAmount(payment.merchant_amount, 8)
                              : formatAmount(split.merchantAmount.toString(), 8)
                            } {payment.currency?.toUpperCase()}
                          </div>
                          <div className="text-green-400 text-xs">99.5%</div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span
                            className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(
                              payment.status
                            )}`}
                          >
                            {payment.status}
                          </span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatDate(payment.created_at)}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm">
                          <Link
                            href={`/payments/${payment.id}`}
                            className="inline-flex items-center px-3 py-1 border border-purple-300 text-purple-600 rounded-md hover:bg-purple-50 transition-colors text-xs font-medium"
                          >
                            View Details
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}