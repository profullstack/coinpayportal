'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

interface DisputeEvidenceModalProps {
  disputeId: string;
  defaultCustomerEmail?: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}

const FILE_ACCEPT = '.pdf,.png,.jpg,.jpeg';

export function DisputeEvidenceModal({
  disputeId,
  defaultCustomerEmail,
  onClose,
  onSubmitted,
}: DisputeEvidenceModalProps) {
  const router = useRouter();
  const [productDescription, setProductDescription] = useState('');
  const [explanation, setExplanation] = useState('');
  const [serviceDate, setServiceDate] = useState('');
  const [shippingCarrier, setShippingCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [customerEmail, setCustomerEmail] = useState(defaultCustomerEmail || '');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [comms, setComms] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const hasAnything =
    productDescription.trim() ||
    explanation.trim() ||
    serviceDate ||
    trackingNumber.trim() ||
    customerEmail.trim() ||
    receipt ||
    proof ||
    comms;

  const handleSubmit = async () => {
    setError('');
    if (!hasAnything) {
      setError('Add at least one piece of evidence before submitting.');
      return;
    }
    if (
      !window.confirm(
        'Submit this evidence to Stripe? Submission is final — Stripe locks the evidence and reviews your response.'
      )
    ) {
      return;
    }

    const form = new FormData();
    if (productDescription.trim()) form.set('product_description', productDescription.trim());
    if (explanation.trim()) form.set('uncategorized_text', explanation.trim());
    if (serviceDate) form.set('service_date', serviceDate);
    if (shippingCarrier.trim()) form.set('shipping_carrier', shippingCarrier.trim());
    if (trackingNumber.trim()) form.set('shipping_tracking_number', trackingNumber.trim());
    if (customerEmail.trim()) form.set('customer_email_address', customerEmail.trim());
    if (receipt) form.set('receipt', receipt);
    if (proof) form.set('shipping_documentation', proof);
    if (comms) form.set('customer_communication', comms);
    form.set('submit', 'true');

    setSubmitting(true);
    try {
      const result = await authFetch(`/api/stripe/disputes/${disputeId}/evidence`, { method: 'POST', body: form }, router);
      if (!result) return; // redirected to login
      const { response, data } = result;
      if (response.ok && data.success) {
        onSubmitted();
        onClose();
      } else {
        setError(data.error || 'Failed to submit evidence');
      }
    } catch {
      setError('Failed to submit evidence');
    } finally {
      setSubmitting(false);
    }
  };

  const fieldClass =
    'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500';
  const labelClass = 'block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-gray-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Submit dispute evidence</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" aria-label="Close">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Contest this chargeback by showing the customer received what they paid for. Fill in what applies and attach
            supporting files (PDF/PNG/JPEG, max 5&nbsp;MB each).
          </p>

          <div>
            <label className={labelClass}>Product / service description</label>
            <textarea
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              rows={2}
              placeholder="What the customer purchased"
              className={fieldClass}
            />
          </div>

          <div>
            <label className={labelClass}>Explanation — why the charge is valid</label>
            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              rows={3}
              placeholder="e.g. Customer downloaded/accessed the deliverable on <date>; access logs and receipt attached."
              className={fieldClass}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Delivery / service date</label>
              <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className={fieldClass} />
            </div>
            <div>
              <label className={labelClass}>Customer email</label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="customer@example.com"
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass}>Shipping carrier (if physical)</label>
              <input value={shippingCarrier} onChange={(e) => setShippingCarrier(e.target.value)} placeholder="UPS, FedEx…" className={fieldClass} />
            </div>
            <div>
              <label className={labelClass}>Tracking number (if physical)</label>
              <input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} className={fieldClass} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Receipt / invoice</label>
              <input type="file" accept={FILE_ACCEPT} onChange={(e) => setReceipt(e.target.files?.[0] || null)} className="text-xs text-gray-600 dark:text-gray-300" />
            </div>
            <div>
              <label className={labelClass}>Proof of delivery</label>
              <input type="file" accept={FILE_ACCEPT} onChange={(e) => setProof(e.target.files?.[0] || null)} className="text-xs text-gray-600 dark:text-gray-300" />
            </div>
            <div>
              <label className={labelClass}>Customer communication</label>
              <input type="file" accept={FILE_ACCEPT} onChange={(e) => setComms(e.target.files?.[0] || null)} className="text-xs text-gray-600 dark:text-gray-300" />
            </div>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-200 dark:border-gray-700 px-6 py-4">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting…' : 'Submit evidence'}
          </button>
        </div>
      </div>
    </div>
  );
}
