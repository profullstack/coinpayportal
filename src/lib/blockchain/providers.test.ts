import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BitcoinProvider,
  EthereumProvider,
  PolygonProvider,
  SolanaProvider,
  getProvider,
  getRpcUrl,
} from './providers';

// Mock axios for Bitcoin provider
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

// Mock ethers for Ethereum provider
vi.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: vi.fn().mockImplementation(() => ({
      getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')),
      getTransaction: vi.fn(),
      getTransactionReceipt: vi.fn(),
      getBlockNumber: vi.fn().mockResolvedValue(1000),
      estimateGas: vi.fn().mockResolvedValue(BigInt('21000')),
    })),
    formatEther: vi.fn((val) => (Number(val) / 1e18).toString()),
    parseEther: vi.fn((val) => BigInt(parseFloat(val) * 1e18)),
    Wallet: vi.fn().mockImplementation(() => ({
      sendTransaction: vi.fn().mockResolvedValue({
        hash: '0xmocktxhash',
        wait: vi.fn().mockResolvedValue({}),
      }),
    })),
  },
}));

// Mock @solana/web3.js
vi.mock('@solana/web3.js', () => ({
  Connection: vi.fn().mockImplementation(() => ({
    getBalance: vi.fn().mockResolvedValue(1000000000), // 1 SOL in lamports
    getTransaction: vi.fn(),
    getSlot: vi.fn().mockResolvedValue(1000),
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: 'mockblockhash',
    }),
  })),
  PublicKey: vi.fn().mockImplementation((address) => ({
    toString: () => address,
  })),
  Keypair: {
    fromSecretKey: vi.fn().mockImplementation(() => ({
      publicKey: {
        toString: () => 'mockpublickey',
      },
    })),
  },
  Transaction: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockReturnThis(),
    recentBlockhash: null,
    feePayer: null,
  })),
  SystemProgram: {
    transfer: vi.fn().mockReturnValue({}),
  },
  sendAndConfirmTransaction: vi.fn().mockResolvedValue('mocksoltxsignature'),
  LAMPORTS_PER_SOL: 1000000000,
}));

// Mock bs58
vi.mock('bs58', () => ({
  default: {
    decode: vi.fn().mockReturnValue(new Uint8Array(64)),
  },
}));

describe('Blockchain Providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('BitcoinProvider', () => {
    it('should create a Bitcoin provider', () => {
      const provider = new BitcoinProvider('https://blockchain.info');
      expect(provider.chain).toBe('BTC');
      expect(provider.rpcUrl).toBe('https://blockchain.info');
    });

    it('should return required confirmations for Bitcoin', () => {
      const provider = new BitcoinProvider('https://blockchain.info');
      expect(provider.getRequiredConfirmations()).toBe(3);
    });
  });

  describe('EthereumProvider', () => {
    it('should create an Ethereum provider', () => {
      const provider = new EthereumProvider('https://eth.llamarpc.com');
      expect(provider.chain).toBe('ETH');
      expect(provider.rpcUrl).toBe('https://eth.llamarpc.com');
    });

    it('should return required confirmations for Ethereum', () => {
      const provider = new EthereumProvider('https://eth.llamarpc.com');
      expect(provider.getRequiredConfirmations()).toBe(12);
    });

    it('should have sendTransaction method', () => {
      const provider = new EthereumProvider('https://eth.llamarpc.com');
      expect(provider.sendTransaction).toBeDefined();
      expect(typeof provider.sendTransaction).toBe('function');
    });
  });

  describe('PolygonProvider', () => {
    it('should create a Polygon provider', () => {
      const provider = new PolygonProvider('https://polygon-rpc.com');
      expect(provider.chain).toBe('MATIC');
      expect(provider.rpcUrl).toBe('https://polygon-rpc.com');
    });

    it('should return required confirmations for Polygon', () => {
      const provider = new PolygonProvider('https://polygon-rpc.com');
      expect(provider.getRequiredConfirmations()).toBe(128);
    });

    it('should inherit sendTransaction from EthereumProvider', () => {
      const provider = new PolygonProvider('https://polygon-rpc.com');
      expect(provider.sendTransaction).toBeDefined();
      expect(typeof provider.sendTransaction).toBe('function');
    });
  });

  describe('SolanaProvider', () => {
    it('should create a Solana provider', () => {
      const provider = new SolanaProvider('https://api.mainnet-beta.solana.com');
      expect(provider.chain).toBe('SOL');
      expect(provider.rpcUrl).toBe('https://api.mainnet-beta.solana.com');
    });

    it('should return required confirmations for Solana', () => {
      const provider = new SolanaProvider('https://api.mainnet-beta.solana.com');
      expect(provider.getRequiredConfirmations()).toBe(32);
    });

    it('should have sendTransaction method', () => {
      const provider = new SolanaProvider('https://api.mainnet-beta.solana.com');
      expect(provider.sendTransaction).toBeDefined();
      expect(typeof provider.sendTransaction).toBe('function');
    });

    it('should get balance in SOL', async () => {
      const provider = new SolanaProvider('https://api.mainnet-beta.solana.com');
      const balance = await provider.getBalance('mockaddress');
      // 1000000000 lamports = 1 SOL
      expect(balance).toBe('1');
    });
  });

  describe('getProvider', () => {
    it('should return BitcoinProvider for BTC', () => {
      const provider = getProvider('BTC', 'https://blockchain.info');
      expect(provider.chain).toBe('BTC');
    });

    it('should return BitcoinProvider for BCH', () => {
      const provider = getProvider('BCH', 'https://bch.blockchain.info');
      expect(provider.chain).toBe('BTC'); // BCH uses same structure
    });

    it('should return EthereumProvider for ETH', () => {
      const provider = getProvider('ETH', 'https://eth.llamarpc.com');
      expect(provider.chain).toBe('ETH');
    });

    it('should return PolygonProvider for MATIC', () => {
      const provider = getProvider('MATIC', 'https://polygon-rpc.com');
      expect(provider.chain).toBe('MATIC');
    });

    it('should return SolanaProvider for SOL', () => {
      const provider = getProvider('SOL', 'https://api.mainnet-beta.solana.com');
      expect(provider.chain).toBe('SOL');
    });

    it('should throw error for unsupported blockchain', () => {
      expect(() => getProvider('INVALID' as any, 'https://example.com')).toThrow(
        'Unsupported blockchain'
      );
    });
  });

  describe('getRpcUrl', () => {
    it('should return default RPC URL for BTC', () => {
      const url = getRpcUrl('BTC');
      expect(url).toBe('https://blockchain.info');
    });

    it('should return default RPC URL for ETH', () => {
      const url = getRpcUrl('ETH');
      expect(url).toBe('https://eth.llamarpc.com');
    });

    it('should return default RPC URL for MATIC', () => {
      const url = getRpcUrl('MATIC');
      expect(url).toBe('https://polygon-rpc.com');
    });

    it('should return default RPC URL for SOL', () => {
      const url = getRpcUrl('SOL');
      expect(url).toBe('https://api.mainnet-beta.solana.com');
    });

    it('should use environment variable if set', () => {
      const originalEnv = process.env.ETHEREUM_RPC_URL;
      process.env.ETHEREUM_RPC_URL = 'https://custom-eth-rpc.com';
      
      const url = getRpcUrl('ETH');
      expect(url).toBe('https://custom-eth-rpc.com');
      
      // Restore
      if (originalEnv) {
        process.env.ETHEREUM_RPC_URL = originalEnv;
      } else {
        delete process.env.ETHEREUM_RPC_URL;
      }
    });
  });
});