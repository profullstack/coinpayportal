/**
 * Reputation Protocol Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateReceipt, verifyReceiptSignatures, generateReceiptFromEscrow } from './receipt-service';
import type { TaskReceipt } from './receipt-service';
import { signData, verifySignature, signCredential, verifyCredentialSignature, hashArtifact } from './crypto';

// Helper to create a valid receipt with correct signatures
function makeReceipt(overrides: Partial<TaskReceipt> = {}): TaskReceipt {
  const base: TaskReceipt = {
    receipt_id: 'test-receipt-001',
    task_id: 'task-001',
    agent_did: 'did:key:agent1',
    buyer_did: 'did:key:buyer1',
    platform_did: 'did:web:coinpayportal.com',
    amount: 50,
    currency: 'SOL',
    category: 'development',
    outcome: 'completed',
    signatures: {},
    ...overrides,
  };
  // Generate valid agent signature
  const data = `${base.receipt_id}:${base.task_id}:${base.agent_did}:${base.buyer_did}:${base.amount}:${base.outcome}`;
  base.signatures = {
    agent: signData(data, base.agent_did),
    buyer: signData(data, base.buyer_did),
    ...overrides.signatures,
  };
  return base;
}

describe('Receipt Validation', () => {
  it('validates a correct receipt', () => {
    const receipt = makeReceipt();
    const result = validateReceipt(receipt);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects receipt with missing fields', () => {
    const result = validateReceipt({ amount: 10 });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid outcome', () => {
    const receipt = makeReceipt({ outcome: 'invalid' as any });
    const result = validateReceipt(receipt);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid outcome: invalid');
  });

  it('rejects negative amount', () => {
    const receipt = makeReceipt({ amount: -5 });
    const result = validateReceipt(receipt);
    expect(result.valid).toBe(false);
  });

  it('rejects receipt with no signatures', () => {
    const result = validateReceipt({
      receipt_id: 'x', task_id: 'x', agent_did: 'x', buyer_did: 'x',
      platform_did: 'x', amount: 1, currency: 'BTC', outcome: 'completed',
      signatures: {},
    });
    expect(result.valid).toBe(false);
  });
});

describe('Receipt Signature Verification', () => {
  it('verifies valid agent signature', () => {
    const receipt = makeReceipt();
    const result = verifyReceiptSignatures(receipt);
    expect(result.valid).toBe(true);
    expect(result.verified).toContain('agent');
  });

  it('verifies both agent and buyer signatures', () => {
    const receipt = makeReceipt();
    const result = verifyReceiptSignatures(receipt);
    expect(result.verified).toContain('agent');
    expect(result.verified).toContain('buyer');
  });

  it('rejects tampered signature', () => {
    const receipt = makeReceipt({ signatures: { agent: 'bad-sig' } });
    const result = verifyReceiptSignatures(receipt);
    expect(result.verified).not.toContain('agent');
  });
});

describe('Duplicate receipt detection', () => {
  it('generates unique receipt IDs from escrow', () => {
    const r1 = generateReceiptFromEscrow({ id: 'esc-1', chain: 'SOL', amount: 1, beneficiary_address: 'addr1', escrow_address: 'addr2' });
    const r2 = generateReceiptFromEscrow({ id: 'esc-2', chain: 'SOL', amount: 1, beneficiary_address: 'addr1', escrow_address: 'addr2' });
    expect(r1.receipt_id).not.toBe(r2.receipt_id);
  });
});

describe('Crypto utilities', () => {
  it('signs and verifies data', () => {
    const sig = signData('hello', 'did:key:test');
    expect(verifySignature('hello', sig, 'did:key:test')).toBe(true);
  });

  it('rejects wrong DID', () => {
    const sig = signData('hello', 'did:key:test');
    expect(verifySignature('hello', sig, 'did:key:other')).toBe(false);
  });

  it('signs and verifies credentials', () => {
    const cred = { agent_did: 'did:key:a', credential_type: 'volume', data: {}, issuer_did: 'did:web:coinpayportal.com' };
    const sig = signCredential(cred);
    expect(verifyCredentialSignature(cred, sig)).toBe(true);
  });

  it('hashes artifacts deterministically', () => {
    expect(hashArtifact('test')).toBe(hashArtifact('test'));
    expect(hashArtifact('test')).not.toBe(hashArtifact('other'));
  });
});

// Mock supabase for integration-style tests
function mockSupabase(receipts: any[] = []) {
  const chainable = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: undefined as any,
  };
  // Make it thenable for queries that don't call .single()
  chainable.then = (resolve: any) => resolve({ data: receipts, error: null });
  // Override order to return proper data
  chainable.order.mockImplementation(() => ({
    ...chainable,
    then: (resolve: any) => resolve({ data: receipts, error: null }),
  }));

  return {
    from: vi.fn().mockReturnValue(chainable),
    _chainable: chainable,
  };
}

describe('Anti-Gaming Detection', () => {
  it('flags circular payments', async () => {
    const { checkAntiGaming } = await import('./anti-gaming');
    
    // We need a more sophisticated mock for circular detection
    const mockSb = {
      from: vi.fn().mockImplementation((table: string) => {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
        };
        
        // Return different data based on query context
        let currentEqs: string[] = [];
        const origEq = chain.eq;
        chain.eq = vi.fn().mockImplementation((col: string, val: string) => {
          currentEqs.push(`${col}=${val}`);
          return chain;
        });

        // Make it resolve based on context
        (chain as any).then = (resolve: any) => {
          const isAgentQuery = currentEqs.some(e => e.startsWith('agent_did='));
          const isBuyerQuery = currentEqs.some(e => e.startsWith('buyer_did='));
          
          if (isAgentQuery && !isBuyerQuery) {
            // Agent's receipts  
            return resolve({
              data: [
                { agent_did: 'did:key:agent1', buyer_did: 'did:key:buyer1', amount: 50, created_at: new Date().toISOString() },
              ],
              error: null
            });
          } else if (isBuyerQuery) {
            // Reverse receipts - agent1 paid buyer1 back
            return resolve({
              data: [{ agent_did: 'did:key:buyer1' }],
              error: null
            });
          }
          return resolve({ data: [], error: null });
        };

        chain.order.mockImplementation(() => {
          const orderChain = { ...chain };
          (orderChain as any).then = (chain as any).then;
          return orderChain;
        });

        return chain;
      }),
    };

    const flags = await checkAntiGaming(mockSb as any, 'did:key:agent1');
    expect(flags.circular_payment).toBe(true);
    expect(flags.flagged).toBe(true);
  });

  it('flags burst activity', async () => {
    const { checkAntiGaming } = await import('./anti-gaming');
    
    const now = new Date();
    const receipts = Array.from({ length: 25 }, (_, i) => ({
      agent_did: 'did:key:agent1',
      buyer_did: `did:key:buyer${i}`,
      amount: 50,
      created_at: now.toISOString(), // all same hour
    }));

    const mockSb = {
      from: vi.fn().mockImplementation(() => {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
        };
        chain.order.mockImplementation(() => ({
          ...chain,
          then: (resolve: any) => resolve({ data: receipts, error: null }),
        }));
        (chain as any).then = (resolve: any) => resolve({ data: receipts, error: null });
        return chain;
      }),
    };

    const flags = await checkAntiGaming(mockSb as any, 'did:key:agent1');
    expect(flags.burst_detected).toBe(true);
  });

  it('flags below economic threshold', async () => {
    const { checkAntiGaming } = await import('./anti-gaming');
    
    const receipts = [
      { agent_did: 'did:key:a', buyer_did: 'did:key:b1', amount: 0.001, created_at: new Date().toISOString() },
      { agent_did: 'did:key:a', buyer_did: 'did:key:b2', amount: 0.002, created_at: new Date().toISOString() },
    ];

    const mockSb = {
      from: vi.fn().mockImplementation(() => {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
        };
        chain.order.mockImplementation(() => ({
          ...chain,
          then: (resolve: any) => resolve({ data: receipts, error: null }),
        }));
        (chain as any).then = (resolve: any) => resolve({ data: receipts, error: null });
        return chain;
      }),
    };

    const flags = await checkAntiGaming(mockSb as any, 'did:key:a');
    expect(flags.below_economic_threshold).toBe(true);
    expect(flags.insufficient_unique_buyers).toBe(true);
  });
});

describe('Credential Verification', () => {
  it('verifies valid credential', () => {
    const cred = {
      agent_did: 'did:key:agent1',
      credential_type: 'volume',
      data: { total_tasks: 10 },
      issuer_did: 'did:web:coinpayportal.com',
    };
    const sig = signCredential(cred);
    expect(verifyCredentialSignature(cred, sig)).toBe(true);
  });

  it('rejects tampered credential', () => {
    const cred = {
      agent_did: 'did:key:agent1',
      credential_type: 'volume',
      data: { total_tasks: 10 },
      issuer_did: 'did:web:coinpayportal.com',
    };
    const sig = signCredential(cred);
    cred.data.total_tasks = 999;
    expect(verifyCredentialSignature(cred, sig)).toBe(false);
  });
});
