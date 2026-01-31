import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock supabase client
const mockSingle = vi.fn();
const mockChain: any = {};
['select', 'insert', 'update', 'delete', 'eq', 'in', 'order'].forEach((m) => {
  mockChain[m] = vi.fn().mockReturnValue(mockChain);
});
mockChain.single = mockSingle;

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => mockChain),
  })),
}));

// Mock wallet service
const mockCreateAuthChallenge = vi.fn();
const mockVerifyAuthChallenge = vi.fn();
const mockCreateWallet = vi.fn();
const mockImportWallet = vi.fn();
const mockGetWallet = vi.fn();
const mockDeriveAddress = vi.fn();
const mockListAddresses = vi.fn();
const mockDeactivateAddress = vi.fn();

vi.mock('@/lib/web-wallet/service', () => ({
  createAuthChallenge: (...args: any[]) => mockCreateAuthChallenge(...args),
  verifyAuthChallenge: (...args: any[]) => mockVerifyAuthChallenge(...args),
  createWallet: (...args: any[]) => mockCreateWallet(...args),
  importWallet: (...args: any[]) => mockImportWallet(...args),
  getWallet: (...args: any[]) => mockGetWallet(...args),
  deriveAddress: (...args: any[]) => mockDeriveAddress(...args),
  listAddresses: (...args: any[]) => mockListAddresses(...args),
  deactivateAddress: (...args: any[]) => mockDeactivateAddress(...args),
}));

// Mock balance service
const mockGetWalletBalances = vi.fn();
const mockGetAddressBalance = vi.fn();

vi.mock('@/lib/web-wallet/balance', () => ({
  getWalletBalances: (...args: any[]) => mockGetWalletBalances(...args),
  getAddressBalance: (...args: any[]) => mockGetAddressBalance(...args),
}));

// Mock transaction service
const mockGetTransactionHistory = vi.fn();
const mockGetTransaction = vi.fn();

vi.mock('@/lib/web-wallet/transactions', () => ({
  getTransactionHistory: (...args: any[]) => mockGetTransactionHistory(...args),
  getTransaction: (...args: any[]) => mockGetTransaction(...args),
}));

// Mock wallet auth
const mockAuthenticateWalletRequest = vi.fn();
vi.mock('@/lib/web-wallet/auth', () => ({
  authenticateWalletRequest: (...args: any[]) => mockAuthenticateWalletRequest(...args),
}));

function makeRequest(url: string, options?: RequestInit) {
  return new NextRequest(new URL(url, 'http://localhost:3000'), options);
}

