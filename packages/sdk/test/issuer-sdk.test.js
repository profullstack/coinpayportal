/**
 * Platform Issuer SDK Tests
 */

import { describe, it, expect, vi } from 'vitest';
import {
  registerPlatformIssuer,
  listPlatformIssuers,
  rotatePlatformApiKey,
  deactivatePlatformIssuer,
} from '../src/reputation.js';

function createMockClient(response = {}) {
  return {
    request: vi.fn().mockResolvedValue(response),
  };
}

describe('Platform Issuer SDK', () => {
  describe('registerPlatformIssuer', () => {
    it('should POST to /reputation/issuers', async () => {
      const client = createMockClient({ success: true, api_key: 'cprt_test_abc' });
      const params = { name: 'test', domain: 'test.com' };
      const result = await registerPlatformIssuer(client, params);

      expect(client.request).toHaveBeenCalledWith('/reputation/issuers', {
        method: 'POST',
        body: JSON.stringify({ name: 'test', domain: 'test.com', did: undefined }),
      });
      expect(result.success).toBe(true);
      expect(result.api_key).toBe('cprt_test_abc');
    });

    it('should pass optional DID', async () => {
      const client = createMockClient({ success: true });
      await registerPlatformIssuer(client, { name: 'test', domain: 'test.com', did: 'did:web:custom' });

      expect(client.request).toHaveBeenCalledWith('/reputation/issuers', {
        method: 'POST',
        body: JSON.stringify({ name: 'test', domain: 'test.com', did: 'did:web:custom' }),
      });
    });
  });

  describe('listPlatformIssuers', () => {
    it('should GET /reputation/issuers', async () => {
      const client = createMockClient({ success: true, issuers: [] });
      const result = await listPlatformIssuers(client);

      expect(client.request).toHaveBeenCalledWith('/reputation/issuers');
      expect(result.success).toBe(true);
    });
  });

  describe('rotatePlatformApiKey', () => {
    it('should POST to /reputation/issuers/{id}/rotate', async () => {
      const client = createMockClient({ success: true, api_key: 'cprt_new_key' });
      const result = await rotatePlatformApiKey(client, 'issuer-123');

      expect(client.request).toHaveBeenCalledWith('/reputation/issuers/issuer-123/rotate', {
        method: 'POST',
      });
      expect(result.api_key).toBe('cprt_new_key');
    });
  });

  describe('deactivatePlatformIssuer', () => {
    it('should DELETE /reputation/issuers/{id}', async () => {
      const client = createMockClient({ success: true, issuer: { active: false } });
      const result = await deactivatePlatformIssuer(client, 'issuer-123');

      expect(client.request).toHaveBeenCalledWith('/reputation/issuers/issuer-123', {
        method: 'DELETE',
      });
      expect(result.issuer.active).toBe(false);
    });
  });
});
