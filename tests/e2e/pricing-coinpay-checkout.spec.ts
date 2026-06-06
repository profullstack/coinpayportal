import { expect, test, type Page } from '@playwright/test';

async function seedPricingRoutes(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'e2e-token');
  });

  await page.route('**/api/subscription-plans', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        plans: [
          {
            id: 'starter',
            name: 'Starter',
            description: 'Start free',
            pricing: { monthly: 0, yearly: null },
            limits: { monthly_transactions: 100, is_unlimited: false },
            features: {
              all_chains_supported: true,
              basic_api_access: true,
              advanced_analytics: false,
              custom_webhooks: false,
              white_label: false,
              priority_support: false,
            },
          },
          {
            id: 'professional',
            name: 'Professional',
            description: 'For growing teams',
            pricing: { monthly: 49, yearly: 490 },
            limits: { monthly_transactions: null, is_unlimited: true },
            features: {
              all_chains_supported: true,
              basic_api_access: true,
              advanced_analytics: true,
              custom_webhooks: true,
              white_label: true,
              priority_support: true,
            },
          },
        ],
      }),
    });
  });

  await page.route('**/api/entitlements', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        entitlements: {
          plan: { id: 'starter', name: 'Starter' },
          usage: {
            transactions_this_month: 12,
            transaction_limit: 100,
            transactions_remaining: 88,
            is_unlimited: false,
          },
          status: 'active',
        },
      }),
    });
  });

  await page.route('**/api/subscriptions/checkout', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        payment: {
          id: 'pay_upgrade_e2e',
          checkout_path: '/pay/pay_upgrade_e2e',
          checkout_url: 'https://coinpayportal.com/pay/pay_upgrade_e2e',
        },
      }),
    });
  });

  await page.route('**/api/payments/pay_upgrade_e2e', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        payment: {
          id: 'pay_upgrade_e2e',
          business_id: 'business-e2e',
          payment_address: '0x1234567890abcdef1234567890abcdef12345678',
          amount: '49.00',
          crypto_amount: '0.01230000',
          blockchain: 'ETH',
          status: 'pending',
          description: 'Professional Plan - Monthly Subscription',
          created_at: '2026-06-06T12:00:00.000Z',
          expires_at: '2026-06-06T12:15:00.000Z',
          metadata: {},
        },
      }),
    });
  });

  await page.route('**/api/businesses/business-e2e', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        business: { id: 'business-e2e', name: 'CoinPay' },
      }),
    });
  });

  await page.route('**/api/payments/pay_upgrade_e2e/check-balance', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'pending' }),
    });
  });
}

test('pricing upgrade opens hosted CoinPay checkout instead of payment modal', async ({ page }) => {
  await seedPricingRoutes(page);

  await page.goto('/pricing');
  await page.getByRole('button', { name: 'Upgrade to Professional' }).click();

  await expect(page).toHaveURL(/\/pay\/pay_upgrade_e2e$/);
  await expect(page.getByText('Complete Your Payment')).toHaveCount(0);
  await expect(page.getByText('Awaiting Payment')).toBeVisible();
});
