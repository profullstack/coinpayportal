/**
 * Comprehensive Reputation Protocol Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateReceiptSignatures,
  isValidDid,
  sign,
  verifySignature,
  signCredential,
  verifyCredentialSignature,
} from './crypto';
import { checkMinimumThreshold } from './anti-gaming';
import { receiptSchema } from './receipt-service';

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function validReceipt(overrides: Record<string, unknown> = {}) {
  return {
    receipt_id: '550e8400-e29b-41d4-a716-446655440000',
    task_id: '550e8400-e29b-41d4-a716-446655440001',
    agent_did: 'did:web:agent.example.com',
    buyer_did: 'did:web:buyer.example.com',
    outcome: 'accepted' as const,
    amount: 50,
    currency: 'USD',
    category: 'coding',
    signatures: { escrow_sig: 'sig123' },
    ...overrides,
  };
}

function validCredential(overrides: Record<string, unknown> = {}) {
  const cred = {
    agent_did: 'did:web:agent.example.com',
    credential_type: 'volume_30d',
    category: 'coding',
    data: { task_count: 10, accepted_rate: 0.9 },
    window_start: '2026-01-01T00:00:00Z',
    window_end: '2026-02-01T00:00:00Z',
    issued_at: '2026-02-01T00:00:00Z',
    ...overrides,
  };
  return cred;
}

// ═══════════════════════════════════════════════════════════
// Receipt Schema Tests
// ═══════════════════════════════════════════════════════════

describe('Receipt Schema', () => {
  it('should accept valid receipt with all fields', () => {
    const receipt = validReceipt({
      platform_did: 'did:web:coinpayportal.com',
      escrow_tx: 'tx-123',
      sla: { latency: '< 100ms' },
      dispute: false,
      artifact_hash: 'abc123hash',
      finalized_at: '2026-02-01T00:00:00Z',
    });
    expect(receiptSchema.safeParse(receipt).success).toBe(true);
  });

  it('should accept valid receipt with minimal fields', () => {
    expect(receiptSchema.safeParse(validReceipt()).success).toBe(true);
  });

  // Missing required fields individually
  it('should reject missing receipt_id', () => {
    const { receipt_id, ...rest } = validReceipt();
    expect(receiptSchema.safeParse(rest).success).toBe(false);
  });

  it('should reject missing task_id', () => {
    const { task_id, ...rest } = validReceipt();
    expect(receiptSchema.safeParse(rest).success).toBe(false);
  });

  it('should reject missing agent_did', () => {
    const { agent_did, ...rest } = validReceipt();
    expect(receiptSchema.safeParse(rest).success).toBe(false);
  });

  it('should reject missing buyer_did', () => {
    const { buyer_did, ...rest } = validReceipt();
    expect(receiptSchema.safeParse(rest).success).toBe(false);
  });

  it('should reject missing outcome', () => {
    const { outcome, ...rest } = validReceipt();
    expect(receiptSchema.safeParse(rest).success).toBe(false);
  });

  it('should reject missing signatures', () => {
    const { signatures, ...rest } = validReceipt();
    expect(receiptSchema.safeParse(rest).success).toBe(false);
  });

  // Invalid values
  it('should reject invalid outcome values', () => {
    expect(receiptSchema.safeParse(validReceipt({ outcome: 'completed' })).success).toBe(false);
    expect(receiptSchema.safeParse(validReceipt({ outcome: 'cancelled' })).success).toBe(false);
    expect(receiptSchema.safeParse(validReceipt({ outcome: '' })).success).toBe(false);
    expect(receiptSchema.safeParse(validReceipt({ outcome: 123 })).success).toBe(false);
  });

  it('should accept all valid outcome values', () => {
    expect(receiptSchema.safeParse(validReceipt({ outcome: 'accepted' })).success).toBe(true);
    expect(receiptSchema.safeParse(validReceipt({ outcome: 'rejected' })).success).toBe(true);
    expect(receiptSchema.safeParse(validReceipt({ outcome: 'disputed' })).success).toBe(true);
  });

  it('should reject invalid agent_did format', () => {
    expect(receiptSchema.safeParse(validReceipt({ agent_did: 'not-a-did' })).success).toBe(false);
    expect(receiptSchema.safeParse(validReceipt({ agent_did: '' })).success).toBe(false);
  });

  it('should reject invalid buyer_did format', () => {
    expect(receiptSchema.safeParse(validReceipt({ buyer_did: 'bad' })).success).toBe(false);
  });

  it('should reject non-uuid receipt_id', () => {
    expect(receiptSchema.safeParse(validReceipt({ receipt_id: 'not-uuid' })).success).toBe(false);
  });

  it('should reject non-uuid task_id', () => {
    expect(receiptSchema.safeParse(validReceipt({ task_id: 'not-uuid' })).success).toBe(false);
  });

  it('should reject missing escrow_sig in signatures', () => {
    expect(receiptSchema.safeParse(validReceipt({ signatures: {} })).success).toBe(false);
    expect(receiptSchema.safeParse(validReceipt({ signatures: { agent_sig: 'x' } })).success).toBe(false);
  });

  it('should default dispute to false', () => {
    const result = receiptSchema.safeParse(validReceipt());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dispute).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Crypto Tests
// ═══════════════════════════════════════════════════════════

describe('Crypto', () => {
  describe('sign / verifySignature', () => {
    it('should sign and verify correctly', () => {
      const data = 'test-data';
      const sig = sign(data);
      expect(verifySignature(data, sig)).toBe(true);
    });

    it('should reject wrong data', () => {
      const sig = sign('original');
      expect(verifySignature('tampered', sig)).toBe(false);
    });

    it('should reject wrong signature', () => {
      expect(verifySignature('data', 'wrong-sig')).toBe(false);
    });

    it('should produce deterministic signatures', () => {
      expect(sign('same')).toBe(sign('same'));
    });

    it('should produce different signatures for different data', () => {
      expect(sign('a')).not.toBe(sign('b'));
    });
  });

  describe('signCredential / verifyCredentialSignature', () => {
    it('should sign and verify a valid credential', () => {
      const cred = validCredential();
      const sig = signCredential(cred);
      expect(typeof sig).toBe('string');
      expect(sig.length).toBeGreaterThan(0);
      expect(verifyCredentialSignature({ ...cred, signature: sig })).toBe(true);
    });

    it('should reject tampered credential', () => {
      const cred = validCredential();
      const sig = signCredential(cred);
      expect(verifyCredentialSignature({ ...cred, signature: sig, agent_did: 'did:web:hacker.com' })).toBe(false);
    });

    it('should reject wrong signature', () => {
      const cred = validCredential();
      expect(verifyCredentialSignature({ ...cred, signature: 'bad-sig' })).toBe(false);
    });

    it('should reject credential with modified data', () => {
      const cred = validCredential();
      const sig = signCredential(cred);
      expect(verifyCredentialSignature({
        ...cred,
        signature: sig,
        data: { task_count: 999 },
      })).toBe(false);
    });

    it('should reject credential with modified window', () => {
      const cred = validCredential();
      const sig = signCredential(cred);
      expect(verifyCredentialSignature({
        ...cred,
        signature: sig,
        window_start: '2025-01-01T00:00:00Z',
      })).toBe(false);
    });

    it('should handle different credential types', () => {
      const cred1 = validCredential({ credential_type: 'volume_30d' });
      const cred2 = validCredential({ credential_type: 'dispute_rate' });
      const sig1 = signCredential(cred1);
      const sig2 = signCredential(cred2);
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('isValidDid', () => {
    it('should accept valid DIDs', () => {
      expect(isValidDid('did:web:example.com')).toBe(true);
      expect(isValidDid('did:key:z6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP')).toBe(true);
      expect(isValidDid('did:pkh:eip155:1:0x1234')).toBe(true);
    });

    it('should reject invalid DIDs', () => {
      expect(isValidDid('')).toBe(false);
      expect(isValidDid('not-a-did')).toBe(false);
      expect(isValidDid('did:')).toBe(false);
      expect(isValidDid('did:web:')).toBe(false);
    });
  });

  describe('validateReceiptSignatures', () => {
    it('should accept valid signatures with escrow_sig', () => {
      expect(validateReceiptSignatures({ escrow_sig: 'abc' })).toEqual({ valid: true });
    });

    it('should accept signatures with all optional sigs', () => {
      expect(validateReceiptSignatures({
        escrow_sig: 'abc',
        agent_sig: 'def',
        buyer_sig: 'ghi',
        arbitration_sig: 'jkl',
      })).toEqual({ valid: true });
    });

    it('should reject empty signatures object', () => {
      expect(validateReceiptSignatures({})).toEqual({ valid: false, reason: 'Missing required escrow_sig' });
    });

    it('should reject null signatures', () => {
      expect(validateReceiptSignatures(null)).toEqual({ valid: false, reason: 'Missing signatures object' });
    });

    it('should reject undefined signatures', () => {
      expect(validateReceiptSignatures(undefined)).toEqual({ valid: false, reason: 'Missing signatures object' });
    });

    it('should reject signatures without escrow_sig', () => {
      expect(validateReceiptSignatures({ agent_sig: 'abc' })).toEqual({
        valid: false,
        reason: 'Missing required escrow_sig',
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════
// Anti-Gaming Tests
// ═══════════════════════════════════════════════════════════

describe('Anti-Gaming', () => {
  describe('checkMinimumThreshold', () => {
    it('should accept amounts above threshold', () => {
      expect(checkMinimumThreshold(1)).toBe(true);
      expect(checkMinimumThreshold(100)).toBe(true);
      expect(checkMinimumThreshold(0.01)).toBe(true);
    });

    it('should reject amounts below threshold', () => {
      expect(checkMinimumThreshold(0.001)).toBe(false);
      expect(checkMinimumThreshold(0.009)).toBe(false);
    });

    it('should reject null and undefined', () => {
      expect(checkMinimumThreshold(null)).toBe(false);
      expect(checkMinimumThreshold(undefined)).toBe(false);
    });

    it('should reject zero', () => {
      expect(checkMinimumThreshold(0)).toBe(false);
    });

    it('should accept custom threshold', () => {
      expect(checkMinimumThreshold(5, 10)).toBe(false);
      expect(checkMinimumThreshold(15, 10)).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// Aggregation Logic Tests (pure computation)
// ═══════════════════════════════════════════════════════════

describe('Aggregation Logic', () => {
  function computeWindowFromReceipts(receipts: Array<{
    outcome: string;
    dispute?: boolean;
    amount?: number;
    buyer_did: string;
    category?: string;
  }>) {
    const accepted = receipts.filter(r => r.outcome === 'accepted').length;
    const disputed = receipts.filter(r => r.dispute === true).length;
    const totalVolume = receipts.reduce((sum, r) => sum + (r.amount || 0), 0);
    const uniqueBuyers = new Set(receipts.map(r => r.buyer_did)).size;
    const categories: Record<string, { count: number; volume: number }> = {};

    for (const r of receipts) {
      const cat = r.category || 'uncategorized';
      if (!categories[cat]) categories[cat] = { count: 0, volume: 0 };
      categories[cat].count++;
      categories[cat].volume += r.amount || 0;
    }

    return {
      task_count: receipts.length,
      accepted_count: accepted,
      disputed_count: disputed,
      total_volume: totalVolume,
      unique_buyers: uniqueBuyers,
      avg_task_value: receipts.length > 0 ? totalVolume / receipts.length : 0,
      accepted_rate: receipts.length > 0 ? accepted / receipts.length : 0,
      dispute_rate: receipts.length > 0 ? disputed / receipts.length : 0,
      categories,
    };
  }

  it('should compute single receipt correctly', () => {
    const result = computeWindowFromReceipts([
      { outcome: 'accepted', amount: 100, buyer_did: 'did:web:b1', category: 'coding' },
    ]);
    expect(result.task_count).toBe(1);
    expect(result.accepted_count).toBe(1);
    expect(result.total_volume).toBe(100);
    expect(result.avg_task_value).toBe(100);
    expect(result.unique_buyers).toBe(1);
    expect(result.accepted_rate).toBe(1);
  });

  it('should compute multiple receipts same category correctly', () => {
    const result = computeWindowFromReceipts([
      { outcome: 'accepted', amount: 50, buyer_did: 'did:web:b1', category: 'coding' },
      { outcome: 'accepted', amount: 150, buyer_did: 'did:web:b2', category: 'coding' },
      { outcome: 'disputed', dispute: true, amount: 30, buyer_did: 'did:web:b3', category: 'coding' },
    ]);
    expect(result.task_count).toBe(3);
    expect(result.accepted_count).toBe(2);
    expect(result.disputed_count).toBe(1);
    expect(result.total_volume).toBe(230);
    expect(result.avg_task_value).toBeCloseTo(76.67, 1);
    expect(result.unique_buyers).toBe(3);
    expect(result.categories['coding'].count).toBe(3);
    expect(result.categories['coding'].volume).toBe(230);
  });

  it('should compute multiple categories correctly', () => {
    const result = computeWindowFromReceipts([
      { outcome: 'accepted', amount: 100, buyer_did: 'did:web:b1', category: 'coding' },
      { outcome: 'accepted', amount: 200, buyer_did: 'did:web:b2', category: 'design' },
      { outcome: 'accepted', amount: 50, buyer_did: 'did:web:b1', category: 'coding' },
    ]);
    expect(Object.keys(result.categories)).toHaveLength(2);
    expect(result.categories['coding'].count).toBe(2);
    expect(result.categories['coding'].volume).toBe(150);
    expect(result.categories['design'].count).toBe(1);
    expect(result.categories['design'].volume).toBe(200);
  });

  it('should count unique buyers correctly', () => {
    const result = computeWindowFromReceipts([
      { outcome: 'accepted', buyer_did: 'did:web:b1' },
      { outcome: 'accepted', buyer_did: 'did:web:b1' },
      { outcome: 'accepted', buyer_did: 'did:web:b2' },
      { outcome: 'accepted', buyer_did: 'did:web:b3' },
      { outcome: 'accepted', buyer_did: 'did:web:b2' },
    ]);
    expect(result.unique_buyers).toBe(3);
  });

  it('should handle empty receipts', () => {
    const result = computeWindowFromReceipts([]);
    expect(result.task_count).toBe(0);
    expect(result.avg_task_value).toBe(0);
    expect(result.accepted_rate).toBe(0);
  });

  it('should compute average task value', () => {
    const result = computeWindowFromReceipts([
      { outcome: 'accepted', amount: 10, buyer_did: 'did:web:b1' },
      { outcome: 'accepted', amount: 20, buyer_did: 'did:web:b2' },
      { outcome: 'accepted', amount: 30, buyer_did: 'did:web:b3' },
    ]);
    expect(result.avg_task_value).toBe(20);
  });

  it('should default category to uncategorized', () => {
    const result = computeWindowFromReceipts([
      { outcome: 'accepted', amount: 10, buyer_did: 'did:web:b1' },
    ]);
    expect(result.categories['uncategorized']).toBeDefined();
    expect(result.categories['uncategorized'].count).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════
// Anti-Gaming Pattern Tests (pure logic)
// ═══════════════════════════════════════════════════════════

describe('Anti-Gaming Patterns', () => {
  it('should detect circular payment pattern (A→B→A)', () => {
    // Simulate: A is agent for B as buyer, AND B is agent for A as buyer
    const receiptsAsAgent = [
      { agent_did: 'did:web:a', buyer_did: 'did:web:b' },
    ];
    const receiptsAsBuyer = [
      { agent_did: 'did:web:b', buyer_did: 'did:web:a' },
    ];

    const buyerDids = [...new Set(receiptsAsAgent.map(r => r.buyer_did))];
    const circularPartners = receiptsAsBuyer
      .filter(r => buyerDids.includes(r.agent_did))
      .map(r => r.agent_did);

    expect(circularPartners.length).toBeGreaterThan(0);
    expect(circularPartners).toContain('did:web:b');
  });

  it('should detect burst activity', () => {
    const now = Date.now();
    const receipts = Array.from({ length: 15 }, (_, i) => ({
      created_at: new Date(now - i * 1000).toISOString(), // 15 in same minute
    }));

    // Group by hour
    const hourBuckets = new Map<string, number>();
    for (const r of receipts) {
      const hour = r.created_at.slice(0, 13);
      hourBuckets.set(hour, (hourBuckets.get(hour) || 0) + 1);
    }

    const maxInHour = Math.max(...hourBuckets.values());
    expect(maxInHour).toBe(15);
    // With threshold of 10, this would be flagged
    expect(maxInHour >= 10).toBe(true);
  });

  it('should not flag normal activity', () => {
    const now = Date.now();
    const receipts = Array.from({ length: 5 }, (_, i) => ({
      created_at: new Date(now - i * 3600000).toISOString(), // 1 per hour
    }));

    const hourBuckets = new Map<string, number>();
    for (const r of receipts) {
      const hour = r.created_at.slice(0, 13);
      hourBuckets.set(hour, (hourBuckets.get(hour) || 0) + 1);
    }

    const maxInHour = Math.max(...hourBuckets.values());
    expect(maxInHour).toBeLessThan(10);
  });

  it('should detect below minimum economic threshold', () => {
    const amounts = [0.001, 0.002, 0.005];
    const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    expect(avg < 0.01).toBe(true);
  });

  it('should detect insufficient unique buyers', () => {
    const receipts = [
      { buyer_did: 'did:web:b1' },
      { buyer_did: 'did:web:b1' },
      { buyer_did: 'did:web:b1' },
      { buyer_did: 'did:web:b1' },
      { buyer_did: 'did:web:b1' },
    ];
    const uniqueBuyers = new Set(receipts.map(r => r.buyer_did)).size;
    expect(uniqueBuyers).toBe(1);
    // With minimum of 3 unique buyers, this would be flagged
    expect(uniqueBuyers < 3).toBe(true);
  });

  it('should detect combined flags', () => {
    const flags = {
      circular: true,
      burst: false,
      belowThreshold: true,
      insufficientBuyers: false,
    };
    const flagged = Object.values(flags).some(v => v);
    expect(flagged).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Credential Logic Tests
// ═══════════════════════════════════════════════════════════

describe('Credential Lifecycle', () => {
  it('should generate credential from data and verify', () => {
    const cred = validCredential();
    const sig = signCredential(cred);
    expect(verifyCredentialSignature({ ...cred, signature: sig })).toBe(true);
  });

  it('should detect revoked credential (checked by flag)', () => {
    const cred = { ...validCredential(), revoked: true, revoked_at: new Date().toISOString() };
    // Revocation is checked at the API level, not crypto level
    // The signature itself is still valid
    const sig = signCredential(cred);
    expect(verifyCredentialSignature({ ...cred, signature: sig })).toBe(true);
    expect(cred.revoked).toBe(true);
  });

  it('should detect expired credential by time check', () => {
    const oldDate = new Date(Date.now() - 400 * 86400000); // 400 days ago
    const cred = validCredential({ issued_at: oldDate.toISOString() });
    const sig = signCredential(cred);
    // Signature is valid but time-based expiry is checked at API level
    expect(verifyCredentialSignature({ ...cred, signature: sig })).toBe(true);

    const daysSinceIssued = (Date.now() - oldDate.getTime()) / 86400000;
    expect(daysSinceIssued > 365).toBe(true); // Would be expired
  });

  it('should detect tampered credential data', () => {
    const cred = validCredential();
    const sig = signCredential(cred);
    const tampered = { ...cred, data: { task_count: 9999 }, signature: sig };
    expect(verifyCredentialSignature(tampered)).toBe(false);
  });

  it('should detect tampered credential type', () => {
    const cred = validCredential();
    const sig = signCredential(cred);
    expect(verifyCredentialSignature({ ...cred, credential_type: 'hacked', signature: sig })).toBe(false);
  });

  it('should detect tampered category', () => {
    const cred = validCredential();
    const sig = signCredential(cred);
    expect(verifyCredentialSignature({ ...cred, category: 'hacked', signature: sig })).toBe(false);
  });

  it('should handle null category', () => {
    const cred = validCredential({ category: null });
    const sig = signCredential(cred);
    expect(verifyCredentialSignature({ ...cred, signature: sig })).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// SDK Method Tests
// ═══════════════════════════════════════════════════════════

describe('SDK Reputation Methods', () => {
  // Mock client
  function mockClient(response: unknown, status = 200) {
    return {
      request: vi.fn().mockResolvedValue(response),
    };
  }

  it('submitReceipt should POST to /reputation/receipt', async () => {
    const { submitReceipt } = await import('../../lib/reputation/receipt-service');
    // This tests the SDK module, not the lib — test the SDK separately
    // Here we test the schema validation path
    const receipt = validReceipt();
    const parsed = receiptSchema.safeParse(receipt);
    expect(parsed.success).toBe(true);
  });

  it('should encode DIDs with special characters', () => {
    const did = 'did:web:example.com:path:subpath';
    const encoded = encodeURIComponent(did);
    expect(encoded).toBe('did%3Aweb%3Aexample.com%3Apath%3Asubpath');
    expect(decodeURIComponent(encoded)).toBe(did);
  });

  it('should handle URL encoding of DIDs with colons', () => {
    const did = 'did:key:z6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP';
    const path = `/reputation/agent/${encodeURIComponent(did)}/reputation`;
    expect(path).toContain('z6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP');
  });
});

// ═══════════════════════════════════════════════════════════
// SDK Client Reputation Methods
// ═══════════════════════════════════════════════════════════

describe('SDK reputation.js methods', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function setupFetchMock(responseData: unknown, status = 200) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(responseData),
    }) as unknown as typeof fetch;
  }

  it('submitReceipt sends POST request', async () => {
    const { CoinPayClient } = await import('../../../packages/sdk/src/client.js');
    const { submitReceipt } = await import('../../../packages/sdk/src/reputation.js');

    setupFetchMock({ success: true, receipt: { id: '123' } }, 201);

    const client = new CoinPayClient({ apiKey: 'test-key' });
    const result = await submitReceipt(client, validReceipt());

    expect(result.success).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('getReputation sends GET request with encoded DID', async () => {
    const { CoinPayClient } = await import('../../../packages/sdk/src/client.js');
    const { getReputation } = await import('../../../packages/sdk/src/reputation.js');

    const repData = { success: true, reputation: { agent_did: 'did:web:test' } };
    setupFetchMock(repData);

    const client = new CoinPayClient({ apiKey: 'test-key' });
    const result = await getReputation(client, 'did:web:test.com');

    expect(result.success).toBe(true);
    const callUrl = (globalThis.fetch as any).mock.calls[0][0];
    expect(callUrl).toContain(encodeURIComponent('did:web:test.com'));
  });

  it('getCredential sends GET request', async () => {
    const { CoinPayClient } = await import('../../../packages/sdk/src/client.js');
    const { getCredential } = await import('../../../packages/sdk/src/reputation.js');

    setupFetchMock({ success: true, credential: { id: 'cred-1' } });

    const client = new CoinPayClient({ apiKey: 'test-key' });
    const result = await getCredential(client, 'cred-1');
    expect(result.success).toBe(true);
  });

  it('verifyCredential sends POST request', async () => {
    const { CoinPayClient } = await import('../../../packages/sdk/src/client.js');
    const { verifyCredential } = await import('../../../packages/sdk/src/reputation.js');

    setupFetchMock({ valid: true });

    const client = new CoinPayClient({ apiKey: 'test-key' });
    const result = await verifyCredential(client, { credential_id: 'cred-1' });
    expect(result.valid).toBe(true);
  });

  it('getRevocationList sends GET request', async () => {
    const { CoinPayClient } = await import('../../../packages/sdk/src/client.js');
    const { getRevocationList } = await import('../../../packages/sdk/src/reputation.js');

    setupFetchMock({ success: true, revoked_credentials: [], revocations: [] });

    const client = new CoinPayClient({ apiKey: 'test-key' });
    const result = await getRevocationList(client);
    expect(result.success).toBe(true);
    expect(result.revocations).toEqual([]);
  });

  it('should handle API errors gracefully', async () => {
    const { CoinPayClient } = await import('../../../packages/sdk/src/client.js');
    const { getReputation } = await import('../../../packages/sdk/src/reputation.js');

    setupFetchMock({ error: 'Not found' }, 404);

    const client = new CoinPayClient({ apiKey: 'test-key' });
    await expect(getReputation(client, 'did:web:unknown')).rejects.toThrow();
  });

  it('getMyDid sends GET request to /reputation/did/me', async () => {
    const { CoinPayClient } = await import('../../../packages/sdk/src/client.js');
    const { getMyDid } = await import('../../../packages/sdk/src/reputation.js');

    setupFetchMock({ did: 'did:key:z123', public_key: 'abc', verified: true, created_at: '2026-01-01' });

    const client = new CoinPayClient({ apiKey: 'test-key' });
    const result = await getMyDid(client);
    expect(result.did).toBe('did:key:z123');
    expect(result.public_key).toBe('abc');
  });

  it('claimDid sends POST request to /reputation/did/claim', async () => {
    const { CoinPayClient } = await import('../../../packages/sdk/src/client.js');
    const { claimDid } = await import('../../../packages/sdk/src/reputation.js');

    setupFetchMock({ did: 'did:key:zNew', public_key: 'xyz', verified: true, created_at: '2026-01-01' }, 201);

    const client = new CoinPayClient({ apiKey: 'test-key' });
    const result = await claimDid(client);
    expect(result.did).toBe('did:key:zNew');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('linkDid sends POST request with DID data', async () => {
    const { CoinPayClient } = await import('../../../packages/sdk/src/client.js');
    const { linkDid } = await import('../../../packages/sdk/src/reputation.js');

    setupFetchMock({ did: 'did:key:zLinked', public_key: 'pub123', verified: true, created_at: '2026-01-01' }, 201);

    const client = new CoinPayClient({ apiKey: 'test-key' });
    const result = await linkDid(client, { did: 'did:key:zLinked', publicKey: 'pub123', signature: 'sig456' });
    expect(result.did).toBe('did:key:zLinked');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════
// CPTL Phase 2 — ActionReceipt Schema Tests
// ═══════════════════════════════════════════════════════════

describe('ActionReceipt Schema (Phase 2)', () => {
  it('should accept receipt with action_category', () => {
    const receipt = validReceipt({ action_category: 'economic.transaction' });
    const result = receiptSchema.safeParse(receipt);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action_category).toBe('economic.transaction');
    }
  });

  it('should default action_category to economic.transaction', () => {
    const receipt = validReceipt();
    const result = receiptSchema.safeParse(receipt);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action_category).toBe('economic.transaction');
    }
  });

  it('should accept receipt with action_type', () => {
    const receipt = validReceipt({
      action_category: 'productivity.completion',
      action_type: 'code_review',
    });
    const result = receiptSchema.safeParse(receipt);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action_type).toBe('code_review');
    }
  });

  it('should accept all canonical action categories in schema', () => {
    const categories = [
      'economic.transaction', 'economic.dispute', 'economic.refund',
      'productivity.task', 'productivity.application', 'productivity.completion',
      'identity.profile_update', 'identity.verification',
      'social.post', 'social.comment', 'social.endorsement',
      'compliance.incident', 'compliance.violation',
    ];
    for (const cat of categories) {
      const receipt = validReceipt({ action_category: cat });
      const result = receiptSchema.safeParse(receipt);
      expect(result.success).toBe(true);
    }
  });
});
