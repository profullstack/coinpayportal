'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
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
  payment_address: string | null;
  merchant_wallet_address: string | null;
  fee_rate: string;
  fee_amount: string | null;
  due_date: string | null;
  paid_at: string | null;
  tx_hash: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  clients: { id: string; name: string; email: string; company_name: string; phone?: string; address?: string } | null;
  businesses: { id: string; name: string } | null;
  invoice_schedules: Array<{ id: string; recurrence: string; active: boolean; occurrences_count: number }> | null;
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  sent: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  paid: 'bg-green-500/20 text-green-300 border-green-500/30',
  overdue: 'bg-red-500/20 text-red-300 border-red-500/30',
  cancelled: 'bg-gray-500/20 text-gray-500 border-gray-500/30',
};

const statusSteps = ['draft', 'sent', 'paid'];

export default function InvoiceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const invoiceId = params.id as string;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchInvoice();
  }, [invoiceId]);

  const fetchInvoice = async () => {
    const result = await authFetch(`/api/invoices/${invoiceId}`, {}, router);
    if (!result) return;
    if (result.data.success) {
      setInvoice(result.data.invoice);
    } else {
      setError(result.data.error || 'Invoice not found');
    }
    setLoading(false);
  };

  const handleSend = async () => {
    setActionLoading('send');
    setError('');
    const result = await authFetch(`/api/invoices/${invoiceId}/send`, { method: 'POST' }, router);
    if (result?.data.success) {
      setInvoice(result.data.invoice);
    } else {
      setError(result?.data.error || 'Failed to send invoice');
    }
    setActionLoading('');
  };

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel this invoice?')) return;
    setActionLoading('cancel');
    const result = await authFetch(`/api/invoices/${invoiceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    }, router);
    if (result?.data.success) {
      setInvoice(result.data.invoice);
    } else {
      setError(result?.data.error || 'Failed to cancel invoice');
    }
    setActionLoading('');
  };

  const handleMarkPaid = async () => {
    setActionLoading('paid');
    const txHash = prompt('Enter transaction hash (optional):');
    const result = await authFetch(`/api/invoices/${invoiceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paid', tx_hash: txHash || undefined }),
    }, router);
    if (result?.data.success) {
      setInvoice(result.data.invoice);
    } else {
      setError(result?.data.error || 'Failed to mark as paid');
    }
    setActionLoading('');
  };

  const formatAmount = (amount: string, currency: string) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(parseFloat(amount));

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl text-white mb-2">Invoice Not Found</h2>
          <p className="text-gray-400">{error}</p>
          <Link href="/invoices" className="mt-4 inline-block text-purple-400">← Back to Invoices</Link>
        </div>
      </div>
    );
  }

  const currentStepIdx = statusSteps.indexOf(invoice.status === 'overdue' ? 'sent' : invoice.status === 'cancelled' ? 'draft' : invoice.status);

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <Link href="/invoices" className="text-purple-400 hover:text-purple-300 text-sm mb-4 inline-block">
          ← Back to Invoices
        </Link>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg">{error}</div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">{invoice.invoice_number}</h1>
            <p className="text-gray-400">{invoice.businesses?.name}</p>
          </div>
          <span className={`px-3 py-1.5 rounded-full text-sm font-medium border ${statusColors[invoice.status] || ''}`}>
            {invoice.status.toUpperCase()}
          </span>
        </div>

        {/* Status Timeline */}
        {invoice.status !== 'cancelled' && (
          <div className="mb-8 flex items-center gap-2">
            {statusSteps.map((step, i) => (
              <div key={step} className="flex items-center flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                  i <= currentStepIdx ? 'bg-purple-500 text-white' : 'bg-gray-700 text-gray-500'
                }`}>
                  {i < currentStepIdx ? '✓' : i + 1}
                </div>
                <span className={`ml-2 text-xs ${i <= currentStepIdx ? 'text-purple-300' : 'text-gray-600'}`}>
                  {step.charAt(0).toUpperCase() + step.slice(1)}
                </span>
                {i < statusSteps.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-3 ${i < currentStepIdx ? 'bg-purple-500' : 'bg-gray-700'}`} />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Amount Card */}
            <div className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Invoice Details</h3>
              <div className="space-y-3">
                <div className="flex justify-between py-2 border-b border-gray-700">
                  <span className="text-gray-400">Amount</span>
                  <span className="text-white font-medium text-lg">{formatAmount(invoice.amount, invoice.currency)}</span>
                </div>
                {invoice.crypto_currency && (
                  <div className="flex justify-between py-2 border-b border-gray-700">
                    <span className="text-gray-400">Crypto</span>
                    <span className="text-white">{invoice.crypto_amount ? `${invoice.crypto_amount} ${invoice.crypto_currency}` : invoice.crypto_currency}</span>
                  </div>
                )}
                {invoice.fee_rate && (
                  <div className="flex justify-between py-2 border-b border-gray-700">
                    <span className="text-gray-400">Platform Fee</span>
                    <span className="text-gray-300">{(parseFloat(invoice.fee_rate) * 100).toFixed(1)}%{invoice.fee_amount ? ` (${formatAmount(invoice.fee_amount, invoice.currency)})` : ''}</span>
                  </div>
                )}
                {invoice.due_date && (
                  <div className="flex justify-between py-2 border-b border-gray-700">
                    <span className="text-gray-400">Due Date</span>
                    <span className={`${new Date(invoice.due_date) < new Date() && invoice.status !== 'paid' ? 'text-red-400' : 'text-white'}`}>
                      {new Date(invoice.due_date).toLocaleDateString()}
                    </span>
                  </div>
                )}
                {invoice.payment_address && (
                  <div className="flex justify-between py-2 border-b border-gray-700">
                    <span className="text-gray-400">Payment Address</span>
                    <span className="text-white font-mono text-xs break-all ml-4">{invoice.payment_address}</span>
                  </div>
                )}
                {invoice.tx_hash && (
                  <div className="flex justify-between py-2 border-b border-gray-700">
                    <span className="text-gray-400">TX Hash</span>
                    <span className="text-purple-400 font-mono text-xs break-all ml-4">{invoice.tx_hash}</span>
                  </div>
                )}
                {invoice.paid_at && (
                  <div className="flex justify-between py-2">
                    <span className="text-gray-400">Paid At</span>
                    <span className="text-green-400">{new Date(invoice.paid_at).toLocaleString()}</span>
                  </div>
                )}
              </div>
              {invoice.notes && (
                <div className="mt-4 p-3 bg-gray-700/50 rounded-lg">
                  <p className="text-xs text-gray-400 mb-1">Notes</p>
                  <p className="text-gray-300 text-sm">{invoice.notes}</p>
                </div>
              )}
            </div>

            {/* Recurring Info */}
            {invoice.invoice_schedules && invoice.invoice_schedules.length > 0 && (
              <div className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6">
                <h3 className="text-lg font-semibold text-white mb-3">Recurring Schedule</h3>
                {invoice.invoice_schedules.map(s => (
                  <div key={s.id} className="flex items-center gap-3">
                    <span className={`px-2 py-1 rounded text-xs ${s.active ? 'bg-green-500/20 text-green-300' : 'bg-gray-500/20 text-gray-400'}`}>
                      {s.active ? 'Active' : 'Inactive'}
                    </span>
                    <span className="text-gray-300 text-sm capitalize">{s.recurrence}</span>
                    <span className="text-gray-500 text-xs">({s.occurrences_count} sent)</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Client Info */}
            {invoice.clients && (
              <div className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6">
                <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">Client</h3>
                <p className="text-white font-medium">{invoice.clients.company_name || invoice.clients.name}</p>
                <p className="text-gray-400 text-sm">{invoice.clients.email}</p>
                {invoice.clients.phone && <p className="text-gray-500 text-xs mt-1">{invoice.clients.phone}</p>}
              </div>
            )}

            {/* Actions */}
            <div className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6 space-y-3">
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">Actions</h3>

              {(invoice.status === 'draft' || invoice.status === 'overdue') && (
                <button
                  onClick={handleSend}
                  disabled={actionLoading === 'send'}
                  className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium disabled:opacity-50 transition-colors"
                >
                  {actionLoading === 'send' ? 'Sending...' : '📧 Send Invoice'}
                </button>
              )}

              {(invoice.status === 'sent' || invoice.status === 'overdue') && (
                <button
                  onClick={handleMarkPaid}
                  disabled={actionLoading === 'paid'}
                  className="w-full px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium disabled:opacity-50 transition-colors"
                >
                  {actionLoading === 'paid' ? 'Updating...' : '✅ Mark as Paid'}
                </button>
              )}

              {invoice.status === 'sent' && invoice.payment_address && (
                <Link
                  href={`/invoices/${invoice.id}/pay`}
                  className="block w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium text-center transition-colors"
                >
                  🔗 View Payment Page
                </Link>
              )}

              {['draft', 'sent', 'overdue'].includes(invoice.status) && (
                <button
                  onClick={handleCancel}
                  disabled={actionLoading === 'cancel'}
                  className="w-full px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg font-medium disabled:opacity-50 transition-colors"
                >
                  {actionLoading === 'cancel' ? 'Cancelling...' : 'Cancel Invoice'}
                </button>
              )}
            </div>

            {/* Dates */}
            <div className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6">
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">Dates</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Created</span>
                  <span className="text-gray-300">{new Date(invoice.created_at).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Updated</span>
                  <span className="text-gray-300">{new Date(invoice.updated_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