describe('Web Wallet Route Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
    vi.stubEnv('JWT_SECRET', 'test-secret-key-for-jwt-signing-minimum-32-chars');
  });

  // ────────────────────────────────────
  // Auth Challenge
  // ────────────────────────────────────
  describe('GET /api/web-wallet/auth/challenge', () => {
    it('should return 400 if wallet_id missing', async () => {
      const { GET } = await import('./auth/challenge/route');
      const req = makeRequest('http://localhost:3000/api/web-wallet/auth/challenge');
      const res = await GET(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISSING_PARAM');
    });

    it('should return challenge on success', async () => {
      const { GET } = await import('./auth/challenge/route');
      mockCreateAuthChallenge.mockResolvedValue({
        success: true,
        data: {
          challenge: 'coinpayportal:auth:1234:abc',
          expires_at: '2026-01-31T01:00:00Z',
          challenge_id: 'c-id',
        },
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/auth/challenge?wallet_id=w1');
      const res = await GET(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.challenge).toMatch(/coinpayportal:auth:/);
      expect(body.data.challenge_id).toBe('c-id');
      expect(body.timestamp).toBeTruthy();
    });

    it('should return 404 if wallet not found', async () => {
      const { GET } = await import('./auth/challenge/route');
      mockCreateAuthChallenge.mockResolvedValue({
        success: false,
        error: 'Wallet not found',
        code: 'WALLET_NOT_FOUND',
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/auth/challenge?wallet_id=bad');
      const res = await GET(req);
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.success).toBe(false);
    });
  });

  // ────────────────────────────────────
  // Auth Verify
  // ────────────────────────────────────
  describe('POST /api/web-wallet/auth/verify', () => {
    it('should return 400 if required fields missing', async () => {
      const { POST } = await import('./auth/verify/route');
      const req = makeRequest('http://localhost:3000/api/web-wallet/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ wallet_id: 'w1' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
    });

    it('should return JWT on valid verification', async () => {
      const { POST } = await import('./auth/verify/route');
      mockVerifyAuthChallenge.mockResolvedValue({
        success: true,
        data: {
          auth_token: 'jwt.token.here',
          expires_at: '2026-01-31T02:00:00Z',
          wallet_id: 'w1',
        },
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
          wallet_id: 'w1',
          challenge_id: 'c1',
          signature: 'sig-hex',
        }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.auth_token).toBe('jwt.token.here');
    });

    it('should return 401 for invalid signature', async () => {
      const { POST } = await import('./auth/verify/route');
      mockVerifyAuthChallenge.mockResolvedValue({
        success: false,
        error: 'Invalid signature',
        code: 'INVALID_SIGNATURE',
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
          wallet_id: 'w1',
          challenge_id: 'c1',
          signature: 'bad-sig',
        }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  // ────────────────────────────────────
  // Create Wallet
  // ────────────────────────────────────
  describe('POST /api/web-wallet/create', () => {
    it('should return 201 on successful wallet creation', async () => {
      const { POST } = await import('./create/route');
      mockCreateWallet.mockResolvedValue({
        success: true,
        data: {
          wallet_id: 'new-wallet-id',
          created_at: '2026-01-31T00:00:00Z',
          addresses: [],
        },
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/create', {
        method: 'POST',
        body: JSON.stringify({
          public_key_secp256k1: '02' + 'a'.repeat(64),
        }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.wallet_id).toBe('new-wallet-id');
    });

    it('should return 400 on validation error', async () => {
      const { POST } = await import('./create/route');
      mockCreateWallet.mockResolvedValue({
        success: false,
        error: 'At least one public key must be provided',
        code: 'VALIDATION_ERROR',
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/create', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
    });
  });

  // ────────────────────────────────────
  // Import Wallet
  // ────────────────────────────────────
  describe('POST /api/web-wallet/import', () => {
    it('should return 201 on successful import', async () => {
      const { POST } = await import('./import/route');
      mockImportWallet.mockResolvedValue({
        success: true,
        data: {
          wallet_id: 'imported-id',
          imported: true,
          addresses_registered: 2,
          created_at: '2026-01-31T00:00:00Z',
        },
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/import', {
        method: 'POST',
        body: JSON.stringify({
          public_key_secp256k1: '02' + 'a'.repeat(64),
          proof_of_ownership: { message: 'test', signature: 'sig' },
        }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.imported).toBe(true);
    });

    it('should return 401 on invalid signature', async () => {
      const { POST } = await import('./import/route');
      mockImportWallet.mockResolvedValue({
        success: false,
        error: 'Invalid proof of ownership signature',
        code: 'INVALID_SIGNATURE',
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/import', {
        method: 'POST',
        body: JSON.stringify({
          public_key_secp256k1: '02' + 'a'.repeat(64),
          proof_of_ownership: { message: 'test', signature: 'bad' },
        }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  // ────────────────────────────────────
  // Get Wallet
  // ────────────────────────────────────
  describe('GET /api/web-wallet/:id', () => {
    it('should return 401 without auth', async () => {
      const { GET } = await import('./[id]/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: false,
        error: 'Missing authorization header',
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1');
      const res = await GET(req, { params: Promise.resolve({ id: 'w1' }) });
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('should return 403 when accessing different wallet', async () => {
      const { GET } = await import('./[id]/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: true,
        walletId: 'other-wallet',
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1', {
        headers: { authorization: 'Bearer token' },
      });
      const res = await GET(req, { params: Promise.resolve({ id: 'w1' }) });
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.success).toBe(false);
    });

    it('should return wallet data on success', async () => {
      const { GET } = await import('./[id]/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: true,
        walletId: 'w1',
      });
      mockGetWallet.mockResolvedValue({
        success: true,
        data: {
          wallet_id: 'w1',
          status: 'active',
          address_count: 3,
        },
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1', {
        headers: { authorization: 'Bearer token' },
      });
      const res = await GET(req, { params: Promise.resolve({ id: 'w1' }) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.wallet_id).toBe('w1');
      expect(body.data.status).toBe('active');
    });
  });

  // ────────────────────────────────────
  // Derive Address
  // ────────────────────────────────────
  describe('POST /api/web-wallet/:id/derive', () => {
    it('should return 401 without auth', async () => {
      const { POST } = await import('./[id]/derive/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: false,
        error: 'Missing authorization header',
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/derive', {
        method: 'POST',
        body: JSON.stringify({ chain: 'ETH', address: '0x123', derivation_index: 0, derivation_path: "m/44'/60'/0'/0/0" }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req, { params: Promise.resolve({ id: 'w1' }) });
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('should return 201 on success', async () => {
      const { POST } = await import('./[id]/derive/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: true,
        walletId: 'w1',
      });
      mockDeriveAddress.mockResolvedValue({
        success: true,
        data: {
          address_id: 'a1',
          chain: 'ETH',
          address: '0xabc',
          derivation_index: 1,
        },
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/derive', {
        method: 'POST',
        body: JSON.stringify({ chain: 'ETH', address: '0xabc', derivation_index: 1, derivation_path: "m/44'/60'/0'/0/1" }),
        headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
      });
      const res = await POST(req, { params: Promise.resolve({ id: 'w1' }) });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.address_id).toBe('a1');
    });
  });

  // ────────────────────────────────────
  // List Addresses
  // ────────────────────────────────────
  describe('GET /api/web-wallet/:id/addresses', () => {
    it('should return address list on success', async () => {
      const { GET } = await import('./[id]/addresses/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: true,
        walletId: 'w1',
      });
      mockListAddresses.mockResolvedValue({
        success: true,
        data: {
          addresses: [
            { address_id: 'a1', chain: 'ETH', address: '0xabc' },
          ],
          total: 1,
        },
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/addresses', {
        headers: { authorization: 'Bearer token' },
      });
      const res = await GET(req, { params: Promise.resolve({ id: 'w1' }) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.addresses).toHaveLength(1);
      expect(body.data.total).toBe(1);
    });
  });

  // ────────────────────────────────────
  // Deactivate Address
  // ────────────────────────────────────
  describe('DELETE /api/web-wallet/:id/addresses/:address_id', () => {
    it('should return 401 without auth', async () => {
      const { DELETE } = await import('./[id]/addresses/[address_id]/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: false,
        error: 'Missing authorization header',
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/addresses/a1', {
        method: 'DELETE',
      });
      const res = await DELETE(req, { params: Promise.resolve({ id: 'w1', address_id: 'a1' }) });
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('should deactivate address on success', async () => {
      const { DELETE } = await import('./[id]/addresses/[address_id]/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: true,
        walletId: 'w1',
      });
      mockDeactivateAddress.mockResolvedValue({
        success: true,
        data: { address_id: 'a1', is_active: false, deactivated_at: '2026-01-31T00:00:00Z' },
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/addresses/a1', {
        method: 'DELETE',
        headers: { authorization: 'Bearer token' },
      });
      const res = await DELETE(req, { params: Promise.resolve({ id: 'w1', address_id: 'a1' }) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.is_active).toBe(false);
    });

    it('should return 404 for nonexistent address', async () => {
      const { DELETE } = await import('./[id]/addresses/[address_id]/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: true,
        walletId: 'w1',
      });
      mockDeactivateAddress.mockResolvedValue({
        success: false,
        error: 'Address not found',
        code: 'ADDRESS_NOT_FOUND',
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/addresses/bad', {
        method: 'DELETE',
        headers: { authorization: 'Bearer token' },
      });
      const res = await DELETE(req, { params: Promise.resolve({ id: 'w1', address_id: 'bad' }) });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.success).toBe(false);
    });
  });

  // ────────────────────────────────────
  // Get Wallet Balances
  // ────────────────────────────────────
  describe('GET /api/web-wallet/:id/balances', () => {
    it('should return 401 without auth', async () => {
      const { GET } = await import('./[id]/balances/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: false,
        error: 'Missing authorization header',
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/balances');
      const res = await GET(req, { params: Promise.resolve({ id: 'w1' }) });
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('should return 403 when accessing different wallet', async () => {
      const { GET } = await import('./[id]/balances/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: true,
        walletId: 'other-wallet',
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/balances', {
        headers: { authorization: 'Bearer token' },
      });
      const res = await GET(req, { params: Promise.resolve({ id: 'w1' }) });
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.success).toBe(false);
    });

    it('should return balances on success', async () => {
      const { GET } = await import('./[id]/balances/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: true,
        walletId: 'w1',
      });
      mockGetWalletBalances.mockResolvedValue({
        success: true,
        data: [
          { balance: '1.5', chain: 'ETH', address: '0xabc', updatedAt: '2026-01-31T00:00:00Z' },
          { balance: '0.5', chain: 'BTC', address: '1BTC', updatedAt: '2026-01-31T00:00:00Z' },
        ],
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/balances', {
        headers: { authorization: 'Bearer token' },
      });
      const res = await GET(req, { params: Promise.resolve({ id: 'w1' }) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.balances).toHaveLength(2);
      expect(body.data.balances[0].balance).toBe('1.5');
    });

    it('should pass chain filter to service', async () => {
      const { GET } = await import('./[id]/balances/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: true,
        walletId: 'w1',
      });
      mockGetWalletBalances.mockResolvedValue({
        success: true,
        data: [],
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/balances?chain=ETH', {
        headers: { authorization: 'Bearer token' },
      });
      const res = await GET(req, { params: Promise.resolve({ id: 'w1' }) });

      expect(res.status).toBe(200);
      // Verify chain option was passed
      expect(mockGetWalletBalances).toHaveBeenCalledWith(
        expect.anything(),
        'w1',
        expect.objectContaining({ chain: 'ETH' })
      );
    });
  });

  // ────────────────────────────────────
  // Get Single Address Balance
  // ────────────────────────────────────
  describe('GET /api/web-wallet/:id/addresses/:address_id/balance', () => {
    it('should return 401 without auth', async () => {
      const { GET } = await import('./[id]/addresses/[address_id]/balance/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: false,
        error: 'Missing authorization header',
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/addresses/a1/balance');
      const res = await GET(req, { params: Promise.resolve({ id: 'w1', address_id: 'a1' }) });
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('should return balance on success', async () => {
      const { GET } = await import('./[id]/addresses/[address_id]/balance/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: true,
        walletId: 'w1',
      });
      mockGetAddressBalance.mockResolvedValue({
        success: true,
        data: {
          balance: '2.5',
          chain: 'ETH',
          address: '0xabc',
          updatedAt: '2026-01-31T00:00:00Z',
        },
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/addresses/a1/balance', {
        headers: { authorization: 'Bearer token' },
      });
      const res = await GET(req, { params: Promise.resolve({ id: 'w1', address_id: 'a1' }) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.balance).toBe('2.5');
      expect(body.data.chain).toBe('ETH');
    });

    it('should return 404 for nonexistent address', async () => {
      const { GET } = await import('./[id]/addresses/[address_id]/balance/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: true,
        walletId: 'w1',
      });
      mockGetAddressBalance.mockResolvedValue({
        success: false,
        error: 'Address not found',
        code: 'ADDRESS_NOT_FOUND',
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/addresses/bad/balance', {
        headers: { authorization: 'Bearer token' },
      });
      const res = await GET(req, { params: Promise.resolve({ id: 'w1', address_id: 'bad' }) });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.success).toBe(false);
    });

    it('should pass refresh flag to service', async () => {
      const { GET } = await import('./[id]/addresses/[address_id]/balance/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: true,
        walletId: 'w1',
      });
      mockGetAddressBalance.mockResolvedValue({
        success: true,
        data: { balance: '1', chain: 'SOL', address: 'abc', updatedAt: '2026-01-31T00:00:00Z' },
      });

      const req = makeRequest(
        'http://localhost:3000/api/web-wallet/w1/addresses/a1/balance?refresh=true',
        { headers: { authorization: 'Bearer token' } }
      );
      const res = await GET(req, { params: Promise.resolve({ id: 'w1', address_id: 'a1' }) });

      expect(res.status).toBe(200);
      expect(mockGetAddressBalance).toHaveBeenCalledWith(
        expect.anything(),
        'w1',
        'a1',
        true
      );
    });
  });

  // ────────────────────────────────────
  // Get Transaction History
  // ────────────────────────────────────
  describe('GET /api/web-wallet/:id/transactions', () => {
    it('should return 401 without auth', async () => {
      const { GET } = await import('./[id]/transactions/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: false,
        error: 'Missing authorization header',
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/transactions');
      const res = await GET(req, { params: Promise.resolve({ id: 'w1' }) });
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('should return 403 when accessing different wallet', async () => {
      const { GET } = await import('./[id]/transactions/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: true,
        walletId: 'other-wallet',
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/transactions', {
        headers: { authorization: 'Bearer token' },
      });
      const res = await GET(req, { params: Promise.resolve({ id: 'w1' }) });
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.success).toBe(false);
    });

    it('should return transactions on success', async () => {
      const { GET } = await import('./[id]/transactions/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: true,
        walletId: 'w1',
      });
      mockGetTransactionHistory.mockResolvedValue({
        success: true,
        data: {
          transactions: [
            { id: 'tx1', chain: 'ETH', tx_hash: '0xabc', direction: 'incoming', amount: '1.5' },
          ],
          total: 1,
          limit: 50,
          offset: 0,
        },
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/transactions', {
        headers: { authorization: 'Bearer token' },
      });
      const res = await GET(req, { params: Promise.resolve({ id: 'w1' }) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.transactions).toHaveLength(1);
      expect(body.data.total).toBe(1);
    });

    it('should pass filter params to service', async () => {
      const { GET } = await import('./[id]/transactions/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: true,
        walletId: 'w1',
      });
      mockGetTransactionHistory.mockResolvedValue({
        success: true,
        data: { transactions: [], total: 0, limit: 10, offset: 0 },
      });

      const req = makeRequest(
        'http://localhost:3000/api/web-wallet/w1/transactions?chain=ETH&direction=incoming&limit=10&offset=5',
        { headers: { authorization: 'Bearer token' } }
      );
      const res = await GET(req, { params: Promise.resolve({ id: 'w1' }) });

      expect(res.status).toBe(200);
      expect(mockGetTransactionHistory).toHaveBeenCalledWith(
        expect.anything(),
        'w1',
        expect.objectContaining({
          chain: 'ETH',
          direction: 'incoming',
          limit: 10,
          offset: 5,
        })
      );
    });
  });

  // ────────────────────────────────────
  // Get Transaction Detail
  // ────────────────────────────────────
  describe('GET /api/web-wallet/:id/transactions/:tx_id', () => {
    it('should return 401 without auth', async () => {
      const { GET } = await import('./[id]/transactions/[tx_id]/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: false,
        error: 'Missing authorization header',
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/transactions/tx1');
      const res = await GET(req, { params: Promise.resolve({ id: 'w1', tx_id: 'tx1' }) });
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('should return transaction on success', async () => {
      const { GET } = await import('./[id]/transactions/[tx_id]/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: true,
        walletId: 'w1',
      });
      mockGetTransaction.mockResolvedValue({
        success: true,
        data: {
          id: 'tx1',
          chain: 'ETH',
          tx_hash: '0xabc',
          direction: 'incoming',
          status: 'confirmed',
          amount: '1.5',
        },
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/transactions/tx1', {
        headers: { authorization: 'Bearer token' },
      });
      const res = await GET(req, { params: Promise.resolve({ id: 'w1', tx_id: 'tx1' }) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.tx_hash).toBe('0xabc');
      expect(body.data.status).toBe('confirmed');
    });

    it('should return 404 for nonexistent transaction', async () => {
      const { GET } = await import('./[id]/transactions/[tx_id]/route');
      mockAuthenticateWalletRequest.mockResolvedValue({
        success: true,
        walletId: 'w1',
      });
      mockGetTransaction.mockResolvedValue({
        success: false,
        error: 'Transaction not found',
        code: 'TX_NOT_FOUND',
      });

      const req = makeRequest('http://localhost:3000/api/web-wallet/w1/transactions/bad', {
        headers: { authorization: 'Bearer token' },
      });
      const res = await GET(req, { params: Promise.resolve({ id: 'w1', tx_id: 'bad' }) });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.success).toBe(false);
    });
  });
});
