'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Plan {
  id: string;
  name: string;
  description: string;
  pricing: {
    monthly: number;
    yearly: number | null;
  };
  limits: {
    monthly_transactions: number | null;
    is_unlimited: boolean;
  };
  features: {
    all_chains_supported: boolean;
    basic_api_access: boolean;
    advanced_analytics: boolean;
    custom_webhooks: boolean;
    white_label: boolean;
    priority_support: boolean;
  };
}

interface Entitlements {
  plan: {
    id: string;
    name: string;
  };
  usage: {
    transactions_this_month: number;
    transaction_limit: number | null;
    transactions_remaining: number | null;
    is_unlimited: boolean;
  };
  status: string;
}

export default function PricingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    fetchPlans();
    checkAuth();
  }, []);

  const fetchPlans = async () => {
    try {
      const response = await fetch('/api/subscription-plans');
      const data = await response.json();
      if (data.success) {
        setPlans(data.plans);
      }
    } catch (err) {
      console.error('Failed to fetch plans:', err);
    }
  };

  const checkAuth = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      setIsAuthenticated(false);
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/entitlements', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (data.success) {
        setEntitlements(data.entitlements);
        setIsAuthenticated(true);
      }
    } catch (err) {
      console.error('Failed to fetch entitlements:', err);
    }
    setLoading(false);
  };

  const [selectedBlockchain, setSelectedBlockchain] = useState<string>('ETH');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentDetails, setPaymentDetails] = useState<any>(null);

  const handleUpgrade = async (planId: string) => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/pricing');
      return;
    }

    if (planId === 'starter') {
      // Can't downgrade to starter from UI - contact support
      return;
    }

    setUpgrading(true);
    
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/subscriptions/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          plan_id: planId,
          billing_period: billingPeriod,
          blockchain: selectedBlockchain,
        }),
      });

      const data = await response.json();
      
      if (data.success && data.payment) {
        // Show payment modal with crypto address
        setPaymentDetails(data);
        setShowPaymentModal(true);
        setUpgrading(false);
      } else {
        alert(data.error || 'Unable to start checkout. Please try again.');
        setUpgrading(false);
      }
    } catch (err) {
      console.error('Checkout error:', err);
      alert('Unable to start checkout. Please try again.');
      setUpgrading(false);
    }
  };

  const getFeatureList = (plan: Plan) => {
    const features = [];
    const isProfessional = plan.id === 'professional';

    // Platform fee - highlight the 50% savings on Professional
    if (isProfessional) {
      features.push({ name: '0.5% platform fee (50% less!)', included: true });
    } else {
      features.push({ name: '1% platform fee', included: true });
    }

    if (plan.limits.is_unlimited) {
      features.push({ name: 'Unlimited transactions', included: true });
    } else {
      features.push({ name: `Up to ${plan.limits.monthly_transactions} transactions/month`, included: true });
    }

    features.push({ name: 'All supported blockchains', included: plan.features.all_chains_supported });
    features.push({ name: 'Basic API access', included: plan.features.basic_api_access });
    features.push({ name: 'Advanced analytics', included: plan.features.advanced_analytics });
    features.push({ name: 'Custom webhooks', included: plan.features.custom_webhooks });
    features.push({ name: 'White-label option', included: plan.features.white_label });
    features.push({ name: 'Priority support', included: plan.features.priority_support });

    return features;
  };

  const getCurrentPlanId = () => entitlements?.plan?.id || null;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading plans...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl">
            Simple, Transparent Pricing
          </h1>
          <p className="mt-4 text-xl text-gray-600 max-w-2xl mx-auto">
            Choose the plan that's right for your business. Start free and upgrade as you grow.
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Platform fees: <span className="font-semibold">1% on Starter</span>, <span className="font-semibold text-green-600">0.5% on Professional</span> (50% savings!). Blockchain network fees are additional.
          </p>
        </div>

        {/* Current Plan Banner (for authenticated users) */}
        {isAuthenticated && entitlements && (
          <div className="mb-8 bg-purple-50 border border-purple-200 rounded-lg p-4 max-w-2xl mx-auto">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-purple-600 font-medium">Current Plan</p>
                <p className="text-lg font-semibold text-purple-900">{entitlements.plan.name}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-purple-600">This Month's Usage</p>
                <p className="text-lg font-semibold text-purple-900">
                  {entitlements.usage.transactions_this_month}
                  {entitlements.usage.is_unlimited ? '' : ` / ${entitlements.usage.transaction_limit}`}
                  {' '}transactions
                </p>
              </div>
            </div>
            {!entitlements.usage.is_unlimited && entitlements.usage.transactions_remaining !== null && (
              <div className="mt-3">
                <div className="w-full bg-purple-200 rounded-full h-2">
                  <div 
                    className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                    style={{ 
                      width: `${Math.min(100, (entitlements.usage.transactions_this_month / (entitlements.usage.transaction_limit || 1)) * 100)}%` 
                    }}
                  ></div>
                </div>
                <p className="text-xs text-purple-600 mt-1">
                  {entitlements.usage.transactions_remaining} transactions remaining this month
                </p>
              </div>
            )}
          </div>
        )}

        {/* Billing Period Toggle */}
        <div className="flex justify-center mb-8">
          <div className="bg-gray-100 p-1 rounded-lg inline-flex">
            <button
              onClick={() => setBillingPeriod('monthly')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                billingPeriod === 'monthly'
                  ? 'bg-white text-gray-900 shadow'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingPeriod('yearly')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                billingPeriod === 'yearly'
                  ? 'bg-white text-gray-900 shadow'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Yearly
              <span className="ml-1 text-green-600 text-xs font-semibold">Save 17%</span>
            </button>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {plans.map((plan) => {
            const isCurrentPlan = getCurrentPlanId() === plan.id;
            const isProfessional = plan.id === 'professional';
            const price = billingPeriod === 'yearly' && plan.pricing.yearly 
              ? plan.pricing.yearly / 12 
              : plan.pricing.monthly;
            
            return (
              <div
                key={plan.id}
                className={`relative bg-white rounded-2xl shadow-lg overflow-hidden ${
                  isProfessional ? 'ring-2 ring-purple-600' : 'border border-gray-200'
                }`}
              >
                {/* Popular Badge */}
                {isProfessional && (
                  <div className="absolute top-0 right-0 bg-purple-600 text-white text-xs font-semibold px-3 py-1 rounded-bl-lg">
                    MOST POPULAR
                  </div>
                )}

                <div className="p-8">
                  {/* Plan Name */}
                  <h3 className="text-2xl font-bold text-gray-900">{plan.name}</h3>
                  <p className="mt-2 text-gray-600">{plan.description}</p>

                  {/* Price */}
                  <div className="mt-6">
                    <div className="flex items-baseline">
                      <span className="text-4xl font-extrabold text-gray-900">
                        ${price.toFixed(0)}
                      </span>
                      <span className="ml-1 text-gray-500">/month</span>
                    </div>
                    {billingPeriod === 'yearly' && plan.pricing.yearly && (
                      <p className="text-sm text-gray-500 mt-1">
                        Billed annually (${plan.pricing.yearly}/year)
                      </p>
                    )}
                    {plan.pricing.monthly === 0 && (
                      <p className="text-sm text-green-600 font-medium mt-1">
                        Free forever
                      </p>
                    )}
                  </div>

                  {/* CTA Button */}
                  <div className="mt-8">
                    {isCurrentPlan ? (
                      <button
                        disabled
                        className="w-full py-3 px-4 rounded-lg font-semibold bg-gray-100 text-gray-500 cursor-not-allowed"
                      >
                        Current Plan
                      </button>
                    ) : isProfessional ? (
                      <button
                        onClick={() => handleUpgrade(plan.id)}
                        disabled={upgrading}
                        className="w-full py-3 px-4 rounded-lg font-semibold bg-purple-600 text-white hover:bg-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {upgrading ? 'Processing...' : 'Upgrade to Professional'}
                      </button>
                    ) : isAuthenticated ? (
                      <button
                        disabled
                        className="w-full py-3 px-4 rounded-lg font-semibold bg-gray-100 text-gray-500 cursor-not-allowed"
                      >
                        Contact Support to Downgrade
                      </button>
                    ) : (
                      <Link
                        href="/signup"
                        className="block w-full py-3 px-4 rounded-lg font-semibold text-center bg-gray-900 text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
                      >
                        Get Started Free
                      </Link>
                    )}
                  </div>

                  {/* Features List */}
                  <div className="mt-8">
                    <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                      What's included
                    </h4>
                    <ul className="mt-4 space-y-3">
                      {getFeatureList(plan).map((feature, index) => (
                        <li key={index} className="flex items-start">
                          {feature.included ? (
                            <svg
                              className="h-5 w-5 text-green-500 flex-shrink-0"
                              fill="none"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path d="M5 13l4 4L19 7"></path>
                            </svg>
                          ) : (
                            <svg
                              className="h-5 w-5 text-gray-300 flex-shrink-0"
                              fill="none"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                          )}
                          <span className={`ml-3 text-sm ${feature.included ? 'text-gray-700' : 'text-gray-400'}`}>
                            {feature.name}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* FAQ Section */}
        <div className="mt-16 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">
            Frequently Asked Questions
          </h2>
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900">
                What happens when I reach my transaction limit?
              </h3>
              <p className="mt-2 text-gray-600">
                On the Starter plan, you can process up to 100 transactions per month. 
                When you reach this limit, you'll need to upgrade to Professional for 
                unlimited transactions. We'll notify you when you're approaching your limit.
              </p>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900">
                Can I cancel my subscription anytime?
              </h3>
              <p className="mt-2 text-gray-600">
                Yes! You can cancel your Professional subscription at any time. 
                You'll continue to have access to Professional features until the 
                end of your billing period.
              </p>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900">
                What payment methods do you accept?
              </h3>
              <p className="mt-2 text-gray-600">
                We accept all major credit cards (Visa, Mastercard, American Express) 
                through our secure payment processor, Stripe. We also support 
                cryptocurrency payments for annual subscriptions.
              </p>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900">
                Do you offer refunds?
              </h3>
              <p className="mt-2 text-gray-600">
                We offer a 14-day money-back guarantee for new Professional subscriptions.
                If you're not satisfied, contact our support team within 14 days of
                your upgrade for a full refund.
              </p>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900">
                What about blockchain network fees?
              </h3>
              <p className="mt-2 text-gray-600">
                Blockchain network fees (also called "gas fees" on Ethereum or "transaction fees" on other networks)
                are charged by the blockchain network itself, not by CoinPay. These fees vary based on network
                congestion and are deducted from the payment amount when funds are forwarded to your wallet.
                Network fees are typically very small (fractions of a cent to a few dollars depending on the blockchain).
              </p>
              <ul className="mt-3 text-sm text-gray-500 space-y-1">
                <li>• <strong>Solana:</strong> ~$0.00025 per transaction</li>
                <li>• <strong>Polygon:</strong> ~$0.001-0.01 per transaction</li>
                <li>• <strong>Ethereum:</strong> ~$0.50-5.00 per transaction (varies with congestion)</li>
                <li>• <strong>Bitcoin:</strong> ~$0.50-3.00 per transaction (varies with congestion)</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Contact Section */}
        <div className="mt-16 text-center">
          <p className="text-gray-600">
            Need a custom plan for your enterprise?{' '}
            <Link href="/contact" className="text-purple-600 font-semibold hover:text-purple-500">
              Contact our sales team
            </Link>
          </p>
        </div>
      </div>

      {/* Crypto Payment Modal */}
      {showPaymentModal && paymentDetails && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">Complete Your Payment</h3>
              <button
                onClick={() => setShowPaymentModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="bg-purple-50 rounded-lg p-4 mb-4">
              <p className="text-sm text-purple-600 font-medium">Upgrading to</p>
              <p className="text-lg font-bold text-purple-900">
                {paymentDetails.plan.name} - {paymentDetails.plan.billing_period === 'yearly' ? 'Annual' : 'Monthly'}
              </p>
              <p className="text-2xl font-extrabold text-purple-900 mt-1">
                ${paymentDetails.plan.price}
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Cryptocurrency
              </label>
              <select
                value={selectedBlockchain}
                onChange={(e) => setSelectedBlockchain(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              >
                <option value="BTC">Bitcoin (BTC)</option>
                <option value="ETH">Ethereum (ETH)</option>
                <option value="POL">Polygon (POL)</option>
                <option value="SOL">Solana (SOL)</option>
                <option value="BCH">Bitcoin Cash (BCH)</option>
              </select>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <p className="text-sm text-gray-600 mb-2">Send payment to:</p>
              <div className="bg-white border border-gray-200 rounded-lg p-3">
                <code className="text-sm break-all text-gray-900">
                  {paymentDetails.payment.payment_address}
                </code>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(paymentDetails.payment.payment_address);
                  alert('Address copied to clipboard!');
                }}
                className="mt-2 text-sm text-purple-600 hover:text-purple-500 font-medium"
              >
                Copy Address
              </button>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-yellow-800">
                <strong>Important:</strong> Send exactly ${paymentDetails.plan.price} worth of {selectedBlockchain}.
                Your subscription will be activated once the payment is confirmed on the blockchain (usually within 10-30 minutes).
              </p>
            </div>

            <div className="text-sm text-gray-500 mb-4">
              <p>Payment expires: {new Date(paymentDetails.payment.expires_at).toLocaleString()}</p>
              <p>Payment ID: {paymentDetails.payment.id}</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowPaymentModal(false)}
                className="flex-1 py-2 px-4 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  // Refresh to check payment status
                  window.location.href = `/settings/subscription?payment_id=${paymentDetails.payment.id}`;
                }}
                className="flex-1 py-2 px-4 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-500"
              >
                I've Sent Payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}