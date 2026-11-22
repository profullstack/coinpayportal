/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PricingPage from './page';
import { authFetch } from '@/lib/auth/client';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/lib/auth/client', () => ({
  authFetch: vi.fn(),
}));

const plansResponse = {
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
};

describe('PricingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => plansResponse,
    } as Response);

    vi.mocked(authFetch).mockImplementation(async (url) => {
      if (url === '/api/entitlements') {
        return {
          response: { ok: true } as Response,
          data: {
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
          },
        };
      }

      throw new Error(`Unexpected authFetch URL: ${url}`);
    });
  });

  it('links the upgrade button to the upgrade page with the chosen billing period', async () => {
    render(<PricingPage />);

    const upgrade = await screen.findByRole('link', { name: /upgrade to professional/i });
    expect(upgrade).toHaveAttribute('href', '/upgrade?plan=monthly&source=pricing');

    fireEvent.click(screen.getByRole('button', { name: /yearly/i }));
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /upgrade to professional/i })).toHaveAttribute(
        'href',
        '/upgrade?plan=yearly&source=pricing'
      );
    });

    // The page no longer opens the checkout itself: /upgrade does.
    expect(authFetch).not.toHaveBeenCalledWith('/api/subscriptions/checkout', expect.anything(), expect.anything());
    expect(mockPush).not.toHaveBeenCalled();
  });
});
