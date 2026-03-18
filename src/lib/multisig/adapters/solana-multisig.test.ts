/**
 * Solana Multisig Adapter Tests
 *
 * Tests the Solana Squads-style multisig adapter.
 */

import { describe, it, expect, beforeEach } from 'vitest';
<<<<<<< HEAD
import nacl from 'tweetnacl';
import bs58 from 'bs58';
=======
>>>>>>> feat/multisig-escrow
import { SolanaMultisigAdapter } from './solana-multisig';

// Valid Solana base58 public keys (system program and well-known program addresses)
const SOL_PK_1 = '11111111111111111111111111111111'; // System Program
const SOL_PK_2 = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'; // Token Program
const SOL_PK_3 = 'SysvarC1ock11111111111111111111111111111111'; // Clock Sysvar

describe('SolanaMultisigAdapter', () => {
  let adapter: SolanaMultisigAdapter;

  beforeEach(() => {
    adapter = new SolanaMultisigAdapter();
  });

  describe('supportedChains', () => {
    it('should support only SOL', () => {
      expect(adapter.supportedChains).toContain('SOL');
      expect(adapter.supportedChains).toHaveLength(1);
    });
  });

  describe('createMultisig', () => {
    it('should create a multisig PDA with vault address', async () => {
      const result = await adapter.createMultisig('SOL', {
        depositor_pubkey: SOL_PK_1,
        beneficiary_pubkey: SOL_PK_2,
        arbiter_pubkey: SOL_PK_3,
      }, 2);

      expect(result.escrow_address).toBeTruthy();
      expect(result.chain_metadata.multisig_pda).toBeTruthy();
      expect(result.chain_metadata.vault_pda).toBeTruthy();
      expect(result.chain_metadata.threshold).toBe(2);
      expect(result.chain_metadata.members).toHaveLength(3);
    });

    it('should reject non-SOL chains', async () => {
      await expect(
        adapter.createMultisig('ETH' as any, {
          depositor_pubkey: SOL_PK_1,
          beneficiary_pubkey: SOL_PK_2,
          arbiter_pubkey: SOL_PK_3,
        }, 2),
      ).rejects.toThrow('not supported');
    });

    it('should reject invalid Solana public keys', async () => {
      await expect(
        adapter.createMultisig('SOL', {
          depositor_pubkey: 'not-a-valid-solana-key-!!!',
          beneficiary_pubkey: SOL_PK_2,
          arbiter_pubkey: SOL_PK_3,
        }, 2),
      ).rejects.toThrow('Invalid Solana public key');
    });

    it('should store program_id in chain_metadata', async () => {
      const result = await adapter.createMultisig('SOL', {
        depositor_pubkey: SOL_PK_1,
        beneficiary_pubkey: SOL_PK_2,
        arbiter_pubkey: SOL_PK_3,
      }, 2);

      expect(result.chain_metadata.program_id).toBeTruthy();
    });
  });

  describe('proposeTransaction', () => {
    it('should build a transfer proposal', async () => {
      const result = await adapter.proposeTransaction('SOL', {
        escrow_address: SOL_PK_1,
        to_address: SOL_PK_2,
        amount: 1.5,
        chain_metadata: {
          multisig_pda: SOL_PK_1,
          vault_pda: SOL_PK_2,
          transaction_index: 0,
        },
      });

      expect(result.tx_hash_to_sign).toBeTruthy();
      expect(result.tx_data.lamports).toBe(1500000000);
      expect(result.tx_data.transaction_index).toBe(1);
    });

    it('should reject non-SOL chains', async () => {
      await expect(
        adapter.proposeTransaction('ETH' as any, {
          escrow_address: SOL_PK_1,
          to_address: SOL_PK_2,
          amount: 1.0,
          chain_metadata: {},
        }),
      ).rejects.toThrow('not supported');
    });
  });

  describe('verifySignature', () => {
<<<<<<< HEAD
    it('should verify a valid Ed25519 signature against tx_hash_to_sign', async () => {
      const keypair = nacl.sign.keyPair();
      const signerPubkey = bs58.encode(Buffer.from(keypair.publicKey));

      const msgHash = Buffer.alloc(32, 5);
      const signature = nacl.sign.detached(msgHash, keypair.secretKey);

      const valid = await adapter.verifySignature(
        'SOL',
        { members: [signerPubkey], tx_hash_to_sign: msgHash.toString('hex') },
        Buffer.from(signature).toString('hex'),
        signerPubkey,
      );

      expect(valid).toBe(true);
    });

    it('should reject an invalid Ed25519 signature for tx_hash_to_sign', async () => {
      const keypair = nacl.sign.keyPair();
      const signerPubkey = bs58.encode(Buffer.from(keypair.publicKey));
      const msgHash = Buffer.alloc(32, 6);
      const badSignature = Buffer.alloc(64, 1).toString('hex');

      const valid = await adapter.verifySignature(
        'SOL',
        { members: [signerPubkey], tx_hash_to_sign: msgHash.toString('hex') },
        badSignature,
        signerPubkey,
      );

      expect(valid).toBe(false);
    });

    it('should reject signer not in members list', async () => {
      const keypair = nacl.sign.keyPair();
      const signerPubkey = bs58.encode(Buffer.from(keypair.publicKey));
      const msgHash = Buffer.alloc(32, 7);
      const signature = nacl.sign.detached(msgHash, keypair.secretKey);

      const valid = await adapter.verifySignature(
        'SOL',
        { members: [SOL_PK_2], tx_hash_to_sign: msgHash.toString('hex') },
        Buffer.from(signature).toString('hex'),
        signerPubkey,
=======
    it('should accept valid Ed25519 signature format (64 bytes)', async () => {
      const sig64bytes = 'aa'.repeat(64); // 64 bytes as hex
      const valid = await adapter.verifySignature(
        'SOL',
        { members: [SOL_PK_1] },
        sig64bytes,
        SOL_PK_1,
      );
      expect(valid).toBe(true);
    });

    it('should reject signer not in members list', async () => {
      const sig64bytes = 'aa'.repeat(64);
      const valid = await adapter.verifySignature(
        'SOL',
        { members: [SOL_PK_2] },
        sig64bytes,
        SOL_PK_1, // not in members
>>>>>>> feat/multisig-escrow
      );
      expect(valid).toBe(false);
    });
  });

  describe('broadcastTransaction', () => {
    it('should succeed with 2+ approvals', async () => {
      const result = await adapter.broadcastTransaction(
        'SOL',
        { multisig_pda: SOL_PK_1, vault_pda: SOL_PK_2 },
        [
          { pubkey: SOL_PK_1, signature: 'sig1' },
          { pubkey: SOL_PK_2, signature: 'sig2' },
        ],
      );

      expect(result.success).toBe(true);
      expect(result.tx_hash).toBeTruthy();
    });

    it('should fail with fewer than 2 approvals', async () => {
      const result = await adapter.broadcastTransaction(
        'SOL',
        { multisig_pda: SOL_PK_1 },
        [{ pubkey: SOL_PK_1, signature: 'sig1' }],
      );

      expect(result.success).toBe(false);
    });

    it('should reject non-SOL chains', async () => {
      await expect(
        adapter.broadcastTransaction(
          'ETH' as any,
          {},
          [
            { pubkey: SOL_PK_1, signature: 'sig1' },
            { pubkey: SOL_PK_2, signature: 'sig2' },
          ],
        ),
      ).rejects.toThrow('not supported');
    });
  });
});
