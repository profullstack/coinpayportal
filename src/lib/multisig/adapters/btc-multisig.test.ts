/**
 * BTC Multisig Adapter Tests
 *
 * Tests the Bitcoin P2WSH multisig adapter.
 */

import { describe, it, expect, beforeEach } from 'vitest';
<<<<<<< HEAD
import * as bitcoin from 'bitcoinjs-lib';
import * as secp256k1 from 'tiny-secp256k1';
=======
>>>>>>> feat/multisig-escrow
import { BtcMultisigAdapter } from './btc-multisig';

// Sample compressed public keys (33 bytes hex)
const PUB_KEY_1 = '02' + '11'.repeat(32);
const PUB_KEY_2 = '03' + '22'.repeat(32);
const PUB_KEY_3 = '02' + '33'.repeat(32);

describe('BtcMultisigAdapter', () => {
  let adapter: BtcMultisigAdapter;

  beforeEach(() => {
    adapter = new BtcMultisigAdapter();
  });

  describe('supportedChains', () => {
    it('should support BTC, LTC, and DOGE', () => {
      expect(adapter.supportedChains).toContain('BTC');
      expect(adapter.supportedChains).toContain('LTC');
      expect(adapter.supportedChains).toContain('DOGE');
      expect(adapter.supportedChains).toHaveLength(3);
    });
  });

  describe('createMultisig', () => {
    it('should create a P2WSH 2-of-3 multisig address for BTC', async () => {
      const result = await adapter.createMultisig('BTC', {
        depositor_pubkey: PUB_KEY_1,
        beneficiary_pubkey: PUB_KEY_2,
        arbiter_pubkey: PUB_KEY_3,
      }, 2);

      expect(result.escrow_address).toBeTruthy();
      expect(result.escrow_address.startsWith('bc1')).toBe(true);
      expect(result.chain_metadata.address_type).toBe('P2WSH');
      expect(result.chain_metadata.witness_script).toBeTruthy();
      expect(result.chain_metadata.threshold).toBe(2);
      expect(result.chain_metadata.pubkeys).toHaveLength(3);
    });

    it('should create deterministic addresses from same pubkeys', async () => {
      const participants = {
        depositor_pubkey: PUB_KEY_1,
        beneficiary_pubkey: PUB_KEY_2,
        arbiter_pubkey: PUB_KEY_3,
      };

      const result1 = await adapter.createMultisig('BTC', participants, 2);
      const result2 = await adapter.createMultisig('BTC', participants, 2);

      expect(result1.escrow_address).toBe(result2.escrow_address);
    });

    it('should sort pubkeys (BIP-67) for deterministic addresses', async () => {
      // Same pubkeys, different order — should produce same address
      const result1 = await adapter.createMultisig('BTC', {
        depositor_pubkey: PUB_KEY_1,
        beneficiary_pubkey: PUB_KEY_2,
        arbiter_pubkey: PUB_KEY_3,
      }, 2);

      const result2 = await adapter.createMultisig('BTC', {
        depositor_pubkey: PUB_KEY_3,
        beneficiary_pubkey: PUB_KEY_1,
        arbiter_pubkey: PUB_KEY_2,
      }, 2);

      expect(result1.escrow_address).toBe(result2.escrow_address);
    });

    it('should reject non-UTXO chains', async () => {
      await expect(
        adapter.createMultisig('ETH' as any, {
          depositor_pubkey: PUB_KEY_1,
          beneficiary_pubkey: PUB_KEY_2,
          arbiter_pubkey: PUB_KEY_3,
        }, 2),
      ).rejects.toThrow('not supported');
    });

    it('should reject invalid public key length', async () => {
      await expect(
        adapter.createMultisig('BTC', {
          depositor_pubkey: 'abcdef', // too short
          beneficiary_pubkey: PUB_KEY_2,
          arbiter_pubkey: PUB_KEY_3,
        }, 2),
      ).rejects.toThrow('Invalid public key length');
    });

    it('should store witness script in chain_metadata', async () => {
      const result = await adapter.createMultisig('BTC', {
        depositor_pubkey: PUB_KEY_1,
        beneficiary_pubkey: PUB_KEY_2,
        arbiter_pubkey: PUB_KEY_3,
      }, 2);

      expect(result.chain_metadata.witness_script).toBeTruthy();
      expect(typeof result.chain_metadata.witness_script).toBe('string');
      // Witness script should be hex-encoded
      expect(/^[0-9a-f]+$/.test(result.chain_metadata.witness_script as string)).toBe(true);
    });
  });

  describe('proposeTransaction', () => {
    it('should build PSBT data for BTC', async () => {
      const result = await adapter.proposeTransaction('BTC', {
        escrow_address: 'bc1qmultisig123456789',
        to_address: 'bc1qbeneficiary123456',
        amount: 0.5,
        chain_metadata: {
          witness_script: 'abcdef0123456789',
        },
      });

      expect(result.tx_hash_to_sign).toBeTruthy();
      expect(result.tx_data.amount_sats).toBe(50000000);
      expect(result.tx_data.to_address).toBe('bc1qbeneficiary123456');
    });

    it('should fail without witness_script', async () => {
      await expect(
        adapter.proposeTransaction('BTC', {
          escrow_address: 'bc1qmultisig123456789',
          to_address: 'bc1qbeneficiary123456',
          amount: 0.5,
          chain_metadata: {},
        }),
      ).rejects.toThrow('Missing witness_script');
    });
  });

  describe('verifySignature', () => {
<<<<<<< HEAD
    it('should verify a valid secp256k1 signature against tx_hash_to_sign', async () => {
      const privkey = Buffer.alloc(32, 1);
      const pubkey = Buffer.from(secp256k1.pointFromScalar(privkey, true)!);
      const pubkeyHex = pubkey.toString('hex');

      const msgHash = Buffer.alloc(32, 7);
      const sigCompact = Buffer.from(secp256k1.sign(msgHash, privkey));
      const sigDerWithHashType = bitcoin.script.signature.encode(sigCompact, bitcoin.Transaction.SIGHASH_ALL);

      const valid = await adapter.verifySignature(
        'BTC',
        {
          witness_script: 'abcdef',
          pubkeys: [pubkeyHex],
          tx_hash_to_sign: msgHash.toString('hex'),
        },
        sigDerWithHashType.toString('hex'),
        pubkeyHex,
      );

      expect(valid).toBe(true);
    });

    it('should reject invalid signature bytes for tx_hash_to_sign', async () => {
      const privkey = Buffer.alloc(32, 2);
      const pubkey = Buffer.from(secp256k1.pointFromScalar(privkey, true)!);
      const pubkeyHex = pubkey.toString('hex');

      const msgHash = Buffer.alloc(32, 8);
      const invalidSig = 'aa'.repeat(70);

      const valid = await adapter.verifySignature(
        'BTC',
        {
          witness_script: 'abcdef',
          pubkeys: [pubkeyHex],
          tx_hash_to_sign: msgHash.toString('hex'),
        },
        invalidSig,
        pubkeyHex,
      );

      expect(valid).toBe(false);
    });

    it('should reject unknown pubkey', async () => {
      const msgHash = Buffer.alloc(32, 9).toString('hex');
      const valid = await adapter.verifySignature(
        'BTC',
        { witness_script: 'abcdef', pubkeys: [PUB_KEY_2], tx_hash_to_sign: msgHash },
        'aa'.repeat(64),
=======
    it('should validate signature format', async () => {
      // 64-byte signature (128 hex chars)
      const validSig = 'aa'.repeat(64);
      const valid = await adapter.verifySignature(
        'BTC',
        { witness_script: 'abcdef', pubkeys: [PUB_KEY_1] },
        validSig,
        PUB_KEY_1,
      );
      expect(valid).toBe(true);
    });

    it('should reject unknown pubkey', async () => {
      const validSig = 'aa'.repeat(64);
      const valid = await adapter.verifySignature(
        'BTC',
        { witness_script: 'abcdef', pubkeys: [PUB_KEY_2] },
        validSig,
>>>>>>> feat/multisig-escrow
        PUB_KEY_1, // not in pubkeys list
      );
      expect(valid).toBe(false);
    });
  });

  describe('broadcastTransaction', () => {
    it('should succeed with 2+ signatures', async () => {
      const result = await adapter.broadcastTransaction(
        'BTC',
        { escrow_address: 'bc1qmultisig123' },
        [
          { pubkey: PUB_KEY_1, signature: 'sig1' },
          { pubkey: PUB_KEY_2, signature: 'sig2' },
        ],
      );

      expect(result.success).toBe(true);
      expect(result.tx_hash).toBeTruthy();
    });

    it('should fail with fewer than 2 signatures', async () => {
      const result = await adapter.broadcastTransaction(
        'BTC',
        { escrow_address: 'bc1qmultisig123' },
        [{ pubkey: PUB_KEY_1, signature: 'sig1' }],
      );

      expect(result.success).toBe(false);
    });
  });
});
