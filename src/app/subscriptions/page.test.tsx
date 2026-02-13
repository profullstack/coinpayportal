/**
 * Subscriptions Page Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock auth
vi.mock('@/lib/auth/client', () => ({
  authFetch: vi.fn().mockResolvedValue({ data: { success: true, plans: [], subscriptions: [] } }),
  getAuthToken: vi.fn().mockReturnValue('test-token'),
}));

describe('Subscriptions Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export a default component', async () => {
    const mod = await import('./page');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
