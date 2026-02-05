/**
 * Escrow Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createEscrow,
  getEscrow,
  getEscrowEvents,
  listEscrows,
  releaseEscrow,
  refundEscrow,
  disputeEscrow,
  markEscrowFunded,
  markEscrowSettled,
  expireStaleEscrows,
} from './service';

// ── Mock Setup ──────────────────────────────────────────────

// Mock system wallet
vi.mock('../wallets/system-wallet', () => ({
  deriveSystemPaymentAddress: vi.fn().mockResolvedValue({
    address: '0xEscrowAddress1234567890abcdef',
    privateKey: 'mock-private-key-hex',
    derivationPath: "m/44'/60'/0'/0/0",
  }),
  getCommissionWallet: vi.fn().mockReturnValue('0xCommissionWallet'),
  getCommissionRate: vi.fn().mockReturnValue(0.01),
  generatePaymentAddress: vi.fn(),
  getFeePercentage: vi.fn().mockReturnValue(0.01),
}));

vi.mock('../crypto/encryption', () => ({
  encrypt: vi.fn().mockResolvedValue('encrypted-private-key'),
  decrypt: vi.fn().mockResolvedValue('mock-private-key-hex'),
}));

vi.mock('../rates/tatum', () => ({
  getCryptoPrice: vi.fn().mockResolvedValue(3000), // $3000 per ETH
}));

vi.mock('../webhooks/service', () => ({
  sendEscrowWebhook: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../payments/fees', () => ({
  getFeePercentage: vi.fn().mockReturnValue(0.01),
}));

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: () => 'mock-uuid-1234',
});

// Mock process.env
vi.stubEnv('ENCRYPTION_KEY', 'test-encryption-key-0123456789abcdef');

function createMockSupabase(overrides: Record<string, any> = {}) {
  const defaultEscrow = {
    id: 'esc-uuid-1',
    depositor_address: '0xDepositor123',
    beneficiary_address: '0xBeneficiary456',
    arbiter_address: null,
    escrow_address_id: 'addr-uuid-1',
    escrow_address: '0xEscrowAddress1234567890abcdef',
    chain: 'ETH',
    amount: 1.0,
    amount_usd: 3000,
    fee_amount: 0.01,
    deposited_amount: null,
    status: 'created',
    deposit_tx_hash: null,
    settlement_tx_hash: null,
    fee_tx_hash: null,
    metadata: { job: 'test gig' },
    dispute_reason: null,
    dispute_resolution: null,
    release_token: 'esc_release123',
    beneficiary_token: 'esc_benef456',
    business_id: null,
    created_at: '2026-02-05T00:00:00Z',
    funded_at: null,
    released_at: null,
    settled_at: null,
    disputed_at: null,
    refunded_at: null,
    expires_at: '2026-02-06T00:00:00Z',
    updated_at: '2026-02-05T00:00:00Z',
  };

  const mockChain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: overrides.singleData ?? defaultEscrow, error: null }),
  };

  return {
    from: vi.fn((table: string) => {
      if (overrides[table]) return overrides[table];
      return mockChain;
    }),
    _mockChain: mockChain,
    _defaultEscrow: defaultEscrow,
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('Escrow Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createEscrow', () => {
    it('should validate required fields', async () => {
      const supabase = createMockSupabase() as any;
      const result = await createEscrow(supabase, {
        chain: 'ETH',
        amount: -1,
        depositor_address: '0xDepositor123',
        beneficiary_address: '0xBeneficiary456',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Amount must be greater than zero');
    });

    it('should reject same depositor and beneficiary', async () => {
      const supabase = createMockSupabase() as any;
      const result = await createEscrow(supabase, {
        chain: 'ETH',
        amount: 1.0,
        depositor_address: '0xSameAddress123',
        beneficiary_address: '0xSameAddress123',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('different addresses');
    });

    it('should reject short addresses', async () => {
      const supabase = createMockSupabase() as any;
      const result = await createEscrow(supabase, {
        chain: 'ETH',
        amount: 1.0,
        depositor_address: 'short',
        beneficiary_address: '0xBeneficiary456',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid depositor address');
    });

    it('should create escrow with valid input', async () => {
      const insertedEscrow = {
        id: 'new-escrow-id',
        depositor_address: '0xDepositor123456',
        beneficiary_address: '0xBeneficiary789012',
        escrow_address: '0xEscrowAddress1234567890abcdef',
        chain: 'ETH',
        amount: 1.0,
        amount_usd: 3000,
        fee_amount: 0.01,
        status: 'created',
        metadata: {},
        release_token: 'esc_test',
        beneficiary_token: 'esc_test2',
        created_at: '2026-02-05T00:00:00Z',
        expires_at: '2026-02-06T00:00:00Z',
        updated_at: '2026-02-05T00:00:00Z',
        escrow_address_id: null,
        arbiter_address: null,
        deposited_amount: null,
        deposit_tx_hash: null,
        settlement_tx_hash: null,
        fee_tx_hash: null,
        dispute_reason: null,
        dispute_resolution: null,
        business_id: null,
        funded_at: null,
        released_at: null,
        settled_at: null,
        disputed_at: null,
        refunded_at: null,
      };

      // Track which table is being called to return appropriate data
      const supabase = {
        from: vi.fn((table: string) => {
          const chain: any = {};
          chain.select = vi.fn().mockReturnValue(chain);
          chain.insert = vi.fn().mockReturnValue(chain);
          chain.update = vi.fn().mockReturnValue(chain);
          chain.eq = vi.fn().mockReturnValue(chain);
          chain.single = vi.fn();

          if (table === 'system_wallet_indexes') {
            chain.single.mockResolvedValue({ data: { next_index: 5 }, error: null });
          } else if (table === 'payment_addresses') {
            chain.single.mockResolvedValue({ data: { id: 'addr-1' }, error: null });
          } else if (table === 'escrows') {
            chain.single.mockResolvedValue({ data: insertedEscrow, error: null });
          } else {
            // escrow_events — insert doesn't need single
            chain.single.mockResolvedValue({ data: null, error: null });
          }

          return chain;
        }),
      } as any;

      const result = await createEscrow(supabase, {
        chain: 'ETH',
        amount: 1.0,
        depositor_address: '0xDepositor123456',
        beneficiary_address: '0xBeneficiary789012',
        metadata: { job: 'code review' },
      });

      if (!result.success) {
        console.error('createEscrow failed:', result.error);
      }
      expect(result.success).toBe(true);
      expect(result.escrow).toBeDefined();
      expect(result.escrow!.escrow_address).toBe('0xEscrowAddress1234567890abcdef');
      expect(result.escrow!.status).toBe('created');
      expect(result.escrow!.release_token).toBeDefined();
      expect(result.escrow!.beneficiary_token).toBeDefined();
      // Verify tokens are NOT the internal ones (they're generated fresh)
      expect(result.escrow!.release_token).toMatch(/^esc_/);
      expect(result.escrow!.beneficiary_token).toMatch(/^esc_/);
    });
  });

  describe('releaseEscrow', () => {
    it('should reject invalid release token', async () => {
      const fundedEscrow = {
        id: 'esc-1',
        status: 'funded',
        release_token: 'esc_correct_token',
        beneficiary_token: 'esc_benef',
        depositor_address: '0xDep',
        beneficiary_address: '0xBen',
      };

      const supabase = createMockSupabase({ singleData: fundedEscrow }) as any;
      const result = await releaseEscrow(supabase, 'esc-1', 'wrong_token');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unauthorized');
    });

    it('should reject release on non-funded escrow', async () => {
      const createdEscrow = {
        id: 'esc-1',
        status: 'created',
        release_token: 'esc_correct',
        beneficiary_token: 'esc_benef',
        depositor_address: '0xDep',
        beneficiary_address: '0xBen',
      };

      const supabase = createMockSupabase({ singleData: createdEscrow }) as any;
      const result = await releaseEscrow(supabase, 'esc-1', 'esc_correct');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot release');
    });

    it('should release funded escrow with correct token', async () => {
      const fundedEscrow = {
        id: 'esc-1',
        status: 'funded',
        release_token: 'esc_correct',
        beneficiary_token: 'esc_benef',
        depositor_address: '0xDepositor12345',
        beneficiary_address: '0xBeneficiary67890',
        deposited_amount: 1.0,
        amount: 1.0,
        escrow_address: '0xEscrow',
        chain: 'ETH',
      };

      const releasedEscrow = { ...fundedEscrow, status: 'released', released_at: new Date().toISOString() };

      let callCount = 0;
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.resolve({ data: fundedEscrow, error: null });
          if (callCount === 2) return Promise.resolve({ data: releasedEscrow, error: null });
          return Promise.resolve({ data: null, error: null });
        }),
      };

      const supabase = { from: vi.fn(() => mockChain) } as any;
      const result = await releaseEscrow(supabase, 'esc-1', 'esc_correct');

      expect(result.success).toBe(true);
      expect(result.escrow?.status).toBe('released');
    });
  });

  describe('refundEscrow', () => {
    it('should reject refund on non-funded escrow', async () => {
      const escrow = {
        id: 'esc-1',
        status: 'released',
        release_token: 'esc_tok',
        beneficiary_token: 'esc_ben',
      };

      const supabase = createMockSupabase({ singleData: escrow }) as any;
      const result = await refundEscrow(supabase, 'esc-1', 'esc_tok');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot refund');
    });
  });

  describe('disputeEscrow', () => {
    it('should require reason of at least 10 chars', async () => {
      const fundedEscrow = {
        id: 'esc-1',
        status: 'funded',
        release_token: 'esc_tok',
        beneficiary_token: 'esc_ben',
      };

      const supabase = createMockSupabase({ singleData: fundedEscrow }) as any;
      const result = await disputeEscrow(supabase, 'esc-1', 'esc_tok', 'short');

      expect(result.success).toBe(false);
      expect(result.error).toContain('at least 10 characters');
    });

    it('should allow beneficiary to dispute', async () => {
      const fundedEscrow = {
        id: 'esc-1',
        status: 'funded',
        release_token: 'esc_dep_tok',
        beneficiary_token: 'esc_ben_tok',
        depositor_address: '0xDepositor12345',
        beneficiary_address: '0xBeneficiary67890',
      };

      const disputedEscrow = { ...fundedEscrow, status: 'disputed' };

      let callCount = 0;
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.resolve({ data: fundedEscrow, error: null });
          if (callCount === 2) return Promise.resolve({ data: disputedEscrow, error: null });
          return Promise.resolve({ data: null, error: null });
        }),
      };

      const supabase = { from: vi.fn(() => mockChain) } as any;
      const result = await disputeEscrow(
        supabase, 'esc-1', 'esc_ben_tok',
        'Work was not delivered as described in the agreement'
      );

      expect(result.success).toBe(true);
      expect(result.escrow?.status).toBe('disputed');
    });
  });

  describe('markEscrowFunded', () => {
    it('should mark escrow as funded', async () => {
      const fundedEscrow = {
        id: 'esc-1',
        status: 'funded',
        deposited_amount: 1.0,
        deposit_tx_hash: '0xtx123',
        escrow_address: '0xEscrow',
        chain: 'ETH',
        amount: 1.0,
        depositor_address: '0xDep',
        beneficiary_address: '0xBen',
      };

      let callCount = 0;
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.resolve({ data: fundedEscrow, error: null });
          return Promise.resolve({ data: null, error: null });
        }),
      };

      const supabase = { from: vi.fn(() => mockChain) } as any;
      const result = await markEscrowFunded(supabase, 'esc-1', 1.0, '0xtx123');

      expect(result.success).toBe(true);
      expect(result.escrow?.status).toBe('funded');
    });
  });

  describe('markEscrowSettled', () => {
    it('should mark escrow as settled', async () => {
      const settledEscrow = {
        id: 'esc-1',
        status: 'settled',
        settlement_tx_hash: '0xsettle123',
        fee_tx_hash: '0xfee123',
        escrow_address: '0xEscrow',
        chain: 'ETH',
        amount: 1.0,
        depositor_address: '0xDep',
        beneficiary_address: '0xBen',
      };

      let callCount = 0;
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.resolve({ data: settledEscrow, error: null });
          return Promise.resolve({ data: null, error: null });
        }),
      };

      const supabase = { from: vi.fn(() => mockChain) } as any;
      const result = await markEscrowSettled(supabase, 'esc-1', '0xsettle123', '0xfee123');

      expect(result.success).toBe(true);
      expect(result.escrow?.status).toBe('settled');
    });
  });

  describe('expireStaleEscrows', () => {
    it('should expire unfunded escrows past deadline', async () => {
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      // Make select return array of expired escrows
      mockChain.select.mockReturnValueOnce(
        Promise.resolve({ data: [{ id: 'esc-1' }, { id: 'esc-2' }], error: null })
      );

      const supabase = { from: vi.fn(() => mockChain) } as any;
      const result = await expireStaleEscrows(supabase);

      expect(result.expired).toBe(2);
    });
  });

  describe('getEscrow', () => {
    it('should return public escrow without tokens', async () => {
      const escrow = {
        id: 'esc-1',
        status: 'funded',
        release_token: 'secret_release',
        beneficiary_token: 'secret_benef',
        escrow_address_id: 'addr-1',
        depositor_address: '0xDep1234567890',
        beneficiary_address: '0xBen1234567890',
        escrow_address: '0xEsc1234567890',
        chain: 'ETH',
        amount: 1.0,
      };

      const supabase = createMockSupabase({ singleData: escrow }) as any;
      const result = await getEscrow(supabase, 'esc-1');

      expect(result.success).toBe(true);
      expect(result.escrow).toBeDefined();
      // Tokens must NOT be exposed
      expect((result.escrow as any).release_token).toBeUndefined();
      expect((result.escrow as any).beneficiary_token).toBeUndefined();
      expect((result.escrow as any).escrow_address_id).toBeUndefined();
    });
  });
});
