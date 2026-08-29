import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  fetchPlaidAccountSet,
  exchangePublicToken,
  createLinkToken,
  isPlaidConfigured,
  resetPlaidConfig,
  PlaidError,
} from './plaid';

global.fetch = vi.fn();

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

/** One `/transactions/get` page. */
function page(
  transactions: unknown[],
  accounts: unknown[] = [{ account_id: 'acct-1', name: 'Checking', type: 'depository', balances: {} }],
  total = transactions.length,
) {
  return jsonResponse({ accounts, transactions, total_transactions: total });
}

describe('finances Plaid provider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    resetPlaidConfig();
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
    resetPlaidConfig();
  });

  describe('configuration', () => {
    it('reports itself unconfigured without credentials', () => {
      process.env = { ...originalEnv, PLAID_CLIENT_ID: '', PLAID_SECRET: '' };
      expect(isPlaidConfigured()).toBe(false);
    });

    it('refuses to call out when credentials are missing', async () => {
      process.env = { ...originalEnv, PLAID_CLIENT_ID: '', PLAID_SECRET: '' };
      resetPlaidConfig();

      await expect(fetchPlaidAccountSet('token')).rejects.toThrow(PlaidError);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects an unknown environment rather than guessing a host', async () => {
      process.env = { ...originalEnv, PLAID_CLIENT_ID: 'a', PLAID_SECRET: 'b', PLAID_ENV: 'staging' };
      resetPlaidConfig();

      await expect(fetchPlaidAccountSet('token')).rejects.toThrow(/Unknown PLAID_ENV/);
    });
  });

  describe('amount sign', () => {
    /**
     * The line the whole adapter turns on. Plaid calls money LEAVING the account
     * positive; summary.ts sums `amount >= 0` as money in. Unflipped, every
     * deposit reads as spending and the totals still look plausible.
     */
    it('flips Plaid sign so a deposit is positive and a purchase negative', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        page([
          { transaction_id: 'dep', account_id: 'acct-1', amount: -1500, date: '2026-08-20', name: 'Payout' },
          { transaction_id: 'buy', account_id: 'acct-1', amount: 42.5, date: '2026-08-21', name: 'Supplies' },
        ]),
      );

      const set = await fetchPlaidAccountSet('token');
      const [deposit, purchase] = set.accounts[0].transactions ?? [];

      expect(deposit.amount).toBe('1500.00');
      expect(purchase.amount).toBe('-42.50');
    });

    it('emits decimal strings, never float noise', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        page([{ transaction_id: 't', account_id: 'acct-1', amount: -0.1 - 0.2, date: '2026-08-01', name: 'x' }]),
      );

      const set = await fetchPlaidAccountSet('token');
      // 0.1 + 0.2 is 0.30000000000000004; the stored value must not be.
      expect(set.accounts[0].transactions?.[0].amount).toBe('0.30');
    });

    it('never writes a negative zero', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        page([{ transaction_id: 't', account_id: 'acct-1', amount: 0, date: '2026-08-01', name: 'x' }]),
      );

      const set = await fetchPlaidAccountSet('token');
      expect(set.accounts[0].transactions?.[0].amount).toBe('0.00');
    });
  });

  describe('balances', () => {
    /**
     * The other inverted convention: this codebase stores a liability's balance
     * negative and negates it back for display, while Plaid states a card as a
     * positive amount owed. Unflipped, $500 owing reads as $500 of assets and
     * net worth moves by twice the balance.
     */
    it('stores a credit-card balance as negative', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        page([], [
          {
            account_id: 'card-1',
            name: 'Business Card',
            type: 'credit',
            balances: { current: 500, available: 4500, iso_currency_code: 'usd' },
          },
        ]),
      );

      const set = await fetchPlaidAccountSet('token');

      expect(set.accounts[0].balance).toBe('-500.00');
      expect(set.accounts[0].currency).toBe('USD');
    });

    it('leaves a depository balance positive', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        page([], [
          {
            account_id: 'acct-1',
            name: 'Checking',
            type: 'depository',
            balances: { current: 1234.56, iso_currency_code: 'USD' },
          },
        ]),
      );

      const set = await fetchPlaidAccountSet('token');
      expect(set.accounts[0].balance).toBe('1234.56');
    });

    it('labels the org from the stored connection label', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(page([]));

      const set = await fetchPlaidAccountSet('token', { orgName: 'Chase' });
      expect(set.accounts[0].org?.name).toBe('Chase');
    });
  });

  describe('shape compatibility with the sync loop', () => {
    it('states times in unix seconds, as SimpleFIN does', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        page([
          {
            transaction_id: 't',
            account_id: 'acct-1',
            amount: -10,
            date: '2026-08-20',
            authorized_date: '2026-08-19',
            name: 'x',
          },
        ]),
      );

      const set = await fetchPlaidAccountSet('token');
      const tx = set.accounts[0].transactions?.[0];

      expect(tx?.posted).toBe(Date.parse('2026-08-20T00:00:00Z') / 1000);
      expect(tx?.transacted_at).toBe(Date.parse('2026-08-19T00:00:00Z') / 1000);
    });

    it('groups transactions under their own account', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        page(
          [
            { transaction_id: 'a', account_id: 'acct-1', amount: -1, date: '2026-08-20', name: 'a' },
            { transaction_id: 'b', account_id: 'acct-2', amount: -2, date: '2026-08-20', name: 'b' },
          ],
          [
            { account_id: 'acct-1', name: 'One', type: 'depository', balances: {} },
            { account_id: 'acct-2', name: 'Two', type: 'depository', balances: {} },
          ],
        ),
      );

      const set = await fetchPlaidAccountSet('token');

      expect(set.accounts[0].transactions?.map((t) => t.id)).toEqual(['a']);
      expect(set.accounts[1].transactions?.map((t) => t.id)).toEqual(['b']);
    });

    /**
     * Plaid gives a charge a NEW transaction_id when it posts, pointing back at
     * the pending row via pending_transaction_id. Transactions upsert on that
     * id, so without carrying it forward the pending row is never removed and a
     * single card charge is stored — and summed — twice.
     */
    it('names the pending row a posted transaction replaces', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        page([
          {
            transaction_id: 'posted-1',
            account_id: 'acct-1',
            amount: 25,
            date: '2026-08-21',
            name: 'Coffee',
            pending: false,
            pending_transaction_id: 'pending-1',
          },
        ]),
      );

      const set = await fetchPlaidAccountSet('token');
      expect(set.accounts[0].transactions?.[0].supersedes).toBe('pending-1');
    });

    it('leaves supersedes unset on a transaction that replaces nothing', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        page([
          {
            transaction_id: 'plain-1',
            account_id: 'acct-1',
            amount: 25,
            date: '2026-08-21',
            name: 'Coffee',
            pending_transaction_id: null,
          },
        ]),
      );

      const set = await fetchPlaidAccountSet('token');
      expect(set.accounts[0].transactions?.[0].supersedes).toBeUndefined();
    });

    it('carries the merchant name through as payee for categorisation', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        page([
          {
            transaction_id: 't',
            account_id: 'acct-1',
            amount: 12,
            date: '2026-08-20',
            name: 'SQ *COFFEE',
            merchant_name: 'Blue Bottle',
          },
        ]),
      );

      const set = await fetchPlaidAccountSet('token');
      expect(set.accounts[0].transactions?.[0].payee).toBe('Blue Bottle');
    });

    it('requests only the window it was given', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(page([]));

      await fetchPlaidAccountSet('token', { startDate: new Date('2026-07-01T00:00:00Z') });

      const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.start_date).toBe('2026-07-01');
    });
  });

  describe('pagination', () => {
    it('pages until every transaction is collected', async () => {
      const first = Array.from({ length: 500 }, (_, i) => ({
        transaction_id: `a${i}`,
        account_id: 'acct-1',
        amount: -1,
        date: '2026-08-20',
        name: 'x',
      }));

      vi.mocked(global.fetch)
        .mockResolvedValueOnce(page(first, undefined, 501))
        .mockResolvedValueOnce(
          page(
            [{ transaction_id: 'last', account_id: 'acct-1', amount: -1, date: '2026-08-20', name: 'x' }],
            undefined,
            501,
          ),
        );

      const set = await fetchPlaidAccountSet('token');

      expect(set.accounts[0].transactions).toHaveLength(501);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('stops on an empty page even if the reported total disagrees', async () => {
      // Guards against spinning to the page cap when `total_transactions` lies.
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(page([], undefined, 9999))
        .mockResolvedValue(page([], undefined, 9999));

      await fetchPlaidAccountSet('token');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('errors', () => {
    it('marks an expired login as needing a fresh link', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        jsonResponse({ error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'login details changed' }, false, 400),
      );

      await expect(fetchPlaidAccountSet('token')).rejects.toMatchObject({
        code: 'ITEM_LOGIN_REQUIRED',
        requiresRelink: true,
      });
    });

    it('does not ask for a re-link on a fault the merchant cannot fix', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        jsonResponse({ error_code: 'INTERNAL_SERVER_ERROR' }, false, 500),
      );

      await expect(fetchPlaidAccountSet('token')).rejects.toMatchObject({ requiresRelink: false });
    });
  });

  describe('link and exchange', () => {
    it('asks for transactions in the US and identifies the user by merchant id', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        jsonResponse({ link_token: 'link-1', expiration: '2026-08-29T10:00:00Z' }),
      );

      await createLinkToken({ clientUserId: 'merchant-1' });

      const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body).toMatchObject({
        products: ['transactions'],
        country_codes: ['US'],
        user: { client_user_id: 'merchant-1' },
      });
    });

    it('keeps a completed link when the institution lookup fails', async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(jsonResponse({ access_token: 'access-1', item_id: 'item-1' }))
        .mockResolvedValueOnce(jsonResponse({ error_code: 'INTERNAL_SERVER_ERROR' }, false, 500));

      const result = await exchangePublicToken('public-1');

      expect(result.accessToken).toBe('access-1');
      expect(result.institutionName).toBeNull();
    });

    it('resolves the institution name for the connection label', async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(jsonResponse({ access_token: 'access-1', item_id: 'item-1' }))
        .mockResolvedValueOnce(jsonResponse({ item: { institution_id: 'ins_1' } }))
        .mockResolvedValueOnce(jsonResponse({ institution: { name: 'Chase' } }));

      const result = await exchangePublicToken('public-1');
      expect(result.institutionName).toBe('Chase');
    });
  });
});
