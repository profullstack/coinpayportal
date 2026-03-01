/**
 * Multisig Escrow Engine Tests
 *
 * Tests the chain-agnostic orchestration layer including:
 * - Creating multisig escrows
 * - Proposing transactions
 * - Collecting signatures
 * - Broadcasting
 * - Dispute flow
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMultisigEscrow,
  proposeTransaction,
  broadcastTransaction,
  disputeMultisigEscrow,
  getMultisigEscrow,
} from './engine';

// ── Mock Setup ──────────────────────────────────────────────

// Mock feature flags
vi.stubEnv('MULTISIG_ESCROW_ENABLED', 'true');
vi.stubEnv('MULTISIG_DEFAULT', 'false');

// Mock EVM adapter
vi.mock('./adapters/evm-safe', () => ({
  evmSafeAdapter: {
    supportedChains: ['ETH', 'POL', 'BASE', 'ARB', 'OP', 'BNB', 'AVAX'],
    createMultisig: vi.fn().mockResolvedValue({
      escrow_address: '0xSafeAddress1234567890abcdef1234567890abcdef',
      chain_metadata: {
        chain_id: 1,
        chain_name: 'Ethereum',
        owners: ['0xDepositor', '0xBeneficiary', '0xArbiter'],
        threshold: 2,
      },
    }),
    proposeTransaction: vi.fn().mockResolvedValue({
      tx_data: {
        safe_address: '0xSafeAddress1234567890abcdef1234567890abcdef',
        chain_id: 1,
        to: '0xBeneficiary',
        value: '1000000000000000000',
        tx_hash: '0xTxHash123',
      },
      tx_hash_to_sign: '0xTxHash123',
    }),
    verifySignature: vi.fn().mockResolvedValue(true),
    broadcastTransaction: vi.fn().mockResolvedValue({
      tx_hash: '0xBroadcastTxHash456',
      success: true,
    }),
  },
}));

// Mock BTC adapter
vi.mock('./adapters/btc-multisig', () => ({
  btcMultisigAdapter: {
    supportedChains: ['BTC', 'LTC', 'DOGE'],
    createMultisig: vi.fn().mockResolvedValue({
      escrow_address: 'bc1qmultisig123456789',
      chain_metadata: {
        witness_script: 'abcdef0123456789',
        address_type: 'P2WSH',
        threshold: 2,
      },
    }),
    proposeTransaction: vi.fn().mockResolvedValue({
      tx_data: { escrow_address: 'bc1qmultisig123456789', amount_sats: 100000000 },
      tx_hash_to_sign: 'btc_tx_hash_123',
    }),
    verifySignature: vi.fn().mockResolvedValue(true),
    broadcastTransaction: vi.fn().mockResolvedValue({
      tx_hash: 'btc_broadcast_hash_456',
      success: true,
    }),
  },
}));

// Mock Solana adapter
vi.mock('./adapters/solana-multisig', () => ({
  solanaMultisigAdapter: {
    supportedChains: ['SOL'],
    createMultisig: vi.fn().mockResolvedValue({
      escrow_address: 'SoLMultisigVault123456789',
      chain_metadata: {
        multisig_pda: 'SoLMultisigPDA123',
        vault_pda: 'SoLMultisigVault123456789',
        threshold: 2,
      },
    }),
    proposeTransaction: vi.fn().mockResolvedValue({
      tx_data: { multisig_pda: 'SoLMultisigPDA123', lamports: 1000000000 },
      tx_hash_to_sign: 'sol_tx_hash_123',
    }),
    verifySignature: vi.fn().mockResolvedValue(true),
    broadcastTransaction: vi.fn().mockResolvedValue({
      tx_hash: 'sol_broadcast_hash_456',
      success: true,
    }),
  },
}));

// ── Supabase Mock ───────────────────────────────────────────

function createMockSupabase() {
  const escrowStore: Map<string, any> = new Map();
  const proposalStore: Map<string, any> = new Map();
  const signatureStore: Map<string, any> = new Map();
  const eventStore: any[] = [];

  const mockFrom = (table: string) => {
    const chain = {
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockImplementation(async () => {
            const insertData = chain.insert.mock.calls[0][0];
            const record = {
              id: crypto.randomUUID(),
              ...insertData,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            if (table === 'escrows') {
              escrowStore.set(record.id, record);
            } else if (table === 'multisig_proposals') {
              proposalStore.set(record.id, record);
            } else if (table === 'multisig_signatures') {
              signatureStore.set(record.id, record);
            } else if (table === 'escrow_events') {
              eventStore.push(record);
            }

            return { data: record, error: null };
          }),
        }),
      }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockImplementation(async () => {
              // Find by id and model
              const selectFn = chain.select;
              const eqCalls = chain.select().eq.mock.calls;

              for (const [, escrow] of escrowStore) {
                return { data: escrow, error: null };
              }
              return { data: null, error: { message: 'Not found' } };
            }),
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockImplementation(async () => {
                for (const [, proposal] of proposalStore) {
                  return { data: proposal, error: null };
                }
                return { data: null, error: { message: 'Not found' } };
              }),
            }),
          }),
          single: vi.fn().mockImplementation(async () => {
            for (const [, escrow] of escrowStore) {
              return { data: escrow, error: null };
            }
            return { data: null, error: { message: 'Not found' } };
          }),
          order: vi.fn().mockReturnValue({
            data: [],
            error: null,
          }),
        }),
        order: vi.fn().mockImplementation(async () => {
          if (table === 'multisig_proposals') {
            return { data: Array.from(proposalStore.values()), error: null };
          }
          if (table === 'multisig_signatures') {
            return { data: Array.from(signatureStore.values()), error: null };
          }
          return { data: [], error: null };
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockImplementation(async () => {
                const updateData = chain.update.mock.calls[0][0];
                for (const [id, record] of escrowStore) {
                  const updated = { ...record, ...updateData };
                  escrowStore.set(id, updated);
                  return { data: updated, error: null };
                }
                return { data: null, error: { message: 'Not found' } };
              }),
            }),
          }),
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockImplementation(async () => {
              const updateData = chain.update.mock.calls[0][0];
              for (const [id, record] of proposalStore) {
                const updated = { ...record, ...updateData };
                proposalStore.set(id, updated);
                return { data: updated, error: null };
              }
              return { data: null, error: null };
            }),
          }),
        }),
      }),
    };
    return chain;
  };

  return {
    from: vi.fn().mockImplementation(mockFrom),
    _escrowStore: escrowStore,
    _proposalStore: proposalStore,
    _signatureStore: signatureStore,
    _eventStore: eventStore,
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('MultisigEscrowEngine', () => {
  let supabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    supabase = createMockSupabase();
  });

  describe('createMultisigEscrow', () => {
    it('should create an ETH multisig escrow', async () => {
      const result = await createMultisigEscrow(supabase, {
        chain: 'ETH',
        amount: 1.0,
        depositor_pubkey: '0x1234567890123456789012345678901234567890',
        beneficiary_pubkey: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        arbiter_pubkey: '0x9876543210987654321098765432109876543210',
      });

      expect(result.success).toBe(true);
      expect(result.escrow).toBeDefined();
      expect(result.escrow!.escrow_model).toBe('multisig_2of3');
      expect(result.escrow!.threshold).toBe(2);
      expect(result.escrow!.chain).toBe('ETH');
      expect(result.escrow!.escrow_address).toBeTruthy();
      expect(result.escrow!.status).toBe('pending');
    });

    it('should create a BTC multisig escrow', async () => {
      const result = await createMultisigEscrow(supabase, {
        chain: 'BTC',
        amount: 0.5,
        depositor_pubkey: '02aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffffgggggggghhhhhhhh',
        beneficiary_pubkey: '03aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffffgggggggghhhhhhhh',
        arbiter_pubkey: '02bbbbbbbbccccccccddddddddeeeeeeeeffffffffgggggggghhhhhhhhiiiiiiii',
      });

      expect(result.success).toBe(true);
      expect(result.escrow!.chain).toBe('BTC');
    });

    it('should create a SOL multisig escrow', async () => {
      const result = await createMultisigEscrow(supabase, {
        chain: 'SOL',
        amount: 10.0,
        depositor_pubkey: 'SoLDepositor123456789012345678901234567890',
        beneficiary_pubkey: 'SoLBeneficiary12345678901234567890123456',
        arbiter_pubkey: 'SoLArbiter1234567890123456789012345678901',
      });

      expect(result.success).toBe(true);
      expect(result.escrow!.chain).toBe('SOL');
    });

    it('should fail when multisig is disabled', async () => {
      vi.stubEnv('MULTISIG_ESCROW_ENABLED', 'false');

      const result = await createMultisigEscrow(supabase, {
        chain: 'ETH',
        amount: 1.0,
        depositor_pubkey: '0x1234567890123456789012345678901234567890',
        beneficiary_pubkey: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        arbiter_pubkey: '0x9876543210987654321098765432109876543210',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not enabled');

      // Restore
      vi.stubEnv('MULTISIG_ESCROW_ENABLED', 'true');
    });

    it('should persist escrow to database', async () => {
      await createMultisigEscrow(supabase, {
        chain: 'ETH',
        amount: 1.0,
        depositor_pubkey: '0x1234567890123456789012345678901234567890',
        beneficiary_pubkey: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        arbiter_pubkey: '0x9876543210987654321098765432109876543210',
      });

      // Verify insert was called on escrows table
      expect(supabase.from).toHaveBeenCalledWith('escrows');
    });

    it('should log multisig_created event', async () => {
      await createMultisigEscrow(supabase, {
        chain: 'ETH',
        amount: 1.0,
        depositor_pubkey: '0x1234567890123456789012345678901234567890',
        beneficiary_pubkey: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        arbiter_pubkey: '0x9876543210987654321098765432109876543210',
      });

      // Verify escrow_events insert was called
      expect(supabase.from).toHaveBeenCalledWith('escrow_events');
    });
  });

  describe('proposeTransaction', () => {
    it('should create a release proposal', async () => {
      // First create an escrow
      const createResult = await createMultisigEscrow(supabase, {
        chain: 'ETH',
        amount: 1.0,
        depositor_pubkey: '0x1234567890123456789012345678901234567890',
        beneficiary_pubkey: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        arbiter_pubkey: '0x9876543210987654321098765432109876543210',
      });

      // Mark as funded
      const escrowId = createResult.escrow!.id;
      for (const [id, escrow] of supabase._escrowStore) {
        escrow.status = 'funded';
      }

      // Mock empty pending proposals
      const origFrom = supabase.from;
      supabase.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'multisig_proposals') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: crypto.randomUUID(),
                    escrow_id: escrowId,
                    proposal_type: 'release',
                    to_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
                    amount: 1.0,
                    chain_tx_data: {},
                    status: 'pending',
                    created_by: '0x1234567890123456789012345678901234567890',
                    created_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return origFrom(table);
      });

      const result = await proposeTransaction(
        supabase,
        escrowId,
        'release',
        '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        '0x1234567890123456789012345678901234567890', // depositor
      );

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();
      expect(result.tx_data).toBeDefined();
    });
  });

  describe('getMultisigEscrow', () => {
    it('should return escrow not found for invalid ID', async () => {
      // Override from to return not found
      supabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Not found' },
              }),
            }),
          }),
        }),
      });

      const result = await getMultisigEscrow(supabase, 'nonexistent-id');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('disputeMultisigEscrow', () => {
    it('should reject dispute from arbiter', async () => {
      // Create a funded escrow
      await createMultisigEscrow(supabase, {
        chain: 'ETH',
        amount: 1.0,
        depositor_pubkey: '0x1234567890123456789012345678901234567890',
        beneficiary_pubkey: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        arbiter_pubkey: '0x9876543210987654321098765432109876543210',
      });

      for (const [, escrow] of supabase._escrowStore) {
        escrow.status = 'funded';
      }

      const escrowId = Array.from(supabase._escrowStore.keys())[0];
      const result = await disputeMultisigEscrow(
        supabase,
        escrowId,
        '0x9876543210987654321098765432109876543210', // arbiter
        'Dispute reason for testing purposes',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Only depositor or beneficiary');
    });
  });
});
