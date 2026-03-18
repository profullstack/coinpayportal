/**
 * Multisig Validation Tests
 *
 * Tests all Zod validation schemas for multisig operations.
 */

import { describe, it, expect } from 'vitest';
import {
  createMultisigEscrowSchema,
<<<<<<< HEAD
  prepareTransactionSchema,
=======
  proposeTransactionSchema,
>>>>>>> feat/multisig-escrow
  signProposalSchema,
  broadcastTransactionSchema,
  disputeSchema,
  multisigChainSchema,
} from './validation';

describe('multisigChainSchema', () => {
  it('should accept valid EVM chains', () => {
    const evmChains = ['ETH', 'POL', 'BASE', 'ARB', 'OP', 'BNB', 'AVAX'];
    for (const chain of evmChains) {
      expect(multisigChainSchema.safeParse(chain).success).toBe(true);
    }
  });

  it('should accept valid UTXO chains', () => {
    const utxoChains = ['BTC', 'LTC', 'DOGE'];
    for (const chain of utxoChains) {
      expect(multisigChainSchema.safeParse(chain).success).toBe(true);
    }
  });

  it('should accept SOL', () => {
    expect(multisigChainSchema.safeParse('SOL').success).toBe(true);
  });

  it('should reject invalid chains', () => {
    expect(multisigChainSchema.safeParse('INVALID').success).toBe(false);
    expect(multisigChainSchema.safeParse('XRP').success).toBe(false);
    expect(multisigChainSchema.safeParse('').success).toBe(false);
    expect(multisigChainSchema.safeParse(123).success).toBe(false);
  });
});

