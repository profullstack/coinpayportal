import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  withTransactionLimit,
  withFeatureAccess,
  EntitlementError,
  type EntitlementErrorCode,
} from './middleware';

// Mock Supabase client
const mockSupabase = {
  from: vi.fn(),
  rpc: vi.fn(),
};

// Mock Next.js request/response
const createMockRequest = () => ({
  headers: new Headers(),
  json: vi.fn(),
});

describe('Entitlements Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('EntitlementError', () => {
    it('should create error with correct properties', () => {
      const error = new EntitlementError(
        'TRANSACTION_LIMIT_EXCEEDED',
        'Monthly limit reached',
        { currentUsage: 100, limit: 100 }
      );

      expect(error.code).toBe('TRANSACTION_LIMIT_EXCEEDED');
      expect(error.message).toBe('Monthly limit reached');
      expect(error.details).toEqual({ currentUsage: 100, limit: 100 });
      expect(error.name).toBe('EntitlementError');
    });

    it('should be instanceof Error', () => {
      const error = new EntitlementError('FEATURE_NOT_AVAILABLE', 'Feature not available');
      expect(error instanceof Error).toBe(true);
    });
  });

  describe('withTransactionLimit', () => {
    it('should allow transaction when under limit', async () => {
      // Mock subscription check
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

      // Mock usage check
      mockSupabase.rpc.mockResolvedValue({ data: 50, error: null });

      const result = await withTransactionLimit(mockSupabase as any, 'merchant-123');

      expect(result.allowed).toBe(true);
      expect(result.currentUsage).toBe(50);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(50);
    });

    it('should deny transaction when at limit', async () => {
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

      const result = await withTransactionLimit(mockSupabase as any, 'merchant-123');

      expect(result.allowed).toBe(false);
      expect(result.currentUsage).toBe(100);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(0);
    });

    it('should allow unlimited transactions for professional plan', async () => {
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

      mockSupabase.rpc.mockResolvedValue({ data: 1000, error: null });

      const result = await withTransactionLimit(mockSupabase as any, 'merchant-123');

      expect(result.allowed).toBe(true);
      expect(result.currentUsage).toBe(1000);
      expect(result.limit).toBeNull();
      expect(result.remaining).toBeNull();
    });

    it('should throw EntitlementError when subscription is inactive', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'merchant-123',
                subscription_plan_id: 'starter',
                subscription_status: 'cancelled',
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

      mockSupabase.rpc.mockResolvedValue({ data: 50, error: null });

      const result = await withTransactionLimit(mockSupabase as any, 'merchant-123');

      expect(result.allowed).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('SUBSCRIPTION_INACTIVE');
    });
  });

  describe('withFeatureAccess', () => {
    it('should allow access to enabled feature', async () => {
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

      const result = await withFeatureAccess(
        mockSupabase as any,
        'merchant-123',
        'advanced_analytics'
      );

      expect(result.allowed).toBe(true);
      expect(result.feature).toBe('advanced_analytics');
    });

    it('should deny access to disabled feature', async () => {
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

      const result = await withFeatureAccess(
        mockSupabase as any,
        'merchant-123',
        'advanced_analytics'
      );

      expect(result.allowed).toBe(false);
      expect(result.feature).toBe('advanced_analytics');
      expect(result.error?.code).toBe('FEATURE_NOT_AVAILABLE');
    });

    it('should allow access to basic features for all plans', async () => {
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
                  basic_api_access: true,
                  all_chains_supported: true,
                  is_active: true,
                },
              },
              error: null,
            }),
          }),
        }),
      });

      const result = await withFeatureAccess(
        mockSupabase as any,
        'merchant-123',
        'basic_api_access'
      );

      expect(result.allowed).toBe(true);
      expect(result.feature).toBe('basic_api_access');
    });

    it('should deny access when subscription is inactive', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'merchant-123',
                subscription_plan_id: 'professional',
                subscription_status: 'past_due',
                subscription_started_at: '2025-01-01T00:00:00Z',
                subscription_plans: {
                  id: 'professional',
                  name: 'Professional',
                  advanced_analytics: true,
                  is_active: true,
                },
              },
              error: null,
            }),
          }),
        }),
      });

      const result = await withFeatureAccess(
        mockSupabase as any,
        'merchant-123',
        'advanced_analytics'
      );

      expect(result.allowed).toBe(false);
      expect(result.error?.code).toBe('SUBSCRIPTION_INACTIVE');
    });
  });
});