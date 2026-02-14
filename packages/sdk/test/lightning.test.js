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

  describe('provisionNode', () => {
    it('should POST to /lightning/nodes', async () => {
      await client.lightning.provisionNode({
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

  describe('createOffer', () => {
    it('should POST to /lightning/offers', async () => {
      await client.lightning.createOffer({
        node_id: 'n-1',
        description: 'Coffee',
        amount_msat: 100000,
      });

      expect(client.request).toHaveBeenCalledWith('/lightning/offers', {
        method: 'POST',
        body: expect.stringContaining('"node_id":"n-1"'),
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

  describe('listPayments', () => {
    it('should GET /lightning/payments with filters', async () => {
      await client.lightning.listPayments({ node_id: 'n-1', status: 'settled' });
      expect(client.request).toHaveBeenCalledWith(
        expect.stringContaining('node_id=n-1')
      );
      expect(client.request).toHaveBeenCalledWith(
        expect.stringContaining('status=settled')
      );
    });
  });

  describe('sendPayment', () => {
    it('should POST to /lightning/payments', async () => {
      await client.lightning.sendPayment({
        node_id: 'n-1',
        bolt12: 'lno1abc...',
        amount_sats: 1000,
      });

      expect(client.request).toHaveBeenCalledWith('/lightning/payments', {
        method: 'POST',
        body: JSON.stringify({
          node_id: 'n-1',
          bolt12: 'lno1abc...',
          amount_sats: 1000,
        }),
      });
    });
  });

  describe('getPayment', () => {
    it('should GET /lightning/payments/:hash', async () => {
      await client.lightning.getPayment('abc123');
      expect(client.request).toHaveBeenCalledWith('/lightning/payments/abc123');
    });
  });
});
