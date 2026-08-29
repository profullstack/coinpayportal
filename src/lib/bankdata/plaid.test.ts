import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { plaidProvider, resetPlaidClient } from './plaid';
import { BankDataError } from './types';

global.fetch = vi.fn();

/** Build a fetch Response double with the given JSON body. */
function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('Plaid adapter', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    resetPlaidClient();
    process.env = {
      ...originalEnv,
      PLAID_CLIENT_ID: 'test-client',
      PLAID_SECRET: 'test-secret',
      PLAID_ENV: 'sandbox',
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
    process.env = originalEnv;
    resetPlaidClient();
  });

  describe('configuration', () => {
    it('refuses to run without credentials rather than failing at request time', async () => {
      process.env = { ...originalEnv, PLAID_CLIENT_ID: '', PLAID_SECRET: '' };
      resetPlaidClient();

      await expect(plaidProvider.listAccounts('token')).rejects.toThrow(BankDataError);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects an unknown environment instead of guessing a host', async () => {
      process.env = { ...originalEnv, PLAID_CLIENT_ID: 'a', PLAID_SECRET: 'b', PLAID_ENV: 'staging' };
      resetPlaidClient();

      await expect(plaidProvider.listAccounts('token')).rejects.toThrow(/Unknown PLAID_ENV/);
    });

    it('sends credentials in the body and targets the configured environment', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ accounts: [] }));

      await plaidProvider.listAccounts('access-token');

      const [url, init] = vi.mocked(global.fetch).mock.calls[0];
      expect(url).toBe('https://sandbox.plaid.com/accounts/get');
      expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
        client_id: 'test-client',
        secret: 'test-secret',
        access_token: 'access-token',
      });
    });
  });

  describe('transaction mapping', () => {
    /**
     * The single most consequential line in the adapter: Plaid calls money leaving the
     * account positive, we call money arriving positive. Reconciliation only looks at
     * credits, so an unflipped sign matches nothing and reports every payout missing.
     */
    it('flips Plaid sign convention so a deposit is positive', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        jsonResponse({
          added: [
            {
              // Plaid: negative means money INTO the account.
              transaction_id: 'deposit',
              account_id: 'acct',
              amount: -1500,
              date: '2026-08-20',
              name: 'CoinPay payout',
            },
            {
              // Plaid: positive means money OUT of the account.
              transaction_id: 'card-purchase',
              account_id: 'acct',
              amount: 42.5,
              date: '2026-08-21',
              name: 'Office supplies',
            },
          ],
          modified: [],
          removed: [],
          next_cursor: 'cursor-1',
          has_more: false,
        }),
      );

      const result = await plaidProvider.syncTransactions('token', null);

      expect(result.added[0].amountMinor).toBe(150_000);
      expect(result.added[1].amountMinor).toBe(-4250);
    });

    it('rounds major units to exact minor units rather than truncating', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        jsonResponse({
          // 12.34 is not exactly representable; truncation would yield 1233.
          added: [{ transaction_id: 't', account_id: 'a', amount: -12.34, date: '2026-08-01', name: 'x' }],
          modified: [],
          removed: [],
          next_cursor: 'c',
          has_more: false,
        }),
      );

      const result = await plaidProvider.syncTransactions('token', null);
      expect(result.added[0].amountMinor).toBe(1234);
    });

    it('omits the cursor on a first sync so Plaid returns from the beginning', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        jsonResponse({ added: [], modified: [], removed: [], next_cursor: 'c', has_more: false }),
      );

      await plaidProvider.syncTransactions('token', null);

      const body = JSON.parse(
        (vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body).not.toHaveProperty('cursor');
    });

    it('reports removals and pagination state', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        jsonResponse({
          added: [],
          modified: [],
          removed: [{ transaction_id: 'gone' }],
          next_cursor: 'cursor-2',
          has_more: true,
        }),
      );

      const result = await plaidProvider.syncTransactions('token', 'cursor-1');

      expect(result.removedIds).toEqual(['gone']);
      expect(result.nextCursor).toBe('cursor-2');
      expect(result.hasMore).toBe(true);
    });
  });

  describe('account mapping', () => {
    it('normalises balances, currency and unknown account types', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        jsonResponse({
          accounts: [
            {
              account_id: 'acct-1',
              name: 'Business Checking',
              mask: '4321',
              type: 'depository',
              subtype: 'checking',
              balances: { current: 1234.56, available: 1000, iso_currency_code: 'usd' },
            },
            {
              account_id: 'acct-2',
              name: 'Mystery',
              type: 'brokerage-ish',
              balances: {},
            },
          ],
        }),
      );

      const accounts = await plaidProvider.listAccounts('token');

      expect(accounts[0]).toMatchObject({
        providerAccountId: 'acct-1',
        currentBalanceMinor: 123_456,
        availableBalanceMinor: 100_000,
        currency: 'USD',
        type: 'depository',
      });
      expect(accounts[1].type).toBe('other');
      expect(accounts[1].currentBalanceMinor).toBeNull();
    });
  });

  describe('error handling', () => {
    it('marks expired credentials as requiring re-authentication', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        jsonResponse(
          { error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'the login details have changed' },
          false,
          400,
        ),
      );

      await expect(plaidProvider.listAccounts('token')).rejects.toMatchObject({
        requiresReauth: true,
        providerCode: 'ITEM_LOGIN_REQUIRED',
      });
    });

    it('does not ask for a re-link on an error the merchant cannot fix', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        jsonResponse({ error_code: 'INTERNAL_SERVER_ERROR' }, false, 500),
      );

      await expect(plaidProvider.listAccounts('token')).rejects.toMatchObject({
        requiresReauth: false,
      });
    });

    it('surfaces network failures as BankDataError', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(plaidProvider.listAccounts('token')).rejects.toThrow(BankDataError);
    });
  });

  describe('exchangePublicToken', () => {
    it('keeps the connection when institution lookup fails', async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(jsonResponse({ access_token: 'access-1', item_id: 'item-1' }))
        .mockResolvedValueOnce(jsonResponse({ error_code: 'INTERNAL_SERVER_ERROR' }, false, 500));

      const result = await plaidProvider.exchangePublicToken('public-1');

      expect(result.accessToken).toBe('access-1');
      expect(result.providerItemId).toBe('item-1');
      expect(result.institutionName).toBeNull();
    });

    it('resolves the institution name when available', async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(jsonResponse({ access_token: 'access-1', item_id: 'item-1' }))
        .mockResolvedValueOnce(jsonResponse({ item: { institution_id: 'ins_1' } }))
        .mockResolvedValueOnce(jsonResponse({ institution: { name: 'Chase' } }));

      const result = await plaidProvider.exchangePublicToken('public-1');

      expect(result.institutionId).toBe('ins_1');
      expect(result.institutionName).toBe('Chase');
    });
  });
});
