import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getStripeClient, resetStripeClient } from './client';

vi.mock('stripe', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      accounts: {},
      paymentIntents: {},
    })),
  };
});

describe('Stripe Client', () => {
  beforeEach(() => {
    resetStripeClient();
    vi.unstubAllEnvs();
  });

  it('should throw if STRIPE_SECRET_KEY is not set', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    expect(() => getStripeClient()).toThrow('STRIPE_SECRET_KEY');
  });

  it('should return a Stripe instance when key is set', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123');
    const client = getStripeClient();
    expect(client).toBeDefined();
  });

  it('should return the same singleton instance', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123');
    const client1 = getStripeClient();
    const client2 = getStripeClient();
    expect(client1).toBe(client2);
  });

  it('should create a new instance after reset', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123');
    const client1 = getStripeClient();
    resetStripeClient();
    const client2 = getStripeClient();
    expect(client1).not.toBe(client2);
  });
});