describe('createMultisigEscrowSchema', () => {
  const validInput = {
    chain: 'ETH',
    amount: 1.5,
    depositor_pubkey: '0x1234567890123456789012345678901234567890',
    beneficiary_pubkey: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    arbiter_pubkey: '0x9876543210987654321098765432109876543210',
  };

  it('should accept valid input', () => {
    const result = createMultisigEscrowSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should accept optional fields', () => {
    const result = createMultisigEscrowSchema.safeParse({
      ...validInput,
      metadata: { description: 'Test escrow' },
      business_id: '00000000-0000-0000-0000-000000000001',
      expires_in_hours: 48,
    });
    expect(result.success).toBe(true);
  });

  it('should require chain', () => {
    const { chain: _chain, ...rest } = validInput;
    const result = createMultisigEscrowSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('should require positive amount', () => {
    expect(createMultisigEscrowSchema.safeParse({ ...validInput, amount: 0 }).success).toBe(false);
    expect(createMultisigEscrowSchema.safeParse({ ...validInput, amount: -1 }).success).toBe(false);
  });

  it('should require all three pubkeys', () => {
    const { depositor_pubkey, ...rest1 } = validInput;
    expect(createMultisigEscrowSchema.safeParse(rest1).success).toBe(false);

    const { beneficiary_pubkey, ...rest2 } = validInput;
    expect(createMultisigEscrowSchema.safeParse(rest2).success).toBe(false);

    const { arbiter_pubkey, ...rest3 } = validInput;
    expect(createMultisigEscrowSchema.safeParse(rest3).success).toBe(false);
  });

  it('should reject same depositor and beneficiary', () => {
    const result = createMultisigEscrowSchema.safeParse({
      ...validInput,
      beneficiary_pubkey: validInput.depositor_pubkey,
    });
    expect(result.success).toBe(false);
  });

  it('should reject same arbiter as depositor or beneficiary', () => {
    expect(createMultisigEscrowSchema.safeParse({
      ...validInput,
      arbiter_pubkey: validInput.depositor_pubkey,
    }).success).toBe(false);

    expect(createMultisigEscrowSchema.safeParse({
      ...validInput,
      arbiter_pubkey: validInput.beneficiary_pubkey,
    }).success).toBe(false);
  });

  it('should reject short pubkeys', () => {
    expect(createMultisigEscrowSchema.safeParse({
      ...validInput,
      depositor_pubkey: '0x123',
    }).success).toBe(false);
  });

  it('should enforce expires_in_hours max of 720', () => {
    expect(createMultisigEscrowSchema.safeParse({
      ...validInput,
      expires_in_hours: 721,
    }).success).toBe(false);

    expect(createMultisigEscrowSchema.safeParse({
      ...validInput,
      expires_in_hours: 720,
    }).success).toBe(true);
  });
});

<<<<<<< HEAD
describe('prepareTransactionSchema', () => {
  it('should accept valid release proposal', () => {
    const result = prepareTransactionSchema.safeParse({
=======
describe('proposeTransactionSchema', () => {
  it('should accept valid release proposal', () => {
    const result = proposeTransactionSchema.safeParse({
>>>>>>> feat/multisig-escrow
      proposal_type: 'release',
      to_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      signer_pubkey: '0x1234567890123456789012345678901234567890',
    });
    expect(result.success).toBe(true);
  });

  it('should accept valid refund proposal', () => {
<<<<<<< HEAD
    const result = prepareTransactionSchema.safeParse({
=======
    const result = proposeTransactionSchema.safeParse({
>>>>>>> feat/multisig-escrow
      proposal_type: 'refund',
      to_address: '0x1234567890123456789012345678901234567890',
      signer_pubkey: '0x1234567890123456789012345678901234567890',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid proposal type', () => {
<<<<<<< HEAD
    const result = prepareTransactionSchema.safeParse({
=======
    const result = proposeTransactionSchema.safeParse({
>>>>>>> feat/multisig-escrow
      proposal_type: 'cancel',
      to_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      signer_pubkey: '0x1234567890123456789012345678901234567890',
    });
    expect(result.success).toBe(false);
  });

  it('should require signer_pubkey', () => {
<<<<<<< HEAD
    const result = prepareTransactionSchema.safeParse({
=======
    const result = proposeTransactionSchema.safeParse({
>>>>>>> feat/multisig-escrow
      proposal_type: 'release',
      to_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    });
    expect(result.success).toBe(false);
  });
});

describe('signProposalSchema', () => {
  it('should accept valid signature', () => {
    const result = signProposalSchema.safeParse({
      proposal_id: '00000000-0000-0000-0000-000000000001',
      signer_pubkey: '0x1234567890123456789012345678901234567890',
      signature: '0xabcdef1234567890abcdef1234567890',
    });
    expect(result.success).toBe(true);
  });

  it('should require valid UUID for proposal_id', () => {
    const result = signProposalSchema.safeParse({
      proposal_id: 'not-a-uuid',
      signer_pubkey: '0x1234567890123456789012345678901234567890',
      signature: '0xabcdef1234567890',
    });
    expect(result.success).toBe(false);
  });
});

describe('broadcastTransactionSchema', () => {
  it('should accept valid broadcast request', () => {
    const result = broadcastTransactionSchema.safeParse({
      proposal_id: '00000000-0000-0000-0000-000000000001',
    });
    expect(result.success).toBe(true);
  });

  it('should require proposal_id', () => {
    const result = broadcastTransactionSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('disputeSchema', () => {
  it('should accept valid dispute', () => {
    const result = disputeSchema.safeParse({
      signer_pubkey: '0x1234567890123456789012345678901234567890',
      reason: 'The goods were not delivered as described in the agreement',
    });
    expect(result.success).toBe(true);
  });

  it('should require reason of at least 10 characters', () => {
    const result = disputeSchema.safeParse({
      signer_pubkey: '0x1234567890123456789012345678901234567890',
      reason: 'Too short',
    });
    expect(result.success).toBe(false);
  });

  it('should enforce reason max of 2000 characters', () => {
    const result = disputeSchema.safeParse({
      signer_pubkey: '0x1234567890123456789012345678901234567890',
      reason: 'x'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });
});
