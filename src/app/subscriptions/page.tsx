'use client';

import { useState, useEffect } from 'react';
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
  paused: 'bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-500',
};

interface Plan {
  id: string;
  name: string;
  amount: number;
  currency: string;
  interval: string;
  trial_days: number | null;
  active: boolean;
  stripe_price_id: string;
  created_at: string;
}

interface Subscription {
  id: string;
  status: string;
  customer_email: string | null;
  created_at: string;
  canceled_at: string | null;
  subscription_plans: { name: string; amount: number; currency: string; interval: string } | null;
}

export default function SubscriptionsPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'plans' | 'subscriptions'>('subscriptions');
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const [creating, setCreating] = useState(false);

  // Create plan form
  const [planName, setPlanName] = useState('');
  const [planAmount, setPlanAmount] = useState('');
  const [planInterval, setPlanInterval] = useState('month');
  const [planDescription, setPlanDescription] = useState('');
  const [planTrialDays, setPlanTrialDays] = useState('');
  const [planBusinessId, setPlanBusinessId] = useState('');
  const [businesses, setBusinesses] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [plansRes, subsRes, bizRes] = await Promise.all([
        authFetch('/api/stripe/subscriptions/plans', {}, router),
        authFetch('/api/stripe/subscriptions', {}, router),
        authFetch('/api/businesses', {}, router),
      ]);

      if (plansRes?.data?.success) setPlans(plansRes.data.plans);
      if (subsRes?.data?.success) setSubscriptions(subsRes.data.subscriptions);
      if (bizRes?.data) {
        const bizList = Array.isArray(bizRes.data) ? bizRes.data : bizRes.data.businesses || [];
        setBusinesses(bizList);
        if (bizList.length > 0 && !planBusinessId) setPlanBusinessId(bizList[0].id);
      }
    } catch (err) {
      console.error('Failed to load subscriptions:', err);
    }
    setLoading(false);
  }

  async function handleCreatePlan(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const result = await authFetch('/api/stripe/subscriptions/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: planBusinessId,
          name: planName,
          description: planDescription || undefined,
          amount: Math.round(parseFloat(planAmount) * 100),
          interval: planInterval,
          trialDays: planTrialDays ? parseInt(planTrialDays) : undefined,
        }),
      }, router);

      if (result?.data?.success) {
        setPlans([result.data.plan, ...plans]);
        setShowCreatePlan(false);
        setPlanName('');
        setPlanAmount('');
        setPlanDescription('');
        setPlanTrialDays('');
      } else {
        alert(result?.data?.error || 'Failed to create plan');
      }
    } catch (err) {
      alert('Failed to create plan');
    }
    setCreating(false);
  }

  async function handleCancelSubscription(id: string) {
    if (!confirm('Cancel this subscription at end of billing period?')) return;
    try {
      const result = await authFetch(`/api/stripe/subscriptions/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ immediately: false }),
      }, router);
      if (result?.data?.success) {
        loadData();
      } else {
        alert(result?.data?.error || 'Failed to cancel');
      }
    } catch (err) {
      alert('Failed to cancel subscription');
    }
  }

  function formatAmount(amount: number, currency: string, interval: string) {
    const symbol = currency === 'usd' ? '$' : currency.toUpperCase() + ' ';
    return `${symbol}${(amount / 100).toFixed(2)}/${interval}`;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Subscription Billing</h1>
          <p className="text-gray-500 mt-1">Manage plans and customer subscriptions</p>
        </div>
        <button
          onClick={() => setShowCreatePlan(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          + Create Plan
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b mb-6">
        <button
          onClick={() => setActiveTab('subscriptions')}
          className={`px-4 py-2 font-medium border-b-2 transition ${activeTab === 'subscriptions' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Subscriptions ({subscriptions.length})
        </button>
        <button
          onClick={() => setActiveTab('plans')}
          className={`px-4 py-2 font-medium border-b-2 transition ${activeTab === 'plans' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Plans ({plans.length})
        </button>
      </div>

      {/* Subscriptions Tab */}
      {activeTab === 'subscriptions' && (
        <div className="space-y-4">
          {subscriptions.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg">No subscriptions yet</p>
              <p className="text-sm mt-1">Create a plan and share it with your customers</p>
            </div>
          ) : (
            subscriptions.map((sub) => (
              <div key={sub.id} className="border rounded-lg p-4 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{sub.subscription_plans?.name || 'Unknown Plan'}</h3>
                    <p className="text-sm text-gray-500">{sub.customer_email || 'No email'}</p>
                    <p className="text-sm text-gray-400 mt-1">
                      {sub.subscription_plans && formatAmount(sub.subscription_plans.amount, sub.subscription_plans.currency, sub.subscription_plans.interval)}
                      {' • '}Created {new Date(sub.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[sub.status] || 'bg-gray-100 text-gray-600'}`}>
                      {sub.status}
                    </span>
                    {sub.status === 'active' && (
                      <button
                        onClick={() => handleCancelSubscription(sub.id)}
                        className="text-sm text-red-600 hover:text-red-700"
                      >
                        Cancel
                      </button>
                    )}
                    <Link
                      href={`/subscriptions/${sub.id}`}
                      className="text-sm text-blue-600 hover:text-blue-700"
                    >
                      Details →
                    </Link>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Plans Tab */}
      {activeTab === 'plans' && (
        <div className="space-y-4">
          {plans.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg">No plans created yet</p>
              <button onClick={() => setShowCreatePlan(true)} className="text-blue-600 hover:text-blue-700 mt-2">
                Create your first plan →
              </button>
            </div>
          ) : (
            plans.map((plan) => (
              <div key={plan.id} className="border rounded-lg p-4 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{plan.name}</h3>
                    <p className="text-sm text-gray-500">
                      {formatAmount(plan.amount, plan.currency, plan.interval)}
                      {plan.trial_days ? ` • ${plan.trial_days}-day trial` : ''}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">Price ID: {plan.stripe_price_id}</p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${plan.active ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600'}`}>
                    {plan.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Create Plan Modal */}
      {showCreatePlan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Create Subscription Plan</h2>
            <form onSubmit={handleCreatePlan} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Business</label>
                <select
                  value={planBusinessId}
                  onChange={(e) => setPlanBusinessId(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600"
                  required
                >
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Plan Name</label>
                <input
                  type="text"
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  placeholder="e.g., Pro Monthly"
                  className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={planDescription}
                  onChange={(e) => setPlanDescription(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Amount (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.50"
                    value={planAmount}
                    onChange={(e) => setPlanAmount(e.target.value)}
                    placeholder="29.99"
                    className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Interval</label>
                  <select
                    value={planInterval}
                    onChange={(e) => setPlanInterval(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600"
                  >
                    <option value="day">Daily</option>
                    <option value="week">Weekly</option>
                    <option value="month">Monthly</option>
                    <option value="year">Yearly</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Trial Days (optional)</label>
                <input
                  type="number"
                  min="0"
                  value={planTrialDays}
                  onChange={(e) => setPlanTrialDays(e.target.value)}
                  placeholder="14"
                  className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600"
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowCreatePlan(false)}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
