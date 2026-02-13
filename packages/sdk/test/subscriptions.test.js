/**
 * Subscriptions Module Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSubscriptionPlan,
  listSubscriptionPlans,
  subscribeCustomer,
  cancelSubscription,
  listSubscriptions,
  getSubscription,
  formatSubscriptionAmount,
  PlanInterval,
  SubscriptionStatus,
} from '../src/subscriptions.js';

const mockClient = {
  request: vi.fn(),
};

describe('Subscriptions Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSubscriptionPlan', () => {
    it('should create a plan with correct params', async () => {
      const mockPlan = { id: 'plan_123', name: 'Pro Monthly', stripe_price_id: 'price_abc' };
      mockClient.request.mockResolvedValue({ success: true, plan: mockPlan });

      const result = await createSubscriptionPlan(mockClient, {
        businessId: 'biz-1',
        name: 'Pro Monthly',
        amount: 2999,
        interval: 'month',
      });

      expect(mockClient.request).toHaveBeenCalledWith('/stripe/subscriptions/plans', {
        method: 'POST',
        body: JSON.stringify({
          businessId: 'biz-1',
          name: 'Pro Monthly',
          description: undefined,
          amount: 2999,
          currency: 'usd',
          interval: 'month',
          intervalCount: 1,
          trialDays: undefined,
          metadata: {},
        }),
      });
      expect(result.plan).toEqual(mockPlan);
    });

    it('should include optional params', async () => {
      mockClient.request.mockResolvedValue({ success: true, plan: {} });

      await createSubscriptionPlan(mockClient, {
        businessId: 'biz-1',
        name: 'Enterprise',
        description: 'Full access',
        amount: 9999,
        currency: 'eur',
        interval: 'year',
        intervalCount: 1,
        trialDays: 30,
        metadata: { tier: 'enterprise' },
      });

      const body = JSON.parse(mockClient.request.mock.calls[0][1].body);
      expect(body.description).toBe('Full access');
      expect(body.currency).toBe('eur');
      expect(body.interval).toBe('year');
      expect(body.trialDays).toBe(30);
      expect(body.metadata.tier).toBe('enterprise');
    });

    it('should throw if required params missing', async () => {
      await expect(createSubscriptionPlan(mockClient, { businessId: 'biz', name: 'X' }))
        .rejects.toThrow('businessId, name, and amount are required');
    });

    it('should throw if businessId missing', async () => {
      await expect(createSubscriptionPlan(mockClient, { name: 'X', amount: 100 }))
        .rejects.toThrow('businessId, name, and amount are required');
    });
  });

  describe('listSubscriptionPlans', () => {
    it('should list plans for a business', async () => {
      mockClient.request.mockResolvedValue({ success: true, plans: [{ id: 'p1' }] });

      const result = await listSubscriptionPlans(mockClient, 'biz-1');

      expect(mockClient.request).toHaveBeenCalledWith(
        expect.stringContaining('/stripe/subscriptions/plans?')
      );
      expect(mockClient.request.mock.calls[0][0]).toContain('businessId=biz-1');
      expect(result.plans).toHaveLength(1);
    });

    it('should pass filter options', async () => {
      mockClient.request.mockResolvedValue({ success: true, plans: [] });

      await listSubscriptionPlans(mockClient, 'biz-1', { limit: 10, active: true });

      const url = mockClient.request.mock.calls[0][0];
      expect(url).toContain('limit=10');
      expect(url).toContain('active=true');
    });
  });

  describe('subscribeCustomer', () => {
    it('should create a subscription with email', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        subscription: { id: 'sub_1' },
        checkout_url: 'https://checkout.stripe.com/test',
      });

      const result = await subscribeCustomer(mockClient, {
        planId: 'price_abc',
        customerEmail: 'test@example.com',
        successUrl: 'https://example.com/success',
      });

      const body = JSON.parse(mockClient.request.mock.calls[0][1].body);
      expect(body.planId).toBe('price_abc');
      expect(body.customerEmail).toBe('test@example.com');
      expect(result.checkout_url).toBe('https://checkout.stripe.com/test');
    });

    it('should accept customerId instead of email', async () => {
      mockClient.request.mockResolvedValue({ success: true, subscription: {} });

      await subscribeCustomer(mockClient, {
        planId: 'price_abc',
        customerId: 'cus_123',
      });

      const body = JSON.parse(mockClient.request.mock.calls[0][1].body);
      expect(body.customerId).toBe('cus_123');
    });

    it('should throw if planId missing', async () => {
      await expect(subscribeCustomer(mockClient, { customerEmail: 'test@test.com' }))
        .rejects.toThrow('planId and either customerEmail or customerId are required');
    });

    it('should throw if no customer identifier', async () => {
      await expect(subscribeCustomer(mockClient, { planId: 'price_abc' }))
        .rejects.toThrow('planId and either customerEmail or customerId are required');
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel at period end by default', async () => {
      mockClient.request.mockResolvedValue({ success: true, message: 'Canceled' });

      await cancelSubscription(mockClient, 'sub_123');

      expect(mockClient.request).toHaveBeenCalledWith(
        '/stripe/subscriptions/sub_123',
        {
          method: 'DELETE',
          body: JSON.stringify({ immediately: false }),
        }
      );
    });

    it('should cancel immediately when specified', async () => {
      mockClient.request.mockResolvedValue({ success: true });

      await cancelSubscription(mockClient, 'sub_123', { immediately: true });

      const body = JSON.parse(mockClient.request.mock.calls[0][1].body);
      expect(body.immediately).toBe(true);
    });

    it('should throw if subscriptionId missing', async () => {
      await expect(cancelSubscription(mockClient, ''))
        .rejects.toThrow('subscriptionId is required');
    });
  });

  describe('listSubscriptions', () => {
    it('should list all subscriptions', async () => {
      mockClient.request.mockResolvedValue({ success: true, subscriptions: [] });

      await listSubscriptions(mockClient);

      expect(mockClient.request).toHaveBeenCalledWith(
        expect.stringContaining('/stripe/subscriptions')
      );
    });

    it('should pass filter options', async () => {
      mockClient.request.mockResolvedValue({ success: true, subscriptions: [] });

      await listSubscriptions(mockClient, {
        businessId: 'biz-1',
        status: 'active',
        limit: 5,
        offset: 10,
      });

      const url = mockClient.request.mock.calls[0][0];
      expect(url).toContain('businessId=biz-1');
      expect(url).toContain('status=active');
      expect(url).toContain('limit=5');
      expect(url).toContain('offset=10');
    });
  });

  describe('getSubscription', () => {
    it('should get subscription details', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        subscription: { id: 'sub_1', status: 'active' },
      });

      const result = await getSubscription(mockClient, 'sub_1');

      expect(mockClient.request).toHaveBeenCalledWith('/stripe/subscriptions/sub_1');
      expect(result.subscription.status).toBe('active');
    });

    it('should throw if id missing', async () => {
      await expect(getSubscription(mockClient, '')).rejects.toThrow('subscriptionId is required');
    });
  });

  describe('formatSubscriptionAmount', () => {
    it('should format USD amounts', () => {
      expect(formatSubscriptionAmount(2999, 'usd', 'month')).toBe('$29.99/month');
    });

    it('should format yearly amounts', () => {
      expect(formatSubscriptionAmount(9999, 'usd', 'year')).toBe('$99.99/year');
    });

    it('should handle non-USD currencies', () => {
      expect(formatSubscriptionAmount(5000, 'eur', 'month')).toBe('EUR 50.00/month');
    });

    it('should use default params', () => {
      expect(formatSubscriptionAmount(1000)).toBe('$10.00/month');
    });
  });

  describe('Constants', () => {
    it('should export PlanInterval', () => {
      expect(PlanInterval.MONTHLY).toBe('month');
      expect(PlanInterval.YEARLY).toBe('year');
      expect(PlanInterval.WEEKLY).toBe('week');
      expect(PlanInterval.DAILY).toBe('day');
    });

    it('should export SubscriptionStatus', () => {
      expect(SubscriptionStatus.ACTIVE).toBe('active');
      expect(SubscriptionStatus.CANCELED).toBe('canceled');
      expect(SubscriptionStatus.PAST_DUE).toBe('past_due');
      expect(SubscriptionStatus.TRIALING).toBe('trialing');
    });
  });
});
