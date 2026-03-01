/**
 * EVM Safe Adapter Tests
 *
 * Tests the EVM Safe adapter with mocked ethers interactions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ethers before importing the adapter
vi.mock('ethers', () => {
  const ZeroAddress = '0x0000000000000000000000000000000000000000';

  return {
    ethers: {
      JsonRpcProvider: vi.fn().mockImplementation(() => ({})),
      isAddress: vi.fn().mockReturnValue(true),
      ZeroAddress,
      Interface: vi.fn().mockImplementation(() => ({
        encodeFunctionData: vi.fn().mockReturnValue('0xencodedSetupData'),
      })),
      AbiCoder: {
        defaultAbiCoder: () => ({
          encode: vi.fn().mockReturnValue('0xencoded'),
        }),
      },
      keccak256: vi.fn().mockReturnValue('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'),
      solidityPacked: vi.fn().mockReturnValue('0xpacked'),
      getCreate2Address: vi.fn().mockReturnValue('0xPredictedSafeAddress1234567890abcdef1234'),
      parseEther: vi.fn().mockReturnValue(BigInt('1000000000000000000')),
      Contract: vi.fn().mockImplementation(() => ({
        nonce: vi.fn().mockResolvedValue(0n),
        getTransactionHash: vi.fn().mockResolvedValue('0xSafeTxHash123'),
        interface: {
          encodeFunctionData: vi.fn().mockReturnValue('0xexecTxData'),
        },
      })),
      recoverAddress: vi.fn().mockReturnValue('0x1234567890123456789012345678901234567890'),
      toUtf8Bytes: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
      concat: vi.fn().mockReturnValue('0xconcatenatedSigs'),
    },
  };
});

import { EvmSafeAdapter } from './evm-safe';

describe('EvmSafeAdapter', () => {
  let adapter: EvmSafeAdapter;

  beforeEach(() => {
    adapter = new EvmSafeAdapter();
  });

  describe('supportedChains', () => {
    it('should support all EVM chains', () => {
      expect(adapter.supportedChains).toContain('ETH');
      expect(adapter.supportedChains).toContain('POL');
      expect(adapter.supportedChains).toContain('BASE');
      expect(adapter.supportedChains).toContain('ARB');
      expect(adapter.supportedChains).toContain('OP');
      expect(adapter.supportedChains).toContain('BNB');
      expect(adapter.supportedChains).toContain('AVAX');
      expect(adapter.supportedChains).toHaveLength(7);
    });
  });

  describe('createMultisig', () => {
    it('should create a Safe with 3 owners and threshold 2', async () => {
      const result = await adapter.createMultisig('ETH', {
        depositor_pubkey: '0x1111111111111111111111111111111111111111',
        beneficiary_pubkey: '0x2222222222222222222222222222222222222222',
        arbiter_pubkey: '0x3333333333333333333333333333333333333333',
      }, 2);

      expect(result.escrow_address).toBeTruthy();
      expect(result.chain_metadata.chain_id).toBe(1);
      expect(result.chain_metadata.chain_name).toBe('Ethereum');
      expect(result.chain_metadata.threshold).toBe(2);
      expect(result.chain_metadata.owners).toHaveLength(3);
    });

    it('should create Safe on Polygon', async () => {
      const result = await adapter.createMultisig('POL', {
        depositor_pubkey: '0x1111111111111111111111111111111111111111',
        beneficiary_pubkey: '0x2222222222222222222222222222222222222222',
        arbiter_pubkey: '0x3333333333333333333333333333333333333333',
      }, 2);

      expect(result.chain_metadata.chain_id).toBe(137);
      expect(result.chain_metadata.chain_name).toBe('Polygon');
    });

    it('should reject non-EVM chains', async () => {
      await expect(
        adapter.createMultisig('BTC' as any, {
          depositor_pubkey: '0x1111111111111111111111111111111111111111',
          beneficiary_pubkey: '0x2222222222222222222222222222222222222222',
          arbiter_pubkey: '0x3333333333333333333333333333333333333333',
        }, 2),
      ).rejects.toThrow('not supported');
    });

    it('should sort owner addresses deterministically', async () => {
      const result1 = await adapter.createMultisig('ETH', {
        depositor_pubkey: '0xAAAA111111111111111111111111111111111111',
        beneficiary_pubkey: '0xBBBB222222222222222222222222222222222222',
        arbiter_pubkey: '0x0000333333333333333333333333333333333333',
      }, 2);

      const owners = result1.chain_metadata.owners as string[];
      // Verify sorted ascending
      for (let i = 0; i < owners.length - 1; i++) {
        expect(owners[i].toLowerCase() <= owners[i + 1].toLowerCase()).toBe(true);
      }
    });

    it('should reject invalid EVM addresses', async () => {
      const { ethers } = await import('ethers');
      (ethers.isAddress as any).mockReturnValueOnce(false);

      await expect(
        adapter.createMultisig('ETH', {
          depositor_pubkey: 'invalid-address',
          beneficiary_pubkey: '0x2222222222222222222222222222222222222222',
          arbiter_pubkey: '0x3333333333333333333333333333333333333333',
        }, 2),
      ).rejects.toThrow('Invalid EVM address');
    });
  });

  describe('proposeTransaction', () => {
    it('should build a Safe transaction proposal', async () => {
      const result = await adapter.proposeTransaction('ETH', {
        escrow_address: '0xSafeAddress1234567890abcdef1234567890abcdef',
        to_address: '0xBeneficiary1234567890abcdef1234567890abcdef',
        amount: 1.0,
        chain_metadata: {},
      });

      expect(result.tx_hash_to_sign).toBeTruthy();
      expect(result.tx_data).toBeDefined();
      expect(result.tx_data.safe_address).toBe('0xSafeAddress1234567890abcdef1234567890abcdef');
      expect(result.tx_data.chain_id).toBe(1);
    });
  });

  describe('verifySignature', () => {
    it('should verify a valid signature', async () => {
      const valid = await adapter.verifySignature(
        'ETH',
        { tx_hash: '0xSomeTxHash' },
        '0xSignatureData',
        '0x1234567890123456789012345678901234567890',
      );
      expect(valid).toBe(true);
    });

    it('should reject when tx_hash is missing', async () => {
      const valid = await adapter.verifySignature(
        'ETH',
        {},
        '0xSignatureData',
        '0x1234567890123456789012345678901234567890',
      );
      expect(valid).toBe(false);
    });
  });

  describe('broadcastTransaction', () => {
    it('should prepare Safe transaction for execution', async () => {
      const result = await adapter.broadcastTransaction(
        'ETH',
        {
          safe_address: '0xSafe123',
          to: '0xBeneficiary',
          value: '1000000000000000000',
          data: '0x',
          operation: 0,
          safeTxGas: '0',
          baseGas: '0',
          gasPrice: '0',
          gasToken: '0x0000000000000000000000000000000000000000',
          refundReceiver: '0x0000000000000000000000000000000000000000',
        },
        [
          { pubkey: '0xSigner1', signature: '0xSig1' },
          { pubkey: '0xSigner2', signature: '0xSig2' },
        ],
      );

      expect(result.success).toBe(true);
      expect(result.tx_hash).toBeTruthy();
    });
  });
});
