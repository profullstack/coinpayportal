import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateChallenge,
  verifyChallengeSignature,
  generateWalletToken,
  hashMessage,
  authenticateWalletRequest,
} from './auth';
import { secp256k1 } from '@noble/curves/secp256k1';

// Generate a test keypair for secp256k1
function generateTestKeypair() {
  const privateKey = secp256k1.utils.randomSecretKey();
  const publicKey = secp256k1.getPublicKey(privateKey, true); // compressed
  return {
    privateKey,
    publicKey,
    publicKeyHex: Buffer.from(publicKey).toString('hex'),
    privateKeyHex: Buffer.from(privateKey).toString('hex'),
  };
}

// Sign a message with secp256k1 (prehash: true is default, noble-curves hashes internally)
// In noble-curves v2, sign() returns Uint8Array bytes directly (compact format)
function signMessage(message: string, privateKey: Uint8Array): string {
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = secp256k1.sign(messageBytes, privateKey);
  return Buffer.from(signatureBytes).toString('hex');
}

describe('Web Wallet Auth', () => {
  describe('generateChallenge', () => {
    it('should generate a challenge string with correct format', () => {
      const challenge = generateChallenge();
      expect(challenge).toMatch(/^coinpayportal:auth:\d+:[a-f0-9]{32}$/);
    });

    it('should generate unique challenges', () => {
      const c1 = generateChallenge();
      const c2 = generateChallenge();
      expect(c1).not.toBe(c2);
    });

    it('should include current timestamp', () => {
      const before = Math.floor(Date.now() / 1000);
      const challenge = generateChallenge();
      const after = Math.floor(Date.now() / 1000);

      const parts = challenge.split(':');
      const timestamp = parseInt(parts[2], 10);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('verifyChallengeSignature', () => {
    it('should verify a valid signature', () => {
      const keypair = generateTestKeypair();
      const challenge = generateChallenge();
      const signature = signMessage(challenge, keypair.privateKey);

      expect(verifyChallengeSignature(challenge, signature, keypair.publicKeyHex)).toBe(true);
    });

    it('should reject signature from wrong key', () => {
      const keypair1 = generateTestKeypair();
      const keypair2 = generateTestKeypair();
      const challenge = generateChallenge();
      const signature = signMessage(challenge, keypair1.privateKey);

      expect(verifyChallengeSignature(challenge, signature, keypair2.publicKeyHex)).toBe(false);
    });

    it('should reject signature for wrong message', () => {
      const keypair = generateTestKeypair();
      const challenge1 = generateChallenge();
      const challenge2 = generateChallenge();
      const signature = signMessage(challenge1, keypair.privateKey);

      expect(verifyChallengeSignature(challenge2, signature, keypair.publicKeyHex)).toBe(false);
    });

    it('should reject empty signature', () => {
      const keypair = generateTestKeypair();
      const challenge = generateChallenge();

      expect(verifyChallengeSignature(challenge, '', keypair.publicKeyHex)).toBe(false);
    });

    it('should reject garbage signature', () => {
      const keypair = generateTestKeypair();
      const challenge = generateChallenge();

      expect(verifyChallengeSignature(challenge, 'deadbeef', keypair.publicKeyHex)).toBe(false);
    });
  });

  describe('hashMessage', () => {
    it('should return a 64-char hex string (sha256)', () => {
      const hash = hashMessage('hello');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce consistent hashes', () => {
      const h1 = hashMessage('test message');
      const h2 = hashMessage('test message');
      expect(h1).toBe(h2);
    });

    it('should produce different hashes for different messages', () => {
      const h1 = hashMessage('message1');
      const h2 = hashMessage('message2');
      expect(h1).not.toBe(h2);
    });
  });

  describe('generateWalletToken', () => {
    beforeEach(() => {
      vi.stubEnv('JWT_SECRET', 'test-secret-key-for-jwt-signing-minimum-32-chars');
    });

    it('should generate a JWT token', () => {
      const token = generateWalletToken('test-wallet-id');
      expect(token).toBeTruthy();
      expect(token.split('.')).toHaveLength(3);
    });

    it('should throw if JWT_SECRET is not set', () => {
      vi.stubEnv('JWT_SECRET', '');
      expect(() => generateWalletToken('test-wallet-id')).toThrow('JWT_SECRET not configured');
    });
  });

  describe('authenticateWalletRequest', () => {
    const mockSupabase = {
      from: vi.fn(),
    } as any;

    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubEnv('JWT_SECRET', 'test-secret-key-for-jwt-signing-minimum-32-chars');
    });

    it('should reject missing auth header', async () => {
      const result = await authenticateWalletRequest(mockSupabase, null);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Missing authorization header');
    });

    it('should reject invalid auth format', async () => {
      const result = await authenticateWalletRequest(mockSupabase, 'Basic abc123');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid authorization format');
    });

    it('should reject expired timestamp in signature auth', async () => {
      const keypair = generateTestKeypair();
      const walletId = 'test-wallet-id';
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const message = `GET:/api/web-wallet/test:${oldTimestamp}:`;
      const signature = signMessage(message, keypair.privateKey);

      const authHeader = `Wallet ${walletId}:${signature}:${oldTimestamp}`;
      const result = await authenticateWalletRequest(
        mockSupabase,
        authHeader,
        'GET',
        '/api/web-wallet/test'
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe('Request timestamp expired');
    });

    it('should reject when wallet not found', async () => {
      const keypair = generateTestKeypair();
      const walletId = 'nonexistent-wallet';
      const timestamp = Math.floor(Date.now() / 1000);
      const message = `GET:/api/test:${timestamp}:`;
      const signature = signMessage(message, keypair.privateKey);

      // Mock Supabase returning no data
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
          }),
        }),
      });

      const authHeader = `Wallet ${walletId}:${signature}:${timestamp}`;
      const result = await authenticateWalletRequest(
        mockSupabase,
        authHeader,
        'GET',
        '/api/test'
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe('Wallet not found');
    });

    it('should authenticate valid signature', async () => {
      const keypair = generateTestKeypair();
      const walletId = 'valid-wallet-id';
      const timestamp = Math.floor(Date.now() / 1000);
      const path = '/api/web-wallet/test';
      const message = `GET:${path}:${timestamp}:`;
      const signature = signMessage(message, keypair.privateKey);

      // Mock Supabase returning wallet data
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: walletId,
                public_key_secp256k1: keypair.publicKeyHex,
                public_key_ed25519: null,
                status: 'active',
                created_at: new Date().toISOString(),
                last_active_at: new Date().toISOString(),
              },
              error: null,
            }),
          }),
        }),
      });

      const authHeader = `Wallet ${walletId}:${signature}:${timestamp}`;
      const result = await authenticateWalletRequest(
        mockSupabase,
        authHeader,
        'GET',
        path
      );
      expect(result.success).toBe(true);
      expect(result.walletId).toBe(walletId);
    });

    it('should reject inactive wallet', async () => {
      const keypair = generateTestKeypair();
      const walletId = 'suspended-wallet';
      const timestamp = Math.floor(Date.now() / 1000);
      const message = `GET:/api/test:${timestamp}:`;
      const signature = signMessage(message, keypair.privateKey);

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: walletId,
                public_key_secp256k1: keypair.publicKeyHex,
                public_key_ed25519: null,
                status: 'suspended',
                created_at: new Date().toISOString(),
                last_active_at: new Date().toISOString(),
              },
              error: null,
            }),
          }),
        }),
      });

      const authHeader = `Wallet ${walletId}:${signature}:${timestamp}`;
      const result = await authenticateWalletRequest(
        mockSupabase,
        authHeader,
        'GET',
        '/api/test'
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe('Wallet is not active');
    });

    it('should authenticate valid JWT bearer token', async () => {
      const walletId = 'jwt-wallet-id';
      const token = generateWalletToken(walletId);

      // Mock Supabase returning wallet
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: walletId,
                public_key_secp256k1: '02abc',
                public_key_ed25519: null,
                status: 'active',
                created_at: new Date().toISOString(),
                last_active_at: new Date().toISOString(),
              },
              error: null,
            }),
          }),
        }),
      });

      const result = await authenticateWalletRequest(
        mockSupabase,
        `Bearer ${token}`
      );
      expect(result.success).toBe(true);
      expect(result.walletId).toBe(walletId);
    });

    it('should reject invalid JWT token', async () => {
      const result = await authenticateWalletRequest(
        mockSupabase,
        'Bearer invalid.token.here'
      );
      expect(result.success).toBe(false);
    });
  });
});
