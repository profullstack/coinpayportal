import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WalletAPIClient, hexToUint8Array, uint8ArrayToHex } from './client';
import {
  AuthenticationError,
  RateLimitError,
  NetworkError,
  WalletSDKError,
} from './errors';
import { secp256k1 } from '@noble/curves/secp256k1';

const mockFetch = vi.fn();

function createClient() {
  return new WalletAPIClient({
    baseUrl: 'https://api.example.com',
    fetch: mockFetch as any,
  });
}

function okResponse(data: any, status = 200) {
  return {
    ok: true,
    status,
    json: async () => ({
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    }),
  };
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>
) {
  return {
    ok: false,
    status,
    json: async () => ({
      success: false,
      data: null,
      error: { code, message, details },
      timestamp: new Date().toISOString(),
    }),
  };
}

// Generate a test keypair
function testKeypair() {
  const privateKey = secp256k1.utils.randomSecretKey();
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  return {
    privateKeyHex: uint8ArrayToHex(privateKey),
    publicKeyHex: uint8ArrayToHex(publicKey),
    privateKey,
  };
}

describe('WalletAPIClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('unauthenticated requests', () => {
    it('should make GET request to correct URL', async () => {
      mockFetch.mockResolvedValueOnce(okResponse({ id: '123' }));
      const client = createClient();

      const result = await client.request<{ id: string }>({
        method: 'GET',
        path: '/api/web-wallet/info',
      });

      expect(result).toEqual({ id: '123' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/web-wallet/info',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should make POST request with JSON body', async () => {
      mockFetch.mockResolvedValueOnce(okResponse({ wallet_id: 'w1' }));
      const client = createClient();

      await client.request({
        method: 'POST',
        path: '/api/web-wallet/create',
        body: { public_key_secp256k1: '02abc' },
      });

      const call = mockFetch.mock.calls[0];
      expect(call[1].method).toBe('POST');
      expect(call[1].body).toBe(JSON.stringify({ public_key_secp256k1: '02abc' }));
      expect(call[1].headers['Content-Type']).toBe('application/json');
    });

    it('should append query parameters', async () => {
      mockFetch.mockResolvedValueOnce(okResponse({}));
      const client = createClient();

      await client.request({
        method: 'GET',
        path: '/api/web-wallet/auth/challenge',
        query: { wallet_id: 'w1', extra: undefined },
      });

      const url = mockFetch.mock.calls[0][0];
      expect(url).toBe(
        'https://api.example.com/api/web-wallet/auth/challenge?wallet_id=w1'
      );
    });

    it('should strip trailing slash from baseUrl', async () => {
      const client = new WalletAPIClient({
        baseUrl: 'https://api.example.com/',
        fetch: mockFetch as any,
      });
      mockFetch.mockResolvedValueOnce(okResponse({}));

      await client.request({ method: 'GET', path: '/api/test' });

      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://api.example.com/api/test'
      );
    });
  });

  describe('per-request signature auth', () => {
    it('should build Wallet authorization header', async () => {
      const kp = testKeypair();
      const client = createClient();
      client.setSignatureAuth('wallet-1', kp.privateKeyHex);

      mockFetch.mockResolvedValueOnce(okResponse({ status: 'active' }));

      await client.request({
        method: 'GET',
        path: '/api/web-wallet/wallet-1',
        authenticated: true,
      });

      const authHeader = mockFetch.mock.calls[0][1].headers['Authorization'];
      expect(authHeader).toMatch(/^Wallet wallet-1:[a-f0-9]+:\d+:[a-f0-9]+$/);
    });

    it('should produce verifiable secp256k1 signature', async () => {
      const kp = testKeypair();
      const client = createClient();
      client.setSignatureAuth('w1', kp.privateKeyHex);

      mockFetch.mockResolvedValueOnce(okResponse({}));

      await client.request({
        method: 'POST',
        path: '/api/web-wallet/w1/prepare-tx',
        body: { chain: 'ETH' },
        authenticated: true,
      });

      const authHeader = mockFetch.mock.calls[0][1].headers['Authorization'];
      const parts = authHeader.replace('Wallet ', '').split(':');
      const signatureHex = parts[1];
      const timestamp = parts[2];
      const nonce = parts[3];
      const bodyStr = JSON.stringify({ chain: 'ETH' });

      const message = `POST:/api/web-wallet/w1/prepare-tx:${timestamp}:${nonce}:${bodyStr}`;
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = hexToUint8Array(signatureHex);
      const pubKeyBytes = hexToUint8Array(kp.publicKeyHex);

      const valid = secp256k1.verify(signatureBytes, messageBytes, pubKeyBytes);
      expect(valid).toBe(true);
    });

    it('should throw if no credentials configured', async () => {
      const client = createClient();

      await expect(
        client.request({
          method: 'GET',
          path: '/api/test',
          authenticated: true,
        })
      ).rejects.toThrow(AuthenticationError);
    });
  });

  describe('JWT auth', () => {
    it('should prefer JWT when available and not expired', async () => {
      const client = createClient();
      const futureDate = new Date(Date.now() + 3600_000).toISOString();
      client.setJWTToken('my-jwt', futureDate);

      mockFetch.mockResolvedValueOnce(okResponse({}));

      await client.request({
        method: 'GET',
        path: '/api/test',
        authenticated: true,
      });

      const authHeader = mockFetch.mock.calls[0][1].headers['Authorization'];
      expect(authHeader).toBe('Bearer my-jwt');
    });

    it('should fall back to signature when JWT expired', async () => {
      const kp = testKeypair();
      const client = createClient();
      client.setSignatureAuth('w1', kp.privateKeyHex);

      const pastDate = new Date(Date.now() - 1000).toISOString();
      client.setJWTToken('expired-jwt', pastDate);

      mockFetch.mockResolvedValueOnce(okResponse({}));

      await client.request({
        method: 'GET',
        path: '/api/test',
        authenticated: true,
      });

      const authHeader = mockFetch.mock.calls[0][1].headers['Authorization'];
      expect(authHeader).toMatch(/^Wallet w1:/);
    });

    it('should obtain JWT via challenge-response flow', async () => {
      const kp = testKeypair();
      const client = createClient();
      client.setSignatureAuth('w1', kp.privateKeyHex);

      // Mock challenge endpoint
      mockFetch.mockResolvedValueOnce(
        okResponse({
          challenge: 'coinpayportal:auth:123:abc',
          challenge_id: 'ch-1',
          expires_at: new Date(Date.now() + 300_000).toISOString(),
        })
      );
      // Mock verify endpoint
      mockFetch.mockResolvedValueOnce(
        okResponse({
          auth_token: 'jwt-token-123',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          wallet_id: 'w1',
        })
      );

      const jwt = await client.ensureJWT();
      expect(jwt).toBe('jwt-token-123');

      // Challenge request
      expect(mockFetch.mock.calls[0][0]).toContain(
        '/api/web-wallet/auth/challenge?wallet_id=w1'
      );
      // Verify request
      expect(mockFetch.mock.calls[1][0]).toContain(
        '/api/web-wallet/auth/verify'
      );
    });

    it('should cache JWT and reuse for subsequent requests', async () => {
      const client = createClient();
      const futureDate = new Date(Date.now() + 3600_000).toISOString();
      client.setJWTToken('cached-jwt', futureDate);

      mockFetch.mockResolvedValue(okResponse({}));

      await client.request({
        method: 'GET',
        path: '/api/test1',
        authenticated: true,
      });
      await client.request({
        method: 'GET',
        path: '/api/test2',
        authenticated: true,
      });

      expect(mockFetch.mock.calls[0][1].headers['Authorization']).toBe(
        'Bearer cached-jwt'
      );
      expect(mockFetch.mock.calls[1][1].headers['Authorization']).toBe(
        'Bearer cached-jwt'
      );
    });
  });

  describe('error handling', () => {
    it('should throw AuthenticationError on 401', async () => {
      const kp = testKeypair();
      const client = createClient();
      client.setSignatureAuth('w1', kp.privateKeyHex);

      mockFetch.mockResolvedValueOnce(
        errorResponse('UNAUTHORIZED', 'Invalid signature', 401)
      );

      await expect(
        client.request({
          method: 'GET',
          path: '/api/test',
          authenticated: true,
        })
      ).rejects.toThrow(AuthenticationError);
    });

    it('should throw WalletSDKError with correct code and message', async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse('WALLET_NOT_FOUND', 'Wallet does not exist', 404)
      );
      const client = createClient();

      try {
        await client.request({ method: 'GET', path: '/api/test' });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(WalletSDKError);
        expect((err as WalletSDKError).code).toBe('WALLET_NOT_FOUND');
        expect((err as WalletSDKError).statusCode).toBe(404);
        expect((err as WalletSDKError).message).toBe('Wallet does not exist');
      }
    });

    it('should throw NetworkError when fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const client = createClient();

      await expect(
        client.request({ method: 'GET', path: '/api/test' })
      ).rejects.toThrow(NetworkError);
    });

    it('should throw NetworkError when response is not valid JSON', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      });
      const client = createClient();

      await expect(
        client.request({ method: 'GET', path: '/api/test' })
      ).rejects.toThrow(NetworkError);
    });
  });

  describe('rate limit handling', () => {
    it('should wait and retry on 429 response', async () => {
      mockFetch
        .mockResolvedValueOnce(
          errorResponse('RATE_LIMIT_EXCEEDED', 'Too many requests', 429, {
            retry_after: 0.01,
          })
        )
        .mockResolvedValueOnce(okResponse({ ok: true }));

      const client = createClient();
      const result = await client.request<{ ok: boolean }>({
        method: 'GET',
        path: '/api/test',
      });

      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw RateLimitError after max retries', async () => {
      mockFetch.mockResolvedValue(
        errorResponse('RATE_LIMIT_EXCEEDED', 'Too many requests', 429, {
          retry_after: 0.01,
        })
      );

      const client = createClient();

      await expect(
        client.request({ method: 'GET', path: '/api/test' })
      ).rejects.toThrow(RateLimitError);

      // Initial + 2 retries = 3 calls
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('clearAuth', () => {
    it('should clear all auth credentials', async () => {
      const kp = testKeypair();
      const client = createClient();
      client.setSignatureAuth('w1', kp.privateKeyHex);
      client.setJWTToken('jwt', new Date(Date.now() + 3600_000).toISOString());

      client.clearAuth();

      await expect(
        client.request({
          method: 'GET',
          path: '/api/test',
          authenticated: true,
        })
      ).rejects.toThrow(AuthenticationError);
    });
  });
});

describe('hex utilities', () => {
  it('should convert hex to Uint8Array', () => {
    const result = hexToUint8Array('deadbeef');
    expect(result).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('should handle 0x prefix', () => {
    const result = hexToUint8Array('0xdeadbeef');
    expect(result).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('should convert Uint8Array to hex', () => {
    const result = uint8ArrayToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(result).toBe('deadbeef');
  });
});
