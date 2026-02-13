'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  trialing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  past_due: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  canceled: 'bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-500',
  incomplete: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  unpaid: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

interface SubscriptionDetail {
  id: string;
  status: string;
  customer_email: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
  canceled_at: string | null;
  cancel_at_period_end: boolean;
  subscription_plans: { name: string; amount: number; currency: string; interval: string } | null;
  stripe_details?: {
    current_period_start: number;
    current_period_end: number;
    cancel_at_period_end: boolean;
    canceled_at: number | null;
    trial_start: number | null;
    trial_end: number | null;
  };
}

export default function SubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [subscription, setSubscription] = useState<SubscriptionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    loadSubscription();
  }, [id]);

  async function loadSubscription() {
    setLoading(true);
    try {
      const result = await authFetch(`/api/stripe/subscriptions/${id}`, {}, router);
      if (result?.data?.success) {
        setSubscription(result.data.subscription);
      }
    } catch (err) {
      console.error('Failed to load subscription:', err);
    }
    setLoading(false);
  }

  async function handleCancel(immediately: boolean) {
    const msg = immediately
      ? 'Cancel this subscription immediately? The customer will lose access now.'
      : 'Cancel at end of billing period?';
    if (!confirm(msg)) return;
    setCanceling(true);
    try {
      const result = await authFetch(`/api/stripe/subscriptions/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ immediately }),
      }, router);
      if (result?.data?.success) {
        loadSubscription();
      } else {
        alert(result?.data?.error || 'Failed to cancel');
      }
    } catch {
      alert('Failed to cancel subscription');
    }
    setCanceling(false);
  }

  function formatDate(ts: number | string | null | undefined) {
    if (!ts) return 'N/A';
    const date = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!subscription) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <p className="text-center text-gray-500">Subscription not found</p>
        <Link href="/subscriptions" className="block text-center text-blue-600 mt-4">← Back to subscriptions</Link>
      </div>
    );
  }

  const plan = subscription.subscription_plans;
  const details = subscription.stripe_details;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Link href="/subscriptions" className="text-sm text-blue-600 hover:text-blue-700 mb-4 inline-block">
        ← Back to subscriptions
      </Link>

      <div className="border rounded-xl p-6 dark:border-gray-700">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">{plan?.name || 'Unknown Plan'}</h1>
            <p className="text-gray-500 mt-1">{subscription.customer_email || 'No email'}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[subscription.status] || 'bg-gray-100 text-gray-600'}`}>
            {subscription.status}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-6 mb-6">
          <div>
            <p className="text-sm text-gray-500">Amount</p>
            <p className="text-lg font-semibold">
              {plan ? `$${(plan.amount / 100).toFixed(2)}/${plan.interval}` : 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Created</p>
            <p className="text-lg font-semibold">{formatDate(subscription.created_at)}</p>
          </div>
          {details?.current_period_end && (
            <div>
              <p className="text-sm text-gray-500">Current Period Ends</p>
              <p className="text-lg font-semibold">{formatDate(details.current_period_end)}</p>
            </div>
          )}
          {details?.trial_end && (
            <div>
              <p className="text-sm text-gray-500">Trial Ends</p>
              <p className="text-lg font-semibold">{formatDate(details.trial_end)}</p>
            </div>
          )}
          {subscription.canceled_at && (
            <div>
              <p className="text-sm text-gray-500">Canceled</p>
              <p className="text-lg font-semibold">{formatDate(subscription.canceled_at)}</p>
            </div>
          )}
        </div>

        {subscription.cancel_at_period_end && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-6">
            <p className="text-sm text-yellow-800 dark:text-yellow-400">
              This subscription will cancel at the end of the current billing period.
            </p>
          </div>
        )}

        {subscription.status === 'active' && !subscription.cancel_at_period_end && (
          <div className="flex gap-3">
            <button
              onClick={() => handleCancel(false)}
              disabled={canceling}
              className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              Cancel at Period End
            </button>
            <button
              onClick={() => handleCancel(true)}
              disabled={canceling}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              Cancel Immediately
            </button>
          </div>
        )}

        {subscription.stripe_subscription_id && (
          <div className="mt-6 pt-6 border-t dark:border-gray-700">
            <p className="text-xs text-gray-400">
              Stripe Subscription ID: {subscription.stripe_subscription_id}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
