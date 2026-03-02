/**
 * Lightning SDK Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CoinPayClient } from '../src/client.js';

describe('LightningClient (via CoinPayClient)', () => {
  let client;

  beforeEach(() => {
    client = new CoinPayClient({
      apiKey: 'cp_live_test_key_123456789',
      baseUrl: 'https://test.coinpayportal.com/api',
    });

    // Mock the underlying request method
    client.request = vi.fn().mockResolvedValue({ success: true, data: {} });
  });

  describe('lightning property', () => {
    it('should be available on the client', () => {
      expect(client.lightning).toBeDefined();
    });
  });

  // ── Wallet Provisioning ──

  describe('enableWallet', () => {
    it('should POST to /lightning/nodes', async () => {
      await client.lightning.enableWallet({
        wallet_id: 'w-1',
        mnemonic: 'test words',
        business_id: 'b-1',
      });

      expect(client.request).toHaveBeenCalledWith('/lightning/nodes', {
        method: 'POST',
        body: JSON.stringify({
          wallet_id: 'w-1',
          mnemonic: 'test words',
          business_id: 'b-1',
        }),
      });
    });
  });

  describe('provisionNode (deprecated)', () => {
    it('should delegate to enableWallet', async () => {
      await client.lightning.provisionNode({
        wallet_id: 'w-1',
        mnemonic: 'test words',
      });

      expect(client.request).toHaveBeenCalledWith('/lightning/nodes', {
        method: 'POST',
        body: expect.stringContaining('w-1'),
      });
    });
  });

  describe('getNode', () => {
    it('should GET /lightning/nodes/:id', async () => {
      await client.lightning.getNode('node-1');
      expect(client.request).toHaveBeenCalledWith('/lightning/nodes/node-1');
    });
  });

  describe('getNodeByWallet', () => {
    it('should GET /lightning/nodes?wallet_id=...', async () => {
      await client.lightning.getNodeByWallet('wallet-123');
      expect(client.request).toHaveBeenCalledWith('/lightning/nodes?wallet_id=wallet-123');
    });
  });

  // ── Lightning Address ──

  describe('registerAddress', () => {
    it('should POST to /lightning/address', async () => {
      await client.lightning.registerAddress({
        wallet_id: 'w-1',
        username: 'alice',
      });

      expect(client.request).toHaveBeenCalledWith('/lightning/address', {
        method: 'POST',
        body: JSON.stringify({ wallet_id: 'w-1', username: 'alice' }),
      });
    });
  });

  describe('getAddress', () => {
    it('should GET /lightning/address?wallet_id=...', async () => {
      await client.lightning.getAddress('w-1');
      expect(client.request).toHaveBeenCalledWith('/lightning/address?wallet_id=w-1');
    });
  });

  describe('checkAddressAvailable', () => {
    it('should GET /lightning/address?username=...', async () => {
      await client.lightning.checkAddressAvailable('alice');
      expect(client.request).toHaveBeenCalledWith('/lightning/address?username=alice');
    });
  });

  // ── Invoices ──

  describe('createInvoice', () => {
    it('should POST to /lightning/invoices', async () => {
      await client.lightning.createInvoice({
        wallet_id: 'w-1',
        amount_sats: 100,
        description: 'Coffee',
      });

      expect(client.request).toHaveBeenCalledWith('/lightning/invoices', {
        method: 'POST',
        body: JSON.stringify({ wallet_id: 'w-1', amount_sats: 100, description: 'Coffee' }),
      });
    });
  });

  // ── Offers (BOLT12) ──

  describe('createOffer', () => {
    it('should POST to /lightning/offers', async () => {
      await client.lightning.createOffer({
        wallet_id: 'w-1',
        node_id: 'n-1',
        description: 'Coffee',
        amount_msat: 100000,
      });

      expect(client.request).toHaveBeenCalledTimes(1);
      const [url, opts] = client.request.mock.calls[0];
      expect(url).toBe('/lightning/offers');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toMatchObject({
        wallet_id: 'w-1',
        node_id: 'n-1',
        description: 'Coffee',
        amount_msat: 100000,
      });
    });
  });

  describe('getOffer', () => {
    it('should GET /lightning/offers/:id', async () => {
      await client.lightning.getOffer('offer-1');
      expect(client.request).toHaveBeenCalledWith('/lightning/offers/offer-1');
    });
  });

  describe('listOffers', () => {
    it('should GET /lightning/offers with query params', async () => {
      await client.lightning.listOffers({ business_id: 'b-1', limit: 10 });
      expect(client.request).toHaveBeenCalledWith(
        expect.stringContaining('/lightning/offers?')
      );
      expect(client.request).toHaveBeenCalledWith(
        expect.stringContaining('business_id=b-1')
      );
    });

    it('should work with no params', async () => {
      await client.lightning.listOffers();
      expect(client.request).toHaveBeenCalledWith('/lightning/offers?');
    });
  });

  // ── Payments ──

  describe('sendPayment', () => {
    it('should POST to /lightning/payments with lightning address', async () => {
      await client.lightning.sendPayment({
        wallet_id: 'w-1',
        destination: 'alice@coinpayportal.com',
        amount_sats: 100,
      });

      expect(client.request).toHaveBeenCalledWith('/lightning/payments', {
        method: 'POST',
        body: JSON.stringify({
          wallet_id: 'w-1',
          bolt12: 'alice@coinpayportal.com',
          amount_sats: 100,
        }),
      });
    });

    it('should POST to /lightning/payments with bolt11 invoice', async () => {
      await client.lightning.sendPayment({
        wallet_id: 'w-1',
        destination: 'lnbc100n1p...',
      });

      expect(client.request).toHaveBeenCalledWith('/lightning/payments', {
        method: 'POST',
        body: JSON.stringify({
          wallet_id: 'w-1',
          bolt12: 'lnbc100n1p...',
        }),
      });
    });
  });

  describe('listPayments', () => {
    it('should GET /lightning/payments with filters', async () => {
      await client.lightning.listPayments({ wallet_id: 'w-1', direction: 'incoming' });
      expect(client.request).toHaveBeenCalledWith(
        expect.stringContaining('wallet_id=w-1')
      );
      expect(client.request).toHaveBeenCalledWith(
        expect.stringContaining('direction=incoming')
      );
    });
  });

  describe('getPayment', () => {
    it('should GET /lightning/payments/:hash', async () => {
      await client.lightning.getPayment('abc123');
      expect(client.request).toHaveBeenCalledWith('/lightning/payments/abc123');
    });
  });
});
