import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createWallet,
  importWallet,
  getWallet,
  deriveAddress,
  listAddresses,
  deactivateAddress,
  createAuthChallenge,
  verifyAuthChallenge,
} from './service';
import { secp256k1 } from '@noble/curves/secp256k1';

// ──────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────

function generateTestKeypair() {
  const privateKey = secp256k1.utils.randomSecretKey();
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  return {
    privateKey,
    publicKey,
    publicKeyHex: Buffer.from(publicKey).toString('hex'),
  };
}

function signMessage(message: string, privateKey: Uint8Array): string {
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = secp256k1.sign(messageBytes, privateKey);
  return Buffer.from(signatureBytes).toString('hex');
}

/** Create a mock Supabase client with chainable query builder */
function createMockSupabase() {
  const mockChain = () => {
    const chain: any = {
      select: vi.fn().mockReturnValue(chain),
      insert: vi.fn().mockReturnValue(chain),
      update: vi.fn().mockReturnValue(chain),
      delete: vi.fn().mockReturnValue(chain),
      eq: vi.fn().mockReturnValue(chain),
      in: vi.fn().mockReturnValue(chain),
      order: vi.fn().mockReturnValue(chain),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: undefined, // prevent auto-resolution
    };
    return chain;
  };

  const chains: Record<string, ReturnType<typeof mockChain>> = {};
  const supabase = {
    from: vi.fn((table: string) => {
      if (!chains[table]) {
        chains[table] = mockChain();
      }
      return chains[table];
    }),
    _chains: chains,
    _mockChain: mockChain,
  } as any;

  return supabase;
}

/** Reconfigure mock chain for a table to return specific data at .single() */
function mockTableSingle(supabase: any, table: string, data: any, error: any = null) {
  const chain: any = {
    select: vi.fn().mockReturnValue(chain),
    insert: vi.fn().mockReturnValue(chain),
    update: vi.fn().mockReturnValue(chain),
    delete: vi.fn().mockReturnValue(chain),
    eq: vi.fn().mockReturnValue(chain),
    in: vi.fn().mockReturnValue(chain),
    order: vi.fn().mockReturnValue(chain),
    single: vi.fn().mockResolvedValue({ data, error }),
  };
  supabase._chains[table] = chain;
  supabase.from.mockImplementation((t: string) => {
    if (!supabase._chains[t]) {
      supabase._chains[t] = supabase._mockChain();
    }
    return supabase._chains[t];
  });
  return chain;
}

/**
 * Create a more flexible mock supabase that tracks calls per table and
 * returns different results for sequential calls.
 */
