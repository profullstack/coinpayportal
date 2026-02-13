/**
 * Reputation SDK Module Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  submitReceipt,
  getReputation,
  getCredential,
  getCredentials,
  getReceipts,
  getBadgeUrl,
  verifyCredential,
  getRevocationList,
  getMyDid,
  claimDid,
  linkDid,
} from '../src/reputation.js';

// Mock client
function createMockClient(response = {}) {
  return {
    request: vi.fn().mockResolvedValue(response),
    baseUrl: 'https://coinpayportal.com',
  };
}

describe('Reputation SDK', () => {
  describe('submitReceipt', () => {
    it('should POST to /reputation/receipt', async () => {
      const client = createMockClient({ success: true });
      const receipt = { receipt_id: 'r1', agent_did: 'did:key:z1', outcome: 'accepted' };
      await submitReceipt(client, receipt);
      expect(client.request).toHaveBeenCalledWith('/reputation/receipt', {
        method: 'POST',
        body: JSON.stringify(receipt),
      });
    });
  });

  describe('getReputation', () => {
    it('should GET agent reputation by DID', async () => {
      const client = createMockClient({ success: true, reputation: {} });
      await getReputation(client, 'did:key:z6Mk123');
      expect(client.request).toHaveBeenCalledWith(
        '/reputation/agent/did%3Akey%3Az6Mk123/reputation'
      );
    });

    it('should encode special characters in DID', async () => {
      const client = createMockClient({});
      await getReputation(client, 'did:web:example.com:path');
      expect(client.request).toHaveBeenCalledWith(
        expect.stringContaining('did%3Aweb%3Aexample.com%3Apath')
      );
    });
  });

  describe('getCredential', () => {
    it('should GET a specific credential by ID', async () => {
      const client = createMockClient({ id: 'cred-1' });
      await getCredential(client, 'cred-1');
      expect(client.request).toHaveBeenCalledWith('/reputation/credential/cred-1');
    });
  });

  describe('getCredentials', () => {
    it('should GET all credentials for a DID', async () => {
      const client = createMockClient({ credentials: [] });
      await getCredentials(client, 'did:key:z6Mk123');
      expect(client.request).toHaveBeenCalledWith(
        '/reputation/credentials?did=did%3Akey%3Az6Mk123'
      );
    });
  });

  describe('getReceipts', () => {
    it('should GET all receipts for a DID', async () => {
      const client = createMockClient({ receipts: [] });
      await getReceipts(client, 'did:key:z6Mk123');
      expect(client.request).toHaveBeenCalledWith(
        '/reputation/receipts?did=did%3Akey%3Az6Mk123'
      );
    });
  });

  describe('getBadgeUrl', () => {
    it('should return correct badge URL', () => {
      const url = getBadgeUrl('https://coinpayportal.com', 'did:key:z6Mk123');
      expect(url).toBe('https://coinpayportal.com/api/reputation/badge/did%3Akey%3Az6Mk123');
    });

    it('should handle custom base URLs', () => {
      const url = getBadgeUrl('http://localhost:3000', 'did:key:z1');
      expect(url).toBe('http://localhost:3000/api/reputation/badge/did%3Akey%3Az1');
    });
  });

  describe('verifyCredential', () => {
    it('should POST to /reputation/verify', async () => {
      const client = createMockClient({ valid: true });
      await verifyCredential(client, { credential_id: 'cred-1' });
      expect(client.request).toHaveBeenCalledWith('/reputation/verify', {
        method: 'POST',
        body: JSON.stringify({ credential_id: 'cred-1' }),
      });
    });
  });

  describe('getRevocationList', () => {
    it('should GET revocation list', async () => {
      const client = createMockClient({ revocations: [] });
      await getRevocationList(client);
      expect(client.request).toHaveBeenCalledWith('/reputation/revocation-list');
    });
  });

  describe('DID management', () => {
    it('getMyDid should GET /reputation/did/me', async () => {
      const client = createMockClient({ did: 'did:key:z1' });
      const result = await getMyDid(client);
      expect(client.request).toHaveBeenCalledWith('/reputation/did/me');
      expect(result.did).toBe('did:key:z1');
    });

    it('claimDid should POST to /reputation/did/claim', async () => {
      const client = createMockClient({ did: 'did:key:z1', public_key: 'abc' });
      await claimDid(client);
      expect(client.request).toHaveBeenCalledWith('/reputation/did/claim', {
        method: 'POST',
      });
    });

    it('linkDid should POST with DID, key, and signature', async () => {
      const client = createMockClient({ did: 'did:key:z1' });
      await linkDid(client, {
        did: 'did:key:z1',
        publicKey: 'pubkey123',
        signature: 'sig456',
      });
      expect(client.request).toHaveBeenCalledWith('/reputation/did/claim', {
        method: 'POST',
        body: JSON.stringify({
          did: 'did:key:z1',
          public_key: 'pubkey123',
          signature: 'sig456',
        }),
      });
    });
  });
});
