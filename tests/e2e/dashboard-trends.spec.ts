import { expect, test, type Page } from '@playwright/test';

const trendSeries = {
  volume_usd: [0, 150, 0, 225, 100, 0, 350, 0, 400, 125, 0, 500, 250, 600],
  transactions: [0, 2, 0, 3, 1, 0, 4, 0, 5, 2, 0, 6, 3, 7],
  successful_transactions: [0, 1, 0, 2, 1, 0, 3, 0, 4, 1, 0, 5, 2, 6],
  failed_transactions: [0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1, 1],
  failure_rate: [0, 50, 0, 33.3, 0, 0, 25, 0, 20, 50, 0, 16.7, 33.3, 14.3],
  fees_usd: [0, 1.5, 0, 2.25, 1, 0, 3.5, 0, 4, 1.25, 0, 5, 2.5, 6],
};

async function seedDashboardRoutes(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'e2e-token');

    class MockEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      CONNECTING = 0;
      OPEN = 1;
      CLOSED = 2;
      readyState = MockEventSource.OPEN;
      url: string;
      withCredentials = false;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string) {
        super();
        this.url = url;
        setTimeout(() => this.onopen?.(new Event('open')), 0);
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    window.EventSource = MockEventSource as unknown as typeof EventSource;
  });

  await page.route('**/api/stripe/analytics**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        analytics: {
          combined: {
            total_volume_usd: '5000.00',
            total_transactions: 100,
            successful_transactions: 85,
            failed_transactions: 12,
            failure_rate: 12.0,
            total_fees_usd: '25.00',
          },
          crypto: {
            total_volume_usd: '3000.00',
            total_transactions: 60,
            successful_transactions: 50,
            failed_transactions: 8,
            failure_rate: 13.3,
            total_fees_usd: '15.00',
          },
          card: {
            total_volume_usd: '2000.00',
            total_transactions: 40,
            successful_transactions: 35,
            failed_transactions: 4,
            failure_rate: 10.0,
            total_fees_usd: '10.00',
          },
          trends: {
            labels: [
              '2026-05-24',
              '2026-05-25',
              '2026-05-26',
              '2026-05-27',
              '2026-05-28',
              '2026-05-29',
              '2026-05-30',
              '2026-05-31',
              '2026-06-01',
              '2026-06-02',
              '2026-06-03',
              '2026-06-04',
              '2026-06-05',
              '2026-06-06',
            ],
            all: trendSeries,
            crypto: {
              volume_usd: [0, 100, 0, 125, 100, 0, 200, 0, 250, 75, 0, 300, 100, 350],
              transactions: [0, 1, 0, 2, 1, 0, 2, 0, 3, 1, 0, 3, 1, 4],
              successful_transactions: [0, 1, 0, 1, 1, 0, 2, 0, 2, 1, 0, 3, 1, 3],
              failed_transactions: [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              failure_rate: [0, 0, 0, 50, 0, 0, 0, 0, 33.3, 0, 0, 0, 0, 25],
              fees_usd: [0, 1, 0, 1.25, 1, 0, 2, 0, 2.5, 0.75, 0, 3, 1, 3.5],
            },
            card: {
              volume_usd: [0, 50, 0, 100, 0, 0, 150, 0, 150, 50, 0, 200, 150, 250],
              transactions: [0, 1, 0, 1, 0, 0, 2, 0, 2, 1, 0, 3, 2, 3],
              successful_transactions: [0, 0, 0, 1, 0, 0, 1, 0, 2, 0, 0, 2, 1, 3],
              failed_transactions: [0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0],
              failure_rate: [0, 100, 0, 0, 0, 0, 50, 0, 0, 100, 0, 33.3, 50, 0],
              fees_usd: [0, 0.5, 0, 1, 0, 0, 1.5, 0, 1.5, 0.5, 0, 2, 1.5, 2.5],
            },
          },
        },
      }),
    });
  });

  await page.route('https://crawlproof.com/**', async (route) => {
    await route.fulfill({ status: 204 });
  });

  await page.route('**/api/dashboard/stats**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        businesses: [{ id: 'business-1', name: 'E2E Business' }],
        plan: {
          id: 'starter',
          commission_rate: 0.01,
          commission_percent: '1.0%',
        },
      }),
    });
  });

  await page.route('**/api/payments**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        payments: [
          {
            id: 'payment-e2e-1',
            amount_crypto: '0.05000000',
            amount_usd: '100.00',
            currency: 'eth',
            status: 'completed',
            created_at: '2026-06-06T12:00:00.000Z',
            payment_address: '0x1234567890abcdef1234567890abcdef12345678',
          },
        ],
      }),
    });
  });

  await page.route('**/api/stripe/transactions**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        transactions: [
          {
            id: 'card-e2e-1',
            business_id: 'business-1',
            business_name: 'E2E Business',
            amount_usd: '150.00',
            currency: 'usd',
            status: 'completed',
            stripe_payment_intent_id: 'pi_e2e_1',
            stripe_charge_id: 'ch_e2e_1',
            last4: '4242',
            brand: 'visa',
            created_at: '2026-06-06T12:05:00.000Z',
            updated_at: '2026-06-06T12:05:00.000Z',
          },
        ],
      }),
    });
  });
}

test('dashboard renders compact 14-day trend rows in the browser', async ({ page }) => {
  await seedDashboardRoutes(page);

  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Total Volume')).toBeVisible();
  await expect(page.getByText('$5,000.00')).toBeVisible();

  await expect(page.getByLabel('All last 14 days trend').first()).toBeVisible();
  await expect(page.getByLabel('Crypto last 14 days trend').first()).toBeVisible();
  await expect(page.getByLabel('Cards last 14 days trend').first()).toBeVisible();
  await expect(page.getByText('Last 14d').first()).toBeVisible();

  await expect(page.getByText('Crypto Volume')).toBeVisible();
  await expect(page.getByLabel('Payments last 14 days trend')).toBeVisible();
  await expect(page.getByLabel('Success last 14 days trend').first()).toBeVisible();
  await expect(page.getByLabel('Fees last 14 days trend').first()).toBeVisible();
  await expect(page.getByText('12.0%')).toBeVisible();
  await expect(page.getByLabel('Failure rate last 14 days red bar chart')).toBeVisible();
});
