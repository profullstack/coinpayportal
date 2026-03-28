'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

type PaymentTab = 'crypto' | 'card';

interface InvoicePayData {
  id: string;
  invoice_number: string;
  status: string;
  currency: string;
  amount: string;
  crypto_currency: string;
  crypto_amount: string;
  payment_address: string;
  stripe_checkout_url: string | null;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  businesses: { id: string; name: string } | null;
}

export default function InvoicePayPage() {
  const params = useParams();
  const invoiceId = params.id as string;

  const [invoice, setInvoice] = useState<InvoicePayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PaymentTab>('crypto');
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const hasCardOption = !!(invoice?.stripe_checkout_url);
  const hasCryptoOption = !!(invoice?.payment_address);

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch { /* ignore */ }
  };

  const checkBalance = useCallback(async () => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/check-balance`, { method: 'POST' });
      const data = await response.json();
      if (data.status === 'paid') {
        // Re-fetch invoice to get updated status
        const invoiceRes = await fetch(`/api/invoices/${invoiceId}/pay`);
        const invoiceData = await invoiceRes.json();
        if (invoiceData.success) {
          setInvoice(invoiceData.invoice);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      }
    } catch {
      // Balance check failures are non-fatal
    }
  }, [invoiceId]);

  const fetchInvoice = useCallback(async () => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pay`);
      const data = await response.json();
      if (data.success) {
        setInvoice(data.invoice);
        // Auto-select tab based on available payment methods
        if (!data.invoice.payment_address && data.invoice.stripe_checkout_url) {
          setActiveTab('card');
        }
        if (['paid', 'cancelled'].includes(data.invoice.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (['sent', 'overdue'].includes(data.invoice.status)) {
          // Actively check blockchain balance for pending invoices
          checkBalance();
        }
      } else {
        setError(data.error || 'Invoice not found');
      }
    } catch {
      setError('Failed to load invoice');
    }
    setLoading(false);
  }, [invoiceId, checkBalance]);

  useEffect(() => {
    fetchInvoice();
    pollRef.current = setInterval(fetchInvoice, 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchInvoice]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center px-4">
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl shadow-xl p-8 text-center border border-gray-700 max-w-md">
          <svg className="mx-auto h-16 w-16 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h3 className="mt-4 text-xl font-semibold text-white">Invoice Not Available</h3>
          <p className="mt-2 text-gray-400">{error || 'This invoice is not available for payment.'}</p>
        </div>
      </div>
    );
  }

  const isPaid = invoice.status === 'paid';
  const isOverdue = invoice.status === 'overdue';
  const isPending = ['sent', 'overdue'].includes(invoice.status);
  const showTabs = hasCryptoOption && hasCardOption && isPending;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 py-8 px-4">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <Link href="/" className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 mb-4">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="font-semibold">CoinPay</span>
          </Link>
          {invoice.businesses && (
            <p className="text-gray-400 text-sm">Invoice from {invoice.businesses.name}</p>
          )}
        </div>

        {/* Payment Card */}
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl shadow-xl overflow-hidden border border-gray-700">
          {/* Status Header */}
          <div className={`px-6 py-4 ${
            isPaid ? 'bg-green-500/20 border-b border-green-500/30' :
            isOverdue ? 'bg-red-500/20 border-b border-red-500/30' :
            'bg-purple-500/20 border-b border-purple-500/30'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isPaid ? (
                  <div className="h-6 w-6 rounded-full bg-green-500 flex items-center justify-center">
                    <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-purple-400 border-t-transparent"></div>
                )}
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    {isPaid ? 'Invoice Paid!' : isOverdue ? 'Invoice Overdue' : 'Awaiting Payment'}
                  </h2>
                  <p className="text-sm text-gray-300">{invoice.invoice_number}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Payment Method Tabs */}
          {showTabs && (
            <div className="flex border-b border-gray-700" data-testid="payment-tabs">
              <button
                onClick={() => setActiveTab('crypto')}
                className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
                  activeTab === 'crypto'
                    ? 'text-purple-400 border-b-2 border-purple-400 bg-purple-500/10'
                    : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/50'
                }`}
                data-testid="tab-crypto"
              >
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Pay with Crypto
                </span>
              </button>
              <button
                onClick={() => setActiveTab('card')}
                className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
                  activeTab === 'card'
                    ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-500/10'
                    : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/50'
                }`}
                data-testid="tab-card"
              >
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  Pay with Card
                </span>
              </button>
            </div>
          )}

          <div className="p-6 space-y-6">
            {/* Amount */}
            <div className="text-center">
              <p className="text-4xl font-bold text-white">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: invoice.currency }).format(parseFloat(invoice.amount))}
              </p>
              {activeTab === 'crypto' && invoice.crypto_amount && (
                <p className="text-lg text-purple-400 mt-1">
                  {parseFloat(invoice.crypto_amount).toFixed(8)} {invoice.crypto_currency}
                </p>
              )}

              {activeTab === 'crypto' && invoice.crypto_amount && !isPaid && (
                <button
                  onClick={() => copyToClipboard(parseFloat(invoice.crypto_amount).toFixed(8), 'amount')}
                  className={`mt-3 w-full py-3 px-4 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all ${
                    copiedField === 'amount'
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : 'bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30'
                  }`}
                >
                  {copiedField === 'amount' ? '✓ Amount Copied!' : '📋 Copy Amount'}
                </button>
              )}
            </div>

            {/* Due Date */}
            {invoice.due_date && (
              <div className="text-center">
                <p className={`text-sm ${isOverdue ? 'text-red-400' : 'text-gray-400'}`}>
                  Due: {new Date(invoice.due_date).toLocaleDateString('en-US', { dateStyle: 'long' })}
                  {isOverdue && ' (OVERDUE)'}
                </p>
              </div>
            )}

            {/* === CARD TAB === */}
            {activeTab === 'card' && hasCardOption && isPending && (
              <div className="space-y-6" data-testid="card-payment-section">
                <a
                  href={invoice.stripe_checkout_url!}
                  className="block w-full py-4 px-6 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-center transition-colors text-lg"
                  data-testid="pay-with-card-btn"
                >
                  <span className="flex items-center justify-center gap-3">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                    Pay with Card
                  </span>
                </a>

                <div className="text-center">
                  <p className="text-xs text-gray-500">
                    Secure payment powered by Stripe
                  </p>
                </div>
              </div>
            )}

            {/* === CRYPTO TAB === */}
            {activeTab === 'crypto' && (
              <>
                {/* Payment Address */}
                {invoice.payment_address && !isPaid && (
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Send to this address:</label>
                    <div className="bg-gray-900/50 rounded-xl p-4">
                      <p className="font-mono text-sm text-white break-all mb-3">{invoice.payment_address}</p>
                      <button
                        onClick={() => copyToClipboard(invoice.payment_address, 'address')}
                        className={`w-full py-3 px-4 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all ${
                          copiedField === 'address'
                            ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                            : 'bg-purple-600 text-white hover:bg-purple-500'
                        }`}
                      >
                        {copiedField === 'address' ? '✓ Address Copied!' : '📋 Copy Address'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Notes */}
            {invoice.notes && (
              <div className="bg-gray-900/50 rounded-xl p-4">
                <label className="block text-sm font-medium text-gray-400 mb-1">Notes</label>
                <p className="text-white text-sm">{invoice.notes}</p>
              </div>
            )}

            {/* Payment ID */}
            <div className="text-center text-xs text-gray-500">
              <p>Invoice ID: {invoice.id}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-gray-500 text-sm">
            Powered by <Link href="/" className="text-purple-400 hover:text-purple-300">CoinPay</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
