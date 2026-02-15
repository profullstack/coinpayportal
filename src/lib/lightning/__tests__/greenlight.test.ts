// TODO: fix mocks — provisionNode needs GL_NOBODY_CRT/GL_NOBODY_KEY env, createOffer needs deeper cert mocking
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deriveLnNodeKeys, GreenlightService } from '../greenlight';

// ──────────────────────────────────────────────
// Mock Supabase
// ──────────────────────────────────────────────

const mockSingle = vi.fn();
const mockSubscribe = vi.fn().mockReturnValue({ id: 'channel-1' });
const mockOn = vi.fn().mockReturnValue({ subscribe: mockSubscribe });

const mockChain: any = {};
['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'range'].forEach((m) => {
  mockChain[m] = vi.fn().mockReturnValue(mockChain);
});
mockChain.single = mockSingle;
mockChain.maybeSingle = vi.fn().mockReturnValue(mockChain);

// For listOffers/listPayments — chain needs count support
let mockCount: number | null = 0;
let mockData: any[] | null = [];
let mockError: any = null;

// Override select to capture count option and return chain
const originalSelect = mockChain.select;

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => mockChain),
    channel: vi.fn(() => ({ on: mockOn })),
    removeChannel: vi.fn(),
  })),
}));

// ──────────────────────────────────────────────
// deriveLnNodeKeys
// ──────────────────────────────────────────────

describe('deriveLnNodeKeys', () => {
  it('should derive deterministic keys from a seed', () => {
    const seed = Buffer.alloc(64, 0xab);
    const result = deriveLnNodeKeys(seed);

    expect(result.nodeSeed).toBeInstanceOf(Buffer);
    expect(result.nodeSeed.length).toBe(32);
    expect(result.nodePublicKey).toBeTruthy();
    expect(typeof result.nodePublicKey).toBe('string');
  });

  it('should return the same keys for the same seed', () => {
    const seed = Buffer.alloc(64, 0xcd);
    const result1 = deriveLnNodeKeys(seed);
    const result2 = deriveLnNodeKeys(seed);

    expect(result1.nodeSeed.toString('hex')).toBe(result2.nodeSeed.toString('hex'));
    expect(result1.nodePublicKey).toBe(result2.nodePublicKey);
  });

  it('should return different keys for different seeds', () => {
    const seed1 = Buffer.alloc(64, 0x01);
    const seed2 = Buffer.alloc(64, 0x02);
    const result1 = deriveLnNodeKeys(seed1);
    const result2 = deriveLnNodeKeys(seed2);

    expect(result1.nodePublicKey).not.toBe(result2.nodePublicKey);
  });
});

// ──────────────────────────────────────────────
// GreenlightService
// ──────────────────────────────────────────────

describe('GreenlightService', () => {
  let service: GreenlightService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    service = new GreenlightService();
  });

  // ──────────────────────────────────────────
  // provisionNode
  // ──────────────────────────────────────────

  describe('provisionNode', () => {
    beforeEach(() => {
      vi.stubEnv('GL_NOBODY_CRT', 'fake');
      vi.stubEnv('GL_NOBODY_KEY', 'fake');
      vi.spyOn(GreenlightService.prototype as any, 'callBridge').mockResolvedValue({
        node_id: 'gl-abc123',
        creds: 'fakecreds',
        rune: 'fakerune',
      });
    });

    it('should provision a node and return it', async () => {
      const fakeNode = {
        id: 'node-1',
        wallet_id: 'w-1',
        business_id: 'b-1',
        greenlight_node_id: 'gl-abc123',
        node_pubkey: '02abc...',
        status: 'active',
      };
      // First call: maybeSingle for existing check returns null
      mockChain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      mockSingle.mockResolvedValue({ data: fakeNode, error: null });

      const result = await service.provisionNode({
        wallet_id: 'w-1',
        business_id: 'b-1',
        seed: Buffer.alloc(64, 0xaa),
      });

      expect(result).toEqual(fakeNode);
      expect(mockChain.insert).toHaveBeenCalledTimes(1);
      expect(mockChain.select).toHaveBeenCalled();
    });

    it('should provision without business_id', async () => {
      const fakeNode = {
        id: 'node-2',
        wallet_id: 'w-2',
        business_id: null,
        status: 'active',
      };
      mockChain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      mockSingle.mockResolvedValue({ data: fakeNode, error: null });

      const result = await service.provisionNode({
        wallet_id: 'w-2',
        seed: Buffer.alloc(64, 0xbb),
      });

      expect(result.business_id).toBeNull();
    });

    it('should throw on supabase error', async () => {
      mockChain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'duplicate key' },
      });

      await expect(
        service.provisionNode({
          wallet_id: 'w-1',
          seed: Buffer.alloc(64, 0xaa),
        })
      ).rejects.toThrow('Failed to provision node: duplicate key');
    });
  });

  // ──────────────────────────────────────────
  // createOffer
  // ──────────────────────────────────────────

  describe('createOffer', () => {
    beforeEach(() => {
      vi.spyOn(GreenlightService.prototype as any, 'callBridge').mockResolvedValue({
        bolt12: 'lno1test...',
      });
    });

    it('should create an offer for an active node', async () => {
      // First call: getNode (via .single())
      mockSingle.mockResolvedValueOnce({
        data: { id: 'node-1', status: 'active', node_pubkey: '02abc', business_id: 'b-1' },
        error: null,
      });
      // Second call: insert offer
      const fakeOffer = {
        id: 'offer-1',
        node_id: 'node-1',
        bolt12_offer: 'lno1...',
        description: 'Test offer',
        status: 'active',
      };
      mockSingle.mockResolvedValueOnce({ data: fakeOffer, error: null });

      const result = await service.createOffer({
        node_id: 'node-1',
        description: 'Test offer',
        seed: Buffer.alloc(64, 0xcc),
      });

      expect(result).toEqual(fakeOffer);
    });

    it('should throw if node not found', async () => {
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'not found' },
      });

      await expect(
        service.createOffer({ node_id: 'bad-id', description: 'test', seed: Buffer.alloc(64, 0xcc) })
      ).rejects.toThrow('Node not found');
    });

    it('should throw if node is not active', async () => {
      mockSingle.mockResolvedValueOnce({
        data: { id: 'node-1', status: 'inactive', node_pubkey: '02abc' },
        error: null,
      });

      await expect(
        service.createOffer({ node_id: 'node-1', description: 'test', seed: Buffer.alloc(64, 0xcc) })
      ).rejects.toThrow('Node is not active');
    });

    it('should throw on supabase insert error', async () => {
      mockSingle.mockResolvedValueOnce({
        data: { id: 'node-1', status: 'active', node_pubkey: '02abc' },
        error: null,
      });
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'insert failed' },
      });

      await expect(
        service.createOffer({ node_id: 'node-1', description: 'test', seed: Buffer.alloc(64, 0xcc) })
      ).rejects.toThrow('Failed to create offer: insert failed');
    });
  });

  // ──────────────────────────────────────────
  // getPaymentStatus
  // ──────────────────────────────────────────

  describe('getPaymentStatus', () => {
    it('should return payment when found', async () => {
      const fakePayment = {
        id: 'pay-1',
        payment_hash: 'abc123',
        status: 'settled',
        amount_msat: 100000,
      };
      mockSingle.mockResolvedValue({ data: fakePayment, error: null });

      const result = await service.getPaymentStatus('abc123');
      expect(result).toEqual(fakePayment);
      expect(mockChain.eq).toHaveBeenCalledWith('payment_hash', 'abc123');
    });

    it('should return null when not found', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });

      const result = await service.getPaymentStatus('nonexistent');
      expect(result).toBeNull();
    });

    it('should return payment with pending status', async () => {
      const fakePayment = {
        id: 'pay-2',
        payment_hash: 'def456',
        status: 'pending',
        amount_msat: 50000,
      };
      mockSingle.mockResolvedValue({ data: fakePayment, error: null });

      const result = await service.getPaymentStatus('def456');
      expect(result?.status).toBe('pending');
    });

    it('should return payment with failed status', async () => {
      const fakePayment = {
        id: 'pay-3',
        payment_hash: 'ghi789',
        status: 'failed',
        amount_msat: 75000,
      };
      mockSingle.mockResolvedValue({ data: fakePayment, error: null });

      const result = await service.getPaymentStatus('ghi789');
      expect(result?.status).toBe('failed');
    });
  });

  // ──────────────────────────────────────────
  // listPayments
  // ──────────────────────────────────────────

  describe('listPayments', () => {
    it('should list payments with default pagination', async () => {
      // For non-single queries, mock the chain resolution
      Object.defineProperty(mockChain, 'then', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      // listPayments doesn't call .single(), it awaits the query directly
      // We need to make the chain resolve when awaited
      mockChain.range = vi.fn().mockResolvedValue({
        data: [{ id: 'p1' }, { id: 'p2' }],
        error: null,
        count: 2,
      });

      const result = await service.listPayments({});
      expect(result.payments).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should filter by node_id', async () => {
      mockChain.range = vi.fn().mockResolvedValue({
        data: [{ id: 'p1', node_id: 'n1' }],
        error: null,
        count: 1,
      });

      const result = await service.listPayments({ node_id: 'n1' });
      expect(mockChain.eq).toHaveBeenCalledWith('node_id', 'n1');
      expect(result.payments).toHaveLength(1);
    });

    it('should filter by business_id and offer_id', async () => {
      mockChain.range = vi.fn().mockResolvedValue({
        data: [],
        error: null,
        count: 0,
      });

      const result = await service.listPayments({
        business_id: 'b1',
        offer_id: 'o1',
      });
      expect(result.payments).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should apply pagination', async () => {
      mockChain.range = vi.fn().mockResolvedValue({
        data: [{ id: 'p3' }],
        error: null,
        count: 10,
      });

      await service.listPayments({ limit: 1, offset: 2 });
      expect(mockChain.range).toHaveBeenCalledWith(2, 2);
    });

    it('should throw on query error', async () => {
      mockChain.range = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'query failed' },
        count: null,
      });

      await expect(service.listPayments({})).rejects.toThrow(
        'Failed to list payments: query failed'
      );
    });
  });
});
