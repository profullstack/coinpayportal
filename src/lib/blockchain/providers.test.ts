import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BitcoinProvider,
  EthereumProvider,
  PolygonProvider,
  SolanaProvider,
  getProvider,
} from './providers';

describe('Blockchain Providers', () => {
  describe('BitcoinProvider', () => {
    let provider: BitcoinProvider;

    beforeEach(() => {
      provider = new BitcoinProvider('https://bitcoin-rpc.example.com');
    });

    it('should create a Bitcoin provider instance', () => {
      expect(provider).toBeInstanceOf(BitcoinProvider);
      expect(provider.chain).toBe('BTC');
    });

    it('should get balance for an address', async () => {
      const address = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
      const balance = await provider.getBalance(address);
      expect(typeof balance).toBe('string');
    });

    it('should get transaction details', async () => {
      const txHash = '0000000000000000000000000000000000000000000000000000000000000000';
      const tx = await provider.getTransaction(txHash);
      expect(tx).toHaveProperty('hash');
      expect(tx).toHaveProperty('confirmations');
    });

    it('should get required confirmations', () => {
      expect(provider.getRequiredConfirmations()).toBe(3);
    });
  });

  describe('EthereumProvider', () => {
    let provider: EthereumProvider;

    beforeEach(() => {
      provider = new EthereumProvider('https://ethereum-rpc.example.com');
    });

    it('should create an Ethereum provider instance', () => {
      expect(provider).toBeInstanceOf(EthereumProvider);
      expect(provider.chain).toBe('ETH');
    });

    it('should get balance for an address', async () => {
      const address = '0x0000000000000000000000000000000000000000';
      const balance = await provider.getBalance(address);
      expect(typeof balance).toBe('string');
    });

    it('should get transaction details', async () => {
      const txHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
      const tx = await provider.getTransaction(txHash);
      expect(tx).toHaveProperty('hash');
      expect(tx).toHaveProperty('confirmations');
    });

    it('should get required confirmations', () => {
      expect(provider.getRequiredConfirmations()).toBe(12);
    });

    it('should estimate gas for a transaction', async () => {
      const from = '0x0000000000000000000000000000000000000000';
      const to = '0x0000000000000000000000000000000000000001';
      const value = '1000000000000000000';
      const gas = await provider.estimateGas(from, to, value);
      expect(typeof gas).toBe('string');
    });
  });

  describe('PolygonProvider', () => {
    let provider: PolygonProvider;

    beforeEach(() => {
      provider = new PolygonProvider('https://polygon-rpc.example.com');
    });

    it('should create a Polygon provider instance', () => {
      expect(provider).toBeInstanceOf(PolygonProvider);
      expect(provider.chain).toBe('MATIC');
    });

    it('should get required confirmations', () => {
      expect(provider.getRequiredConfirmations()).toBe(128);
    });
  });

  describe('SolanaProvider', () => {
    let provider: SolanaProvider;

    beforeEach(() => {
      provider = new SolanaProvider('https://solana-rpc.example.com');
    });

    it('should create a Solana provider instance', () => {
      expect(provider).toBeInstanceOf(SolanaProvider);
      expect(provider.chain).toBe('SOL');
    });

    it('should get balance for an address', async () => {
      const address = '11111111111111111111111111111111';
      const balance = await provider.getBalance(address);
      expect(typeof balance).toBe('string');
    });

    it('should get transaction details', async () => {
      const txHash = '1111111111111111111111111111111111111111111111111111111111111111';
      const tx = await provider.getTransaction(txHash);
      expect(tx).toHaveProperty('hash');
      expect(tx).toHaveProperty('confirmations');
    });

    it('should get required confirmations', () => {
      expect(provider.getRequiredConfirmations()).toBe(32);
    });
  });

  describe('getProvider', () => {
    it('should return Bitcoin provider for BTC', () => {
      const provider = getProvider('BTC', 'https://bitcoin-rpc.example.com');
      expect(provider).toBeInstanceOf(BitcoinProvider);
    });

    it('should return Ethereum provider for ETH', () => {
      const provider = getProvider('ETH', 'https://ethereum-rpc.example.com');
      expect(provider).toBeInstanceOf(EthereumProvider);
    });

    it('should return Polygon provider for MATIC', () => {
      const provider = getProvider('MATIC', 'https://polygon-rpc.example.com');
      expect(provider).toBeInstanceOf(PolygonProvider);
    });

    it('should return Solana provider for SOL', () => {
      const provider = getProvider('SOL', 'https://solana-rpc.example.com');
      expect(provider).toBeInstanceOf(SolanaProvider);
    });

    it('should throw error for unsupported chain', () => {
      expect(() => getProvider('INVALID' as any, 'https://example.com')).toThrow(
        'Unsupported blockchain: INVALID'
      );
    });
  });
});