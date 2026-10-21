import { DocSection } from './DocSection';
import { ApiEndpoint } from './ApiEndpoint';
import { CodeBlock } from './CodeBlock';
import Link from 'next/link';

export function SubscriptionsDocs() {
  return (
    <DocSection title="Subscriptions & Entitlements">
      <p className="text-gray-300 mb-6">
        CoinPay Portal offers two subscription tiers with different features and transaction limits.
        All subscription payments are processed using cryptocurrency.
      </p>

      <div className="mb-8 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
        <p className="text-purple-300 text-sm">
          <strong>Tip:</strong> View our{' '}
          <Link href="/pricing" className="text-purple-400 hover:text-purple-300 underline">
            pricing page
          </Link>{' '}
          for a visual comparison of plans and to upgrade your subscription.
        </p>
      </div>

      {/* Subscription Plans */}
      <h3 className="text-xl font-semibold text-white mb-4">Subscription Plans</h3>
      <div className="grid md:grid-cols-2 gap-4 mb-8">
        <div className="p-4 rounded-lg bg-slate-800/50 border border-white/10">
          <div className="font-semibold text-white mb-2">Starter (Free)</div>
          <ul className="text-gray-300 text-sm space-y-1">
            <li>• Up to 100 transactions/month</li>
            <li>• All supported chains</li>
            <li>• Basic API access</li>
            <li>• Email support</li>
          </ul>
        </div>
        <div className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/20">
          <div className="font-semibold text-purple-400 mb-2">Professional ($49/month)</div>
          <ul className="text-gray-300 text-sm space-y-1">
            <li>• Unlimited transactions</li>
            <li>• Priority support</li>
            <li>• Advanced analytics</li>
            <li>• Custom webhooks</li>
          </ul>
        </div>
      </div>

      {/* Get Subscription Plans */}
      <ApiEndpoint method="GET" path="/api/subscription-plans" description="Get available subscription plans (public endpoint).">
        <CodeBlock title="Response">
{`{
  "success": true,
  "plans": [
    {
      "id": "starter",
      "name": "Starter",
      "description": "Perfect for testing and small projects",
      "pricing": { "monthly": 0, "yearly": 0 },
      "limits": { "monthly_transactions": 100, "is_unlimited": false },
      "features": {
        "all_chains_supported": true,
        "basic_api_access": true,
        "advanced_analytics": false,
        "custom_webhooks": false,
        "white_label": false,
        "priority_support": false
      }
    },
    {
      "id": "professional",
      "name": "Professional",
      "pricing": { "monthly": 49, "yearly": 490 },
      "limits": { "monthly_transactions": null, "is_unlimited": true },
      "features": { ... }
    }
  ]
}`}
        </CodeBlock>
      </ApiEndpoint>

      {/* Get Entitlements */}
      <ApiEndpoint method="GET" path="/api/entitlements" description="Get current merchant's entitlements, features, and usage.">
        <CodeBlock title="cURL Example" language="curl">
{`curl https://coinpayportal.com/api/entitlements \\
  -H "Authorization: Bearer YOUR_TOKEN"`}
        </CodeBlock>

        <CodeBlock title="Response">
{`{
  "success": true,
  "entitlements": {
    "plan": {
      "id": "starter",
      "name": "Starter",
      "description": "Perfect for testing and small projects",
      "price_monthly": 0
    },
    "features": {
      "all_chains_supported": true,
      "basic_api_access": true,
      "advanced_analytics": false,
      "custom_webhooks": false,
      "white_label": false,
      "priority_support": false
    },
    "usage": {
      "transactions_this_month": 45,
      "transaction_limit": 100,
      "transactions_remaining": 55,
      "is_unlimited": false
    },
    "status": "active"
  }
}`}
        </CodeBlock>
      </ApiEndpoint>

      {/* Create Subscription Checkout */}
      <ApiEndpoint method="POST" path="/api/subscriptions/checkout" description="Start a plan upgrade: returns a hosted checkout where you pay with any supported coin or PayPal.">
        <CodeBlock title="Request Body">
{`{
  "plan_id": "professional",
  "billing_period": "monthly"  // or "yearly"
}`}
        </CodeBlock>

        <CodeBlock title="cURL Example" language="curl">
{`curl -X POST https://coinpayportal.com/api/subscriptions/checkout \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "plan_id": "professional",
    "billing_period": "monthly"
  }'`}
        </CodeBlock>

        <CodeBlock title="Response">
{`{
  "success": true,
  "session": {
    "id": "cs_Ju1h16BXSobdRs7XWg9MUIj0",
    "url": "https://coinpayportal.com/checkout/cs_Ju1h16BXSobdRs7XWg9MUIj0",
    "expires_at": "2024-01-15T12:00:00Z",
    "methods": ["USDC_POL", "USDC_SOL", "USDC_BASE", "BTC", "ETH", "SOL", "PAYPAL"]
  },
  "payment": {
    "id": "cs_Ju1h16BXSobdRs7XWg9MUIj0",
    "checkout_path": "/checkout/cs_Ju1h16BXSobdRs7XWg9MUIj0",
    "checkout_url": "https://coinpayportal.com/checkout/cs_Ju1h16BXSobdRs7XWg9MUIj0",
    "amount": 49,
    "currency": "USD",
    "expires_at": "2024-01-15T12:00:00Z"
  },
  "plan": {
    "id": "professional",
    "name": "Professional",
    "billing_period": "monthly",
    "price": 49
  },
  "instructions": "Open the checkout and pay $49 with any listed coin or PayPal..."
}`}
        </CodeBlock>
      </ApiEndpoint>

      {/* Get Subscription Status */}
      <ApiEndpoint method="GET" path="/api/subscriptions/status" description="Get current subscription status.">
        <CodeBlock title="Response">
{`{
  "success": true,
  "subscription": {
    "planId": "professional",
    "status": "active",
    "startedAt": "2024-01-01T00:00:00Z",
    "endsAt": "2024-02-01T00:00:00Z",
    "isActive": true,
    "daysRemaining": 15
  }
}`}
        </CodeBlock>
      </ApiEndpoint>

      {/* Cancel Subscription */}
      <ApiEndpoint method="DELETE" path="/api/subscriptions/status" description="Cancel subscription (access continues until end of billing period).">
        <CodeBlock title="Response">
{`{
  "success": true,
  "message": "Subscription cancelled. You will retain access until the end of your billing period.",
  "subscription": {
    "planId": "professional",
    "status": "cancelled",
    "endsAt": "2024-02-01T00:00:00Z",
    "isActive": true,
    "daysRemaining": 15
  }
}`}
        </CodeBlock>
      </ApiEndpoint>

      {/* Entitlement Errors */}
      <h3 className="text-xl font-semibold text-white mb-4 mt-8">Entitlement Error Codes</h3>
      <div className="space-y-4">
        {[
          { code: '429', name: 'Transaction Limit Exceeded', description: 'Monthly transaction limit reached. Upgrade to Professional for unlimited.' },
          { code: '403', name: 'Feature Not Available', description: 'Feature not available on current plan. Upgrade required.' },
          { code: '402', name: 'Subscription Inactive', description: 'Subscription is past_due or cancelled. Payment required.' },
        ].map((error) => (
          <div key={error.code} className="p-4 rounded-lg bg-slate-800/50 flex items-start gap-4">
            <span className="px-3 py-1 bg-red-500/20 text-red-400 rounded-lg font-mono text-sm font-semibold">
              {error.code}
            </span>
            <div>
              <div className="font-semibold text-white mb-1">{error.name}</div>
              <div className="text-gray-300 text-sm">{error.description}</div>
            </div>
          </div>
        ))}
      </div>
    </DocSection>
  );
}