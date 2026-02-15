import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ──────────────────────────────────────────────
// Mock Supabase
// ──────────────────────────────────────────────

const mockSingle = vi.fn();
const mockChain: any = {};
['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'range'].forEach((m) => {
  mockChain[m] = vi.fn().mockReturnValue(mockChain);
});
mockChain.single = mockSingle;

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => mockChain),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  })),
}));

// ──────────────────────────────────────────────
// Mock Greenlight Service
// ──────────────────────────────────────────────

const mockProvisionNode = vi.fn();
const mockGetNode = vi.fn();
const mockCreateOffer = vi.fn();
const mockGetOffer = vi.fn();
const mockListOffers = vi.fn();
const mockListPayments = vi.fn();
const mockGetPaymentStatus = vi.fn();
const mockRecordPayment = vi.fn();

vi.mock('@/lib/lightning/greenlight', () => ({
  getGreenlightService: () => ({
    provisionNode: mockProvisionNode,
    getNode: mockGetNode,
    createOffer: mockCreateOffer,
    getOffer: mockGetOffer,
    listOffers: mockListOffers,
    listPayments: mockListPayments,
    getPaymentStatus: mockGetPaymentStatus,
    recordPayment: mockRecordPayment,
  }),
  GreenlightService: vi.fn(),
}));

// ──────────────────────────────────────────────
// Mock wallet keys
// ──────────────────────────────────────────────

vi.mock('@/lib/web-wallet/keys', () => ({
  mnemonicToSeed: vi.fn(() => Buffer.alloc(64, 0xaa).toString('hex')),
  isValidMnemonic: vi.fn((m: string) => m && m.split(' ').length >= 12),
}));

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeRequest(url: string, options?: RequestInit) {
  return new NextRequest(new URL(url, 'http://localhost:3000'), options);
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('Lightning Route Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  });

  // ────────────────────────────────────
  // POST /api/lightning/nodes
  // ────────────────────────────────────

  describe('POST /api/lightning/nodes', () => {
    it('should return 400 if wallet_id missing', async () => {
      const { POST } = await import('./nodes/route');
      const req = makeRequest('http://localhost:3000/api/lightning/nodes', {
        method: 'POST',
        body: JSON.stringify({ mnemonic: 'valid' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 if mnemonic invalid', async () => {
      const { POST } = await import('./nodes/route');
      const req = makeRequest('http://localhost:3000/api/lightning/nodes', {
        method: 'POST',
        body: JSON.stringify({ wallet_id: 'w-1', mnemonic: 'bad' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
    });

    it('should provision node on valid input', async () => {
      const { POST } = await import('./nodes/route');
      const fakeNode = { id: 'node-1', status: 'active', wallet_id: 'w-1' };
      mockProvisionNode.mockResolvedValue(fakeNode);

      const req = makeRequest('http://localhost:3000/api/lightning/nodes', {
        method: 'POST',
        body: JSON.stringify({
          wallet_id: 'w-1',
          business_id: 'b-1',
          mnemonic: 'valid mnemonic phrase here twelve words okay test banana apple cherry dog elephant fox',
        }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.node).toEqual(fakeNode);
    });
  });

  // ────────────────────────────────────
  // GET /api/lightning/nodes/:id
  // ────────────────────────────────────

  describe('GET /api/lightning/nodes/:id', () => {
    it('should return node on success', async () => {
      const { GET } = await import('./nodes/[id]/route');
      const fakeNode = { id: 'node-1', status: 'active' };
      mockGetNode.mockResolvedValue(fakeNode);

      const req = makeRequest('http://localhost:3000/api/lightning/nodes/node-1');
      const res = await GET(req, { params: Promise.resolve({ id: 'node-1' }) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.node).toEqual(fakeNode);
    });

    it('should return 404 if node not found', async () => {
      const { GET } = await import('./nodes/[id]/route');
      mockGetNode.mockResolvedValue(null);

      const req = makeRequest('http://localhost:3000/api/lightning/nodes/bad');
      const res = await GET(req, { params: Promise.resolve({ id: 'bad' }) });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.success).toBe(false);
    });
  });

  // ────────────────────────────────────
  // POST /api/lightning/offers
  // ────────────────────────────────────

  describe('POST /api/lightning/offers', () => {
    it('should return 400 if node_id missing', async () => {
      const { POST } = await import('./offers/route');
      const req = makeRequest('http://localhost:3000/api/lightning/offers', {
        method: 'POST',
        body: JSON.stringify({ description: 'test' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 if description missing', async () => {
      const { POST } = await import('./offers/route');
      const req = makeRequest('http://localhost:3000/api/lightning/offers', {
        method: 'POST',
        body: JSON.stringify({ node_id: 'n1' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
    });

    it('should create offer on valid input', async () => {
      const { POST } = await import('./offers/route');
      const fakeOffer = { id: 'o-1', bolt12_offer: 'lno1abc', status: 'active' };
      mockCreateOffer.mockResolvedValue(fakeOffer);

      const req = makeRequest('http://localhost:3000/api/lightning/offers', {
        method: 'POST',
        body: JSON.stringify({
          node_id: 'n1',
          description: 'Coffee',
          amount_msat: 100000,
          mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.data.offer).toEqual(fakeOffer);
    });
  });

  // ────────────────────────────────────
  // GET /api/lightning/offers/:id
  // ────────────────────────────────────

  describe('GET /api/lightning/offers/:id', () => {
    it('should return offer with qr_uri', async () => {
      const { GET } = await import('./offers/[id]/route');
      const fakeOffer = { id: 'o-1', bolt12_offer: 'lno1abc', status: 'active' };
      mockGetOffer.mockResolvedValue(fakeOffer);

      const req = makeRequest('http://localhost:3000/api/lightning/offers/o-1');
      const res = await GET(req, { params: Promise.resolve({ id: 'o-1' }) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.offer).toEqual(fakeOffer);
      expect(body.data.qr_uri).toBe('lightning:lno1abc');
    });

    it('should return 404 if offer not found', async () => {
      const { GET } = await import('./offers/[id]/route');
      mockGetOffer.mockResolvedValue(null);

      const req = makeRequest('http://localhost:3000/api/lightning/offers/bad');
      const res = await GET(req, { params: Promise.resolve({ id: 'bad' }) });

      expect(res.status).toBe(404);
    });
  });

  // ────────────────────────────────────
  // GET /api/lightning/offers
  // ────────────────────────────────────

  describe('GET /api/lightning/offers', () => {
    it('should list offers with pagination', async () => {
      const { GET } = await import('./offers/route');
      mockListOffers.mockResolvedValue({
        offers: [{ id: 'o-1' }, { id: 'o-2' }],
        total: 2,
      });

      const req = makeRequest('http://localhost:3000/api/lightning/offers?business_id=b1&limit=10&offset=0');
      const res = await GET(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.offers).toHaveLength(2);
      expect(body.data.total).toBe(2);
    });
  });

  // ────────────────────────────────────
  // GET /api/lightning/payments
  // ────────────────────────────────────

  describe('GET /api/lightning/payments', () => {
    it('should list payments', async () => {
      const { GET } = await import('./payments/route');
      mockListPayments.mockResolvedValue({
        payments: [{ id: 'p-1', status: 'settled' }],
        total: 1,
      });

      const req = makeRequest('http://localhost:3000/api/lightning/payments?node_id=n1');
      const res = await GET(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.payments).toHaveLength(1);
    });

    it('should return empty list when no payments', async () => {
      const { GET } = await import('./payments/route');
      mockListPayments.mockResolvedValue({ payments: [], total: 0 });

      const req = makeRequest('http://localhost:3000/api/lightning/payments');
      const res = await GET(req);
      const body = await res.json();

      expect(body.data.payments).toHaveLength(0);
    });
  });

  // ────────────────────────────────────
  // GET /api/lightning/payments/:hash
  // ────────────────────────────────────

  describe('GET /api/lightning/payments/:hash', () => {
    it('should return payment by hash', async () => {
      const { GET } = await import('./payments/[hash]/route');
      const fakePayment = { id: 'p-1', payment_hash: 'abc123', status: 'settled' };
      mockGetPaymentStatus.mockResolvedValue(fakePayment);

      const req = makeRequest('http://localhost:3000/api/lightning/payments/abc123');
      const res = await GET(req, { params: Promise.resolve({ hash: 'abc123' }) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.payment).toEqual(fakePayment);
    });

    it('should return 404 if payment not found', async () => {
      const { GET } = await import('./payments/[hash]/route');
      mockGetPaymentStatus.mockResolvedValue(null);

      const req = makeRequest('http://localhost:3000/api/lightning/payments/bad');
      const res = await GET(req, { params: Promise.resolve({ hash: 'bad' }) });

      expect(res.status).toBe(404);
    });
  });
});
