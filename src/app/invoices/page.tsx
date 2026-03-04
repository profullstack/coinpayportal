'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  currency: string;
  amount: string;
  crypto_currency: string | null;
  crypto_amount: string | null;
  due_date: string | null;
  created_at: string;
  clients: { id: string; name: string; email: string; company_name: string } | null;
  businesses: { id: string; name: string } | null;
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-300',
  sent: 'bg-blue-500/20 text-blue-300',
  paid: 'bg-green-500/20 text-green-300',
  overdue: 'bg-red-500/20 text-red-300',
  cancelled: 'bg-gray-500/20 text-gray-500',
};

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    fetchInvoices();
  }, [statusFilter]);

  const fetchInvoices = async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);

      const result = await authFetch(`/api/invoices?${params.toString()}`, {}, router);
      if (!result) return;

      if (!result.response.ok || !result.data.success) {
        setError(result.data.error || 'Failed to load invoices');
        setLoading(false);
        return;
      }

      setInvoices(result.data.invoices);
      setLoading(false);
    } catch {
      setError('Failed to load invoices');
      setLoading(false);
    }
  };

  const formatAmount = (amount: string, currency: string) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(parseFloat(amount));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Invoices</h1>
            <p className="mt-2 text-gray-400">Create and manage crypto invoices</p>
          </div>
          <Link
            href="/invoices/create"
            className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Invoice
          </Link>
        </div>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg">{error}</div>
        )}

        {/* Filters */}
        <div className="mb-6 flex gap-2 flex-wrap">
          {['', 'draft', 'sent', 'paid', 'overdue', 'cancelled'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
            </button>
          ))}
        </div>

        {/* Invoice List */}
        {invoices.length === 0 ? (
          <div className="bg-gray-800/50 rounded-2xl p-12 text-center border border-gray-700">
            <svg className="mx-auto h-12 w-12 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-white">No invoices yet</h3>
            <p className="mt-2 text-gray-400">Create your first invoice to get started.</p>
            <Link href="/invoices/create" className="mt-4 inline-block px-4 py-2 bg-purple-600 text-white rounded-lg">
              Create Invoice
            </Link>
          </div>
        ) : (
          <div className="bg-gray-800/50 rounded-2xl border border-gray-700 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Invoice</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Client</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Due Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-gray-700/30 transition-colors">
                    <td className="px-6 py-4">
                      <Link href={`/invoices/${invoice.id}`} className="text-purple-400 hover:text-purple-300 font-medium">
                        {invoice.invoice_number}
                      </Link>
                      <p className="text-xs text-gray-500">{invoice.businesses?.name}</p>
                    </td>
                    <td className="px-6 py-4 text-gray-300">
                      {invoice.clients?.company_name || invoice.clients?.name || invoice.clients?.email || '—'}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-white font-medium">{formatAmount(invoice.amount, invoice.currency)}</span>
                      {invoice.crypto_currency && (
                        <p className="text-xs text-gray-500">{invoice.crypto_amount ? `${invoice.crypto_amount} ${invoice.crypto_currency}` : invoice.crypto_currency}</p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${statusColors[invoice.status] || ''}`}>
                        {invoice.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-400 text-sm">
                      {invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-6 py-4">
                      <Link href={`/invoices/${invoice.id}`} className="text-sm text-purple-400 hover:text-purple-300">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
