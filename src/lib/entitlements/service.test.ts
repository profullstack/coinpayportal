import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSubscriptionPlan,
  getMerchantSubscription,
  getCurrentMonthUsage,
  canCreateTransaction,
  incrementTransactionCount,
  hasFeature,
  checkTransactionLimit,
  getEntitlements,
  PLAN_FEATURES,
  type SubscriptionPlan,
  type MerchantSubscription,
} from './service';

// Mock Supabase client
const mockSupabase = {
  from: vi.fn(),
  rpc: vi.fn(),
};

describe('Entitlements Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('PLAN_FEATURES constant', () => {
    it('should define starter plan features correctly', () => {
      expect(PLAN_FEATURES.starter).toBeDefined();
      expect(PLAN_FEATURES.starter.monthlyTransactionLimit).toBe(100);
      expect(PLAN_FEATURES.starter.advancedAnalytics).toBe(false);
      expect(PLAN_FEATURES.starter.customWebhooks).toBe(false);
      expect(PLAN_FEATURES.starter.whiteLabel).toBe(false);
      expect(PLAN_FEATURES.starter.prioritySupport).toBe(false);
    });

    it('should define professional plan features correctly', () => {
      expect(PLAN_FEATURES.professional).toBeDefined();
      expect(PLAN_FEATURES.professional.monthlyTransactionLimit).toBeNull();
      expect(PLAN_FEATURES.professional.advancedAnalytics).toBe(true);
      expect(PLAN_FEATURES.professional.customWebhooks).toBe(true);
      expect(PLAN_FEATURES.professional.whiteLabel).toBe(true);
      expect(PLAN_FEATURES.professional.prioritySupport).toBe(true);
    });
  });

  describe('getSubscriptionPlan', () => {
    it('should return subscription plan details', async () => {
      const mockPlan: SubscriptionPlan = {
        id: 'starter',
        name: 'Starter',
        description: 'Perfect for testing and small projects',
        price_monthly: 0,
        monthly_transaction_limit: 100,
        all_chains_supported: true,
        basic_api_access: true,
        advanced_analytics: false,
        custom_webhooks: false,
        white_label: false,
        priority_support: false,
        is_active: true,
      };

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockPlan, error: null }),
          }),
        }),
      });

      const result = await getSubscriptionPlan(mockSupabase as any, 'starter');

      expect(result.success).toBe(true);
      expect(result.plan).toEqual(mockPlan);
    });

    it('should return error for non-existent plan', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
          }),
        }),
      });

      const result = await getSubscriptionPlan(mockSupabase as any, 'nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getMerchantSubscription', () => {
    it('should return merchant subscription details', async () => {
      const mockSubscription: MerchantSubscription = {
        merchantId: 'merchant-123',
        planId: 'starter',
        status: 'active',
        startedAt: '2025-01-01T00:00:00Z',
        plan: {
          id: 'starter',
          name: 'Starter',
          description: 'Perfect for testing',
          price_monthly: 0,
          monthly_transaction_limit: 100,
          all_chains_supported: true,
          basic_api_access: true,
          advanced_analytics: false,
          custom_webhooks: false,
          white_label: false,
          priority_support: false,
          is_active: true,
        },
      };

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'merchant-123',
                subscription_plan_id: 'starter',
                subscription_status: 'active',
                subscription_started_at: '2025-01-01T00:00:00Z',
                subscription_plans: {
                  id: 'starter',
                  name: 'Starter',
                  description: 'Perfect for testing',
                  price_monthly: 0,
                  monthly_transaction_limit: 100,
                  all_chains_supported: true,
                  basic_api_access: true,
                  advanced_analytics: false,
                  custom_webhooks: false,
                  white_label: false,
                  priority_support: false,
                  is_active: true,
                },
              },
              error: null,
            }),
          }),
        }),
      });

      const result = await getMerchantSubscription(mockSupabase as any, 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.subscription?.merchantId).toBe('merchant-123');
      expect(result.subscription?.planId).toBe('starter');
      expect(result.subscription?.status).toBe('active');
    });

    it('should return error for non-existent merchant', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
          }),
        }),
      });

      const result = await getMerchantSubscription(mockSupabase as any, 'nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getCurrentMonthUsage', () => {
    it('should return current month transaction count', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: 50, error: null });

      const result = await getCurrentMonthUsage(mockSupabase as any, 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.count).toBe(50);
    });

    it('should return 0 for new merchants with no usage', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: 0, error: null });

      const result = await getCurrentMonthUsage(mockSupabase as any, 'new-merchant');

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
    });

    it('should handle database errors', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'Database error' } });

      const result = await getCurrentMonthUsage(mockSupabase as any, 'merchant-123');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('canCreateTransaction', () => {
    it('should return true for professional plan (unlimited)', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: true, error: null });

      const result = await canCreateTransaction(mockSupabase as any, 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.allowed).toBe(true);
    });

    it('should return true for starter plan under limit', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: true, error: null });

      const result = await canCreateTransaction(mockSupabase as any, 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.allowed).toBe(true);
    });

    it('should return false for starter plan at limit', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: false, error: null });

      const result = await canCreateTransaction(mockSupabase as any, 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.allowed).toBe(false);
    });

    it('should handle database errors', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'Database error' } });

      const result = await canCreateTransaction(mockSupabase as any, 'merchant-123');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('incrementTransactionCount', () => {
    it('should increment and return new count', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: 51, error: null });

      const result = await incrementTransactionCount(mockSupabase as any, 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.newCount).toBe(51);
    });

    it('should handle database errors', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'Database error' } });

      const result = await incrementTransactionCount(mockSupabase as any, 'merchant-123');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('hasFeature', () => {
    it('should return true for enabled feature', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: true, error: null });

      const result = await hasFeature(mockSupabase as any, 'merchant-123', 'basic_api_access');

      expect(result.success).toBe(true);
      expect(result.hasFeature).toBe(true);
    });

    it('should return false for disabled feature', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: false, error: null });

      const result = await hasFeature(mockSupabase as any, 'merchant-123', 'advanced_analytics');

      expect(result.success).toBe(true);
      expect(result.hasFeature).toBe(false);
    });

    it('should handle database errors', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'Database error' } });

      const result = await hasFeature(mockSupabase as any, 'merchant-123', 'advanced_analytics');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('checkTransactionLimit', () => {
    it('should return allowed=true and remaining count for starter under limit', async () => {
      // Mock getMerchantSubscription
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'merchant-123',
                subscription_plan_id: 'starter',
                subscription_status: 'active',
                subscription_started_at: '2025-01-01T00:00:00Z',
                subscription_plans: {
                  id: 'starter',
                  name: 'Starter',
                  monthly_transaction_limit: 100,
                  is_active: true,
                },
              },
              error: null,
            }),
          }),
        }),
      });

      // Mock getCurrentMonthUsage
      mockSupabase.rpc.mockResolvedValue({ data: 50, error: null });

      const result = await checkTransactionLimit(mockSupabase as any, 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.allowed).toBe(true);
      expect(result.currentUsage).toBe(50);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(50);
    });

    it('should return allowed=false when at limit', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'merchant-123',
                subscription_plan_id: 'starter',
                subscription_status: 'active',
                subscription_started_at: '2025-01-01T00:00:00Z',
                subscription_plans: {
                  id: 'starter',
                  name: 'Starter',
                  monthly_transaction_limit: 100,
                  is_active: true,
                },
              },
              error: null,
            }),
          }),
        }),
      });

      mockSupabase.rpc.mockResolvedValue({ data: 100, error: null });

      const result = await checkTransactionLimit(mockSupabase as any, 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.allowed).toBe(false);
      expect(result.currentUsage).toBe(100);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(0);
    });

    it('should return unlimited for professional plan', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'merchant-123',
                subscription_plan_id: 'professional',
                subscription_status: 'active',
                subscription_started_at: '2025-01-01T00:00:00Z',
                subscription_plans: {
                  id: 'professional',
                  name: 'Professional',
                  monthly_transaction_limit: null,
                  is_active: true,
                },
              },
              error: null,
            }),
          }),
        }),
      });

      mockSupabase.rpc.mockResolvedValue({ data: 500, error: null });

      const result = await checkTransactionLimit(mockSupabase as any, 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.allowed).toBe(true);
      expect(result.currentUsage).toBe(500);
      expect(result.limit).toBeNull();
      expect(result.remaining).toBeNull();
    });
  });

  describe('getEntitlements', () => {
    it('should return all entitlements for starter plan', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'merchant-123',
                subscription_plan_id: 'starter',
                subscription_status: 'active',
                subscription_started_at: '2025-01-01T00:00:00Z',
                subscription_plans: {
                  id: 'starter',
                  name: 'Starter',
                  description: 'Perfect for testing',
                  price_monthly: 0,
                  monthly_transaction_limit: 100,
                  all_chains_supported: true,
                  basic_api_access: true,
                  advanced_analytics: false,
                  custom_webhooks: false,
                  white_label: false,
                  priority_support: false,
                  is_active: true,
                },
              },
              error: null,
            }),
          }),
        }),
      });

      mockSupabase.rpc.mockResolvedValue({ data: 25, error: null });

      const result = await getEntitlements(mockSupabase as any, 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.entitlements?.plan.id).toBe('starter');
      expect(result.entitlements?.features.advancedAnalytics).toBe(false);
      expect(result.entitlements?.features.customWebhooks).toBe(false);
      expect(result.entitlements?.features.whiteLabel).toBe(false);
      expect(result.entitlements?.features.prioritySupport).toBe(false);
      expect(result.entitlements?.usage.currentMonth).toBe(25);
      expect(result.entitlements?.usage.limit).toBe(100);
      expect(result.entitlements?.usage.remaining).toBe(75);
    });

    it('should return all entitlements for professional plan', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'merchant-123',
                subscription_plan_id: 'professional',
                subscription_status: 'active',
                subscription_started_at: '2025-01-01T00:00:00Z',
                subscription_plans: {
                  id: 'professional',
                  name: 'Professional',
                  description: 'For growing businesses',
                  price_monthly: 49,
                  monthly_transaction_limit: null,
                  all_chains_supported: true,
                  basic_api_access: true,
                  advanced_analytics: true,
                  custom_webhooks: true,
                  white_label: true,
                  priority_support: true,
                  is_active: true,
                },
              },
              error: null,
            }),
          }),
        }),
      });

      mockSupabase.rpc.mockResolvedValue({ data: 500, error: null });

      const result = await getEntitlements(mockSupabase as any, 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.entitlements?.plan.id).toBe('professional');
      expect(result.entitlements?.features.advancedAnalytics).toBe(true);
      expect(result.entitlements?.features.customWebhooks).toBe(true);
      expect(result.entitlements?.features.whiteLabel).toBe(true);
      expect(result.entitlements?.features.prioritySupport).toBe(true);
      expect(result.entitlements?.usage.currentMonth).toBe(500);
      expect(result.entitlements?.usage.limit).toBeNull();
      expect(result.entitlements?.usage.remaining).toBeNull();
    });
  });
});