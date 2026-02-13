import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createExpressAccount, generateOnboardingLink, getAccountStatus, handleAccountUpdated } from './accounts';

const mockAccountsCreate = vi.fn();
const mockAccountLinksCreate = vi.fn();
const mockAccountsRetrieve = vi.fn();

vi.mock('./client', () => ({
  getStripeClient: () => ({
    accounts: { create: mockAccountsCreate, retrieve: mockAccountsRetrieve },
    accountLinks: { create: mockAccountLinksCreate },
  }),
}));

describe('Accounts', () => {
  beforeEach(() => {
    mockAccountsCreate.mockReset();
    mockAccountLinksCreate.mockReset();
    mockAccountsRetrieve.mockReset();
  });

  describe('createExpressAccount', () => {
    it('should create an Express account', async () => {
      mockAccountsCreate.mockResolvedValue({ id: 'acct_test' });

      const result = await createExpressAccount({
        merchantId: 'merch_1',
        email: 'test@test.com',
      });

      expect(mockAccountsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'express',
          email: 'test@test.com',
          country: 'US',
        })
      );
      expect(result.id).toBe('acct_test');
    });
  });

  describe('generateOnboardingLink', () => {
    it('should generate onboarding link', async () => {
      mockAccountLinksCreate.mockResolvedValue({ url: 'https://connect.stripe.com/setup' });

      const result = await generateOnboardingLink({
        stripeAccountId: 'acct_test',
        refreshUrl: 'http://localhost/refresh',
        returnUrl: 'http://localhost/return',
      });

      expect(result.url).toBe('https://connect.stripe.com/setup');
    });
  });

  describe('getAccountStatus', () => {
    it('should retrieve account', async () => {
      mockAccountsRetrieve.mockResolvedValue({ id: 'acct_test', charges_enabled: true });

      const result = await getAccountStatus('acct_test');
      expect(result.charges_enabled).toBe(true);
    });
  });

  describe('handleAccountUpdated', () => {
    it('should extract update fields from account', () => {
      const updates = handleAccountUpdated({
        charges_enabled: true,
        payouts_enabled: false,
        details_submitted: true,
        country: 'US',
        email: 'test@test.com',
      } as any);

      expect(updates.charges_enabled).toBe(true);
      expect(updates.payouts_enabled).toBe(false);
      expect(updates.details_submitted).toBe(true);
      expect(updates.country).toBe('US');
    });
  });
});
