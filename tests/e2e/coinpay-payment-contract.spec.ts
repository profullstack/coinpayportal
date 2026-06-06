import { expect, test, type Page } from '@playwright/test';

const businessId = 'business-coinpay-contract';
const merchantWalletAddress = '0x1111111111111111111111111111111111111111';
const coinpayMiddlemanAddress = '0x2222222222222222222222222222222222222222';
const paymentId = 'payment-coinpay-contract';

async function seedCoinPayCreateRoutes(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'e2e-token');
  });

  await page.route('**/api/fees', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        fees: [{ blockchain: 'usdc_pol', fee_usd: 0.01 }],
      }),
    });
  });

  await page.route('**/api/businesses', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        businesses: [{ id: businessId, name: 'CoinPay Contract Business' }],
      }),
    });
  });

  await page.route(`**/api/businesses/${businessId}/wallets`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        wallets: [
          {
            id: 'wallet-usdc-pol',
            cryptocurrency: 'USDC_POL',
            wallet_address: merchantWalletAddress,
            is_active: true,
          },
        ],
      }),
    });
  });

  await page.route(`**/api/payments/${paymentId}/check-balance`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'pending' }),
    });
  });

  await page.route(`**/api/payments/${paymentId}/qr`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" />',
    });
  });
}

test('CoinPay create payment uses a middleman payment address, not the merchant wallet', async ({ page }) => {
  await seedCoinPayCreateRoutes(page);

  let createRequestBody: Record<string, unknown> | undefined;
  await page.route('**/api/payments/create', async (route) => {
    createRequestBody = route.request().postDataJSON();

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        payment: {
          id: paymentId,
          business_id: businessId,
          payment_address: coinpayMiddlemanAddress,
          merchant_wallet_address: merchantWalletAddress,
          amount_usd: '100.00',
          amount_crypto: '100.01000000',
          currency: 'usdc_pol',
          blockchain: 'USDC_POL',
          status: 'pending',
          description: 'Contract checkout',
          metadata: {
            commission_rate: 0.01,
            commission_amount_usd: 1,
            merchant_receives_usd: 99,
          },
          expires_at: '2026-06-06T12:15:00.000Z',
          created_at: '2026-06-06T12:00:00.000Z',
        },
      }),
    });
  });

  await page.goto('/payments/create');

  await expect(page.getByRole('heading', { name: 'Create Payment' })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Amount (USD) *').fill('100');
  await expect(page.getByLabel('Cryptocurrency *')).toHaveValue('usdc_pol');
  await page.getByLabel('Description').fill('Contract checkout');

  await page.getByRole('button', { name: 'Create Payment' }).click();

  await expect(page.getByRole('heading', { name: 'Payment Created Successfully!' })).toBeVisible();
  await expect(page.getByText(coinpayMiddlemanAddress)).toBeVisible();
  await expect(page.getByText(merchantWalletAddress)).toHaveCount(0);

  expect(createRequestBody).toEqual({
    business_id: businessId,
    amount_usd: 100,
    currency: 'usdc_pol',
    description: 'Contract checkout',
  });
  expect(createRequestBody).not.toHaveProperty('payment_address');
  expect(createRequestBody).not.toHaveProperty('merchant_wallet_address');
});
