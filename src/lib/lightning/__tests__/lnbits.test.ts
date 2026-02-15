import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  createUserWallet,
  getWallet,
  getBalance,
  createInvoice,
  payInvoice,
  checkPayment,
  listPayments,
  createPayLink,
  getPayLink,
  listPayLinks,
  deletePayLink,
} from '../lnbits';

beforeEach(() => {
  mockFetch.mockReset();
});

function mockJsonResponse(data: unknown, status = 200) {
  return mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

describe('LNbits API Client', () => {
  describe('Wallet Management', () => {
    it('creates a user wallet', async () => {
      mockJsonResponse({ id: 'w1', name: 'alice', adminkey: 'ak1', inkey: 'ik1', balance: 0 });

      const wallet = await createUserWallet('alice');
      expect(wallet.id).toBe('w1');
      expect(wallet.adminkey).toBe('ak1');
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/wallet');
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    });

    it('gets wallet details', async () => {
      mockJsonResponse({ name: 'alice', balance: 50000, id: 'w1' });

      const wallet = await getWallet('ak1');
      expect(wallet.name).toBe('alice');
      expect(wallet.balance).toBe(50000);
    });

    it('gets balance in sats', async () => {
      mockJsonResponse({ name: 'alice', balance: 500000, id: 'w1' }); // 500 sats in msat

      const balance = await getBalance('ak1');
      expect(balance).toBe(500);
    });
  });

  describe('Invoices', () => {
    it('creates a BOLT11 invoice', async () => {
      mockJsonResponse({
        payment_hash: 'hash123',
        payment_request: 'lnbc1...',
        checking_id: 'check123',
        lnurl_response: null,
      });

      const invoice = await createInvoice('ak1', 1000, 'test payment');
      expect(invoice.payment_hash).toBe('hash123');
      expect(invoice.payment_request).toBe('lnbc1...');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.out).toBe(false);
      expect(callBody.amount).toBe(1000);
      expect(callBody.memo).toBe('test payment');
    });

    it('pays a BOLT11 invoice', async () => {
      mockJsonResponse({
        payment_hash: 'hash456',
        pending: false,
        amount: -1000,
        fee: 1,
        memo: '',
        time: 1234567890,
        bolt11: 'lnbc1...',
        preimage: 'pre123',
        extra: {},
      });

      const payment = await payInvoice('ak1', 'lnbc1...');
      expect(payment.payment_hash).toBe('hash456');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.out).toBe(true);
      expect(callBody.bolt11).toBe('lnbc1...');
    });

    it('checks payment status', async () => {
      mockJsonResponse({ paid: true });

      const status = await checkPayment('ak1', 'hash123');
      expect(status.paid).toBe(true);
    });

    it('lists payments', async () => {
      mockJsonResponse([
        { payment_hash: 'h1', pending: false, amount: 1000, fee: 0, memo: 'test', time: 123, bolt11: '', preimage: '', extra: {} },
      ]);

      const payments = await listPayments('ak1', 10);
      expect(payments).toHaveLength(1);
      expect(payments[0].payment_hash).toBe('h1');
    });
  });

  describe('Pay Links (Lightning Address)', () => {
    it('creates a pay link', async () => {
      mockJsonResponse({
        id: 1,
        wallet: 'w1',
        description: 'test',
        min: 1,
        max: 1000000,
        served_meta: 0,
        served_pr: 0,
        username: 'alice',
        domain: null,
        lnurl: 'lnurl1...',
      });

      const link = await createPayLink('ak1', {
        description: 'test',
        min: 1,
        max: 1000000,
        username: 'alice',
      });
      expect(link.id).toBe(1);
      expect(link.username).toBe('alice');
      expect(mockFetch.mock.calls[0][0]).toContain('/lnurlp/api/v1/links');
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    });

    it('gets a pay link by ID', async () => {
      mockJsonResponse({ id: 1, username: 'alice' });

      const link = await getPayLink('ak1', 1);
      expect(link.id).toBe(1);
    });

    it('lists pay links', async () => {
      mockJsonResponse([{ id: 1 }, { id: 2 }]);

      const links = await listPayLinks('ak1');
      expect(links).toHaveLength(2);
    });

    it('deletes a pay link', async () => {
      mockJsonResponse({});

      await deletePayLink('ak1', 1);
      expect(mockFetch.mock.calls[0][0]).toContain('/lnurlp/api/v1/links/1');
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });
  });

  describe('Error Handling', () => {
    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: 'Unauthorized' }),
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(getWallet('bad-key')).rejects.toThrow('LNbits API error 401');
    });
  });
});