function createSequentialMockSupabase() {
  const tableConfigs: Record<string, Array<{ data: any; error: any; count?: number }>> = {};
  const tableCallIndex: Record<string, number> = {};

  const buildChain = (table: string) => {
    const chain: any = {};
    const methods = ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order'];
    for (const m of methods) {
      chain[m] = vi.fn().mockReturnValue(chain);
    }
    chain.single = vi.fn().mockImplementation(async () => {
      const configs = tableConfigs[table] || [{ data: null, error: null }];
      const idx = tableCallIndex[table] || 0;
      const config = configs[Math.min(idx, configs.length - 1)];
      tableCallIndex[table] = idx + 1;
      return { data: config.data, error: config.error, count: config.count };
    });
    return chain;
  };

  const supabase = {
    from: vi.fn((table: string) => buildChain(table)),
    _configure: (table: string, responses: Array<{ data: any; error: any; count?: number }>) => {
      tableConfigs[table] = responses;
      tableCallIndex[table] = 0;
    },
    _reset: () => {
      for (const k of Object.keys(tableCallIndex)) {
        tableCallIndex[k] = 0;
      }
    },
  } as any;

  return supabase;
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('Web Wallet Service', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', 'test-secret-key-for-jwt-signing-minimum-32-chars');
  });

  describe('createWallet', () => {
    it('should reject missing public keys', async () => {
      const supabase = createMockSupabase();
      const result = await createWallet(supabase, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('At least one public key');
    });

    it('should reject invalid secp256k1 key', async () => {
      const supabase = createMockSupabase();
      const result = await createWallet(supabase, {
        public_key_secp256k1: 'not-a-valid-key',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid secp256k1');
    });

    it('should create wallet with valid secp256k1 key', async () => {
      const keypair = generateTestKeypair();
      const supabase = createSequentialMockSupabase();

      // First call to wallets: check existing (not found)
      // Second call to wallets: insert new wallet
      supabase._configure('wallets', [
        { data: null, error: { code: 'PGRST116' } }, // no existing wallet
        { data: { id: 'test-wallet-id', created_at: '2026-01-31T00:00:00Z' }, error: null },
      ]);
      supabase._configure('wallet_settings', [
        { data: null, error: null },
      ]);

      const result = await createWallet(supabase, {
        public_key_secp256k1: keypair.publicKeyHex,
      });

      expect(result.success).toBe(true);
      expect(result.data?.wallet_id).toBe('test-wallet-id');
    });

    it('should reject duplicate secp256k1 key', async () => {
      const keypair = generateTestKeypair();
      const supabase = createSequentialMockSupabase();

      // Existing wallet found
      supabase._configure('wallets', [
        { data: { id: 'existing-wallet' }, error: null },
      ]);

      const result = await createWallet(supabase, {
        public_key_secp256k1: keypair.publicKeyHex,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should validate initial addresses', async () => {
      const keypair = generateTestKeypair();
      const supabase = createSequentialMockSupabase();

      supabase._configure('wallets', [
        { data: null, error: { code: 'PGRST116' } },
      ]);

      const result = await createWallet(supabase, {
        public_key_secp256k1: keypair.publicKeyHex,
        initial_addresses: [
          { chain: 'ETH', address: 'invalid-address', derivation_path: "m/44'/60'/0'/0/0" },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid ETH address');
    });

    it('should create wallet with initial addresses', async () => {
      const keypair = generateTestKeypair();
      const supabase = createSequentialMockSupabase();

      supabase._configure('wallets', [
        { data: null, error: { code: 'PGRST116' } },
        { data: { id: 'test-wallet-id', created_at: '2026-01-31T00:00:00Z' }, error: null },
      ]);
      supabase._configure('wallet_addresses', [
        { data: { chain: 'ETH', address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28', derivation_index: 0 }, error: null },
      ]);
      supabase._configure('wallet_settings', [
        { data: null, error: null },
      ]);

      const result = await createWallet(supabase, {
        public_key_secp256k1: keypair.publicKeyHex,
        initial_addresses: [
          {
            chain: 'ETH',
            address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28',
            derivation_path: "m/44'/60'/0'/0/0",
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.data?.addresses).toHaveLength(1);
    });
  });

  describe('importWallet', () => {
    it('should reject missing proof of ownership', async () => {
      const supabase = createMockSupabase();
      const result = await importWallet(supabase, {
        public_key_secp256k1: 'some-key',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid proof of ownership signature', async () => {
      const keypair = generateTestKeypair();
      const supabase = createSequentialMockSupabase();

      const result = await importWallet(supabase, {
        public_key_secp256k1: keypair.publicKeyHex,
        proof_of_ownership: {
          message: 'CoinPayPortal wallet import: 1234567890',
          signature: 'deadbeef',
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid proof of ownership');
    });

    it('should import wallet with valid signature', async () => {
      const keypair = generateTestKeypair();
      const message = `CoinPayPortal wallet import: ${Math.floor(Date.now() / 1000)}`;
      const signature = signMessage(message, keypair.privateKey);
      const supabase = createSequentialMockSupabase();

      // Check existing: not found, then insert
      supabase._configure('wallets', [
        { data: null, error: { code: 'PGRST116' } },
        { data: { id: 'imported-wallet-id', created_at: '2026-01-31T00:00:00Z' }, error: null },
      ]);
      supabase._configure('wallet_settings', [
        { data: null, error: null },
      ]);

      const result = await importWallet(supabase, {
        public_key_secp256k1: keypair.publicKeyHex,
        proof_of_ownership: { message, signature },
      });

      expect(result.success).toBe(true);
      expect(result.data?.wallet_id).toBe('imported-wallet-id');
      expect(result.data?.imported).toBe(true);
    });

    it('should return existing wallet if key already registered', async () => {
      const keypair = generateTestKeypair();
      const message = `CoinPayPortal wallet import: ${Math.floor(Date.now() / 1000)}`;
      const signature = signMessage(message, keypair.privateKey);
      const supabase = createSequentialMockSupabase();

      // Existing wallet found
      supabase._configure('wallets', [
        { data: { id: 'existing-wallet-id' }, error: null },
      ]);

      const result = await importWallet(supabase, {
        public_key_secp256k1: keypair.publicKeyHex,
        proof_of_ownership: { message, signature },
      });

      expect(result.success).toBe(true);
      expect(result.data?.wallet_id).toBe('existing-wallet-id');
      expect(result.data?.already_exists).toBe(true);
    });
  });

  describe('getWallet', () => {
    it('should return wallet not found', async () => {
      const supabase = createSequentialMockSupabase();
      supabase._configure('wallets', [
        { data: null, error: { message: 'Not found' } },
      ]);

      const result = await getWallet(supabase, 'nonexistent');
      expect(result.success).toBe(false);
      expect(result.code).toBe('WALLET_NOT_FOUND');
    });

    it('should return wallet info with settings', async () => {
      const supabase = createSequentialMockSupabase();
      supabase._configure('wallets', [
        { data: { id: 'w1', status: 'active', created_at: '2026-01-01', last_active_at: '2026-01-31' }, error: null },
      ]);
      supabase._configure('wallet_addresses', [
        { data: null, error: null, count: 3 },
      ]);
      supabase._configure('wallet_settings', [
        { data: { daily_spend_limit: null, whitelist_enabled: false, require_confirmation: false }, error: null },
      ]);

      const result = await getWallet(supabase, 'w1');
      expect(result.success).toBe(true);
      expect(result.data?.wallet_id).toBe('w1');
      expect(result.data?.status).toBe('active');
    });
  });

  describe('deriveAddress', () => {
    it('should reject invalid chain', async () => {
      const supabase = createSequentialMockSupabase();
      const result = await deriveAddress(supabase, 'w1', {
        chain: 'INVALID',
        address: '0x123',
        derivation_index: 0,
        derivation_path: "m/44'/60'/0'/0/0",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid chain');
    });

    it('should reject invalid ETH address', async () => {
      const supabase = createSequentialMockSupabase();
      const result = await deriveAddress(supabase, 'w1', {
        chain: 'ETH',
        address: 'not-an-eth-address',
        derivation_index: 0,
        derivation_path: "m/44'/60'/0'/0/0",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid ETH address');
    });

    it('should register a valid new address', async () => {
      const supabase = createSequentialMockSupabase();

      // Wallet exists
      supabase._configure('wallets', [
        { data: { id: 'w1' }, error: null },
      ]);
      // No existing address, then insert
      supabase._configure('wallet_addresses', [
        { data: null, error: { code: 'PGRST116' } },
        {
          data: {
            id: 'addr-1',
            chain: 'ETH',
            address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28',
            derivation_index: 1,
            derivation_path: "m/44'/60'/0'/0/1",
            created_at: '2026-01-31T00:00:00Z',
          },
          error: null,
        },
      ]);

      const result = await deriveAddress(supabase, 'w1', {
        chain: 'ETH',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28',
        derivation_index: 1,
        derivation_path: "m/44'/60'/0'/0/1",
      });

      expect(result.success).toBe(true);
      expect(result.data?.address_id).toBe('addr-1');
      expect(result.data?.derivation_index).toBe(1);
    });
  });

  describe('listAddresses', () => {
    it('should return empty list for wallet with no addresses', async () => {
      const supabase = createSequentialMockSupabase();

      // Override from to return array query result
      const chain: any = {};
      const methods = ['select', 'eq', 'order'];
      for (const m of methods) {
        chain[m] = vi.fn().mockReturnValue(chain);
      }
      chain.then = undefined;
      // listAddresses doesn't call .single(), it resolves the query directly
      // We need the chain itself to resolve as { data, error }
      Object.defineProperty(chain, 'then', {
        value: (resolve: any) => resolve({ data: [], error: null }),
        writable: true,
        configurable: true,
      });
      supabase.from.mockReturnValue(chain);

      const result = await listAddresses(supabase, 'w1', {});
      expect(result.success).toBe(true);
      expect(result.data?.addresses).toEqual([]);
      expect(result.data?.total).toBe(0);
    });
  });

  describe('deactivateAddress', () => {
    it('should return not found for missing address', async () => {
      const supabase = createSequentialMockSupabase();
      supabase._configure('wallet_addresses', [
        { data: null, error: { message: 'Not found' } },
      ]);

      const result = await deactivateAddress(supabase, 'w1', 'nonexistent');
      expect(result.success).toBe(false);
      expect(result.code).toBe('ADDRESS_NOT_FOUND');
    });

    it('should deactivate an address', async () => {
      const supabase = createSequentialMockSupabase();
      supabase._configure('wallet_addresses', [
        { data: { id: 'addr-1', is_active: false }, error: null },
      ]);

      const result = await deactivateAddress(supabase, 'w1', 'addr-1');
      expect(result.success).toBe(true);
      expect(result.data?.is_active).toBe(false);
    });
  });

  describe('createAuthChallenge', () => {
    it('should reject nonexistent wallet', async () => {
      const supabase = createSequentialMockSupabase();
      supabase._configure('wallets', [
        { data: null, error: { message: 'Not found' } },
      ]);

      const result = await createAuthChallenge(supabase, 'nonexistent');
      expect(result.success).toBe(false);
      expect(result.code).toBe('WALLET_NOT_FOUND');
    });

    it('should create a challenge', async () => {
      const supabase = createSequentialMockSupabase();
      supabase._configure('wallets', [
        { data: { id: 'w1' }, error: null },
      ]);
      supabase._configure('wallet_auth_challenges', [
        {
          data: {
            id: 'challenge-1',
            challenge: 'coinpayportal:auth:1234:abcd',
            expires_at: new Date(Date.now() + 300000).toISOString(),
          },
          error: null,
        },
      ]);

      const result = await createAuthChallenge(supabase, 'w1');
      expect(result.success).toBe(true);
      expect(result.data?.challenge_id).toBe('challenge-1');
      expect(result.data?.challenge).toMatch(/coinpayportal:auth:/);
    });
  });

  describe('verifyAuthChallenge', () => {
    it('should reject missing challenge', async () => {
      const supabase = createSequentialMockSupabase();
      supabase._configure('wallet_auth_challenges', [
        { data: null, error: { message: 'Not found' } },
      ]);

      const result = await verifyAuthChallenge(supabase, {
        wallet_id: 'w1',
        challenge_id: 'nonexistent',
        signature: 'abc',
      });
      expect(result.success).toBe(false);
      expect(result.code).toBe('CHALLENGE_NOT_FOUND');
    });

    it('should reject expired challenge', async () => {
      const supabase = createSequentialMockSupabase();
      supabase._configure('wallet_auth_challenges', [
        {
          data: {
            id: 'c1',
            wallet_id: 'w1',
            challenge: 'coinpayportal:auth:1234:abcd',
            expires_at: new Date(Date.now() - 60000).toISOString(), // expired
            used: false,
          },
          error: null,
        },
      ]);

      const result = await verifyAuthChallenge(supabase, {
        wallet_id: 'w1',
        challenge_id: 'c1',
        signature: 'abc',
      });
      expect(result.success).toBe(false);
      expect(result.code).toBe('AUTH_EXPIRED');
    });

    it('should reject already-used challenge', async () => {
      const supabase = createSequentialMockSupabase();
      supabase._configure('wallet_auth_challenges', [
        {
          data: {
            id: 'c1',
            wallet_id: 'w1',
            challenge: 'coinpayportal:auth:1234:abcd',
            expires_at: new Date(Date.now() + 300000).toISOString(),
            used: true,
          },
          error: null,
        },
      ]);

      const result = await verifyAuthChallenge(supabase, {
        wallet_id: 'w1',
        challenge_id: 'c1',
        signature: 'abc',
      });
      expect(result.success).toBe(false);
      expect(result.code).toBe('CHALLENGE_USED');
    });

    it('should verify valid signature and return JWT', async () => {
      const keypair = generateTestKeypair();
      const challenge = 'coinpayportal:auth:1234:abcdef1234567890';
      const signature = signMessage(challenge, keypair.privateKey);

      const supabase = createSequentialMockSupabase();
      supabase._configure('wallet_auth_challenges', [
        {
          data: {
            id: 'c1',
            wallet_id: 'w1',
            challenge,
            expires_at: new Date(Date.now() + 300000).toISOString(),
            used: false,
          },
          error: null,
        },
        { data: null, error: null }, // update used=true
      ]);
      supabase._configure('wallets', [
        {
          data: {
            id: 'w1',
            public_key_secp256k1: keypair.publicKeyHex,
            public_key_ed25519: null,
            status: 'active',
          },
          error: null,
        },
      ]);

      const result = await verifyAuthChallenge(supabase, {
        wallet_id: 'w1',
        challenge_id: 'c1',
        signature,
      });

      expect(result.success).toBe(true);
      expect(result.data?.wallet_id).toBe('w1');
      expect(result.data?.auth_token).toBeTruthy();
      // Verify it's a valid JWT (three parts)
      expect((result.data?.auth_token as string).split('.')).toHaveLength(3);
    });

    it('should reject invalid signature', async () => {
      const keypair = generateTestKeypair();
      const challenge = 'coinpayportal:auth:1234:abcdef1234567890';
      // Sign with wrong message
      const signature = signMessage('wrong-message', keypair.privateKey);

      const supabase = createSequentialMockSupabase();
      supabase._configure('wallet_auth_challenges', [
        {
          data: {
            id: 'c1',
            wallet_id: 'w1',
            challenge,
            expires_at: new Date(Date.now() + 300000).toISOString(),
            used: false,
          },
          error: null,
        },
      ]);
      supabase._configure('wallets', [
        {
          data: {
            id: 'w1',
            public_key_secp256k1: keypair.publicKeyHex,
            public_key_ed25519: null,
            status: 'active',
          },
          error: null,
        },
      ]);

      const result = await verifyAuthChallenge(supabase, {
        wallet_id: 'w1',
        challenge_id: 'c1',
        signature,
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_SIGNATURE');
    });
  });
});
