/**
 * Wallet Module Tests
 */

import { describe, it, expect, beforeEach, vi, beforeAll, afterAll } from 'vitest';
import {
  WalletClient,
  WalletChain,
  DEFAULT_CHAINS,
  generateMnemonic,
  validateMnemonic,
  getDerivationPath,
  restoreFromBackup,
} from '../src/wallet.js';

// Test mnemonic (DO NOT USE IN PRODUCTION)
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('Wallet Module', () => {
  describe('generateMnemonic', () => {
    it('should generate 12-word mnemonic by default', () => {
      const mnemonic = generateMnemonic();
      const words = mnemonic.split(' ');
      expect(words).toHaveLength(12);
    });

    it('should generate 12-word mnemonic when specified', () => {
      const mnemonic = generateMnemonic(12);
      const words = mnemonic.split(' ');
      expect(words).toHaveLength(12);
    });

    it('should generate 24-word mnemonic when specified', () => {
      const mnemonic = generateMnemonic(24);
      const words = mnemonic.split(' ');
      expect(words).toHaveLength(24);
    });

    it('should throw error for invalid word count', () => {
      expect(() => generateMnemonic(15)).toThrow('Invalid word count');
      expect(() => generateMnemonic(18)).toThrow('Invalid word count');
    });

    it('should generate valid mnemonics', () => {
      const mnemonic12 = generateMnemonic(12);
      const mnemonic24 = generateMnemonic(24);
      
      expect(validateMnemonic(mnemonic12)).toBe(true);
      expect(validateMnemonic(mnemonic24)).toBe(true);
    });

    it('should generate unique mnemonics', () => {
      const mnemonic1 = generateMnemonic();
      const mnemonic2 = generateMnemonic();
      expect(mnemonic1).not.toBe(mnemonic2);
    });
  });

  describe('validateMnemonic', () => {
    it('should return true for valid 12-word mnemonic', () => {
      expect(validateMnemonic(TEST_MNEMONIC)).toBe(true);
    });

    it('should return true for valid 24-word mnemonic', () => {
      const mnemonic24 = generateMnemonic(24);
      expect(validateMnemonic(mnemonic24)).toBe(true);
    });

    it('should return false for invalid mnemonic', () => {
      expect(validateMnemonic('invalid mnemonic phrase')).toBe(false);
      expect(validateMnemonic('abandon abandon abandon')).toBe(false);
    });

    it('should return false for empty input', () => {
      expect(validateMnemonic('')).toBe(false);
      expect(validateMnemonic(null)).toBe(false);
      expect(validateMnemonic(undefined)).toBe(false);
    });

    it('should handle whitespace correctly', () => {
      const paddedMnemonic = `  ${TEST_MNEMONIC}  `;
      expect(validateMnemonic(paddedMnemonic)).toBe(true);
    });
  });

  describe('getDerivationPath', () => {
    it('should return correct BTC path', () => {
      expect(getDerivationPath('BTC', 0)).toBe("m/44'/0'/0'/0/0");
      expect(getDerivationPath('BTC', 1)).toBe("m/44'/0'/0'/0/1");
    });

    it('should return correct ETH path', () => {
      expect(getDerivationPath('ETH', 0)).toBe("m/44'/60'/0'/0/0");
      expect(getDerivationPath('ETH', 5)).toBe("m/44'/60'/0'/0/5");
    });

    it('should return correct SOL path', () => {
      expect(getDerivationPath('SOL', 0)).toBe("m/44'/501'/0'/0'");
      expect(getDerivationPath('SOL', 2)).toBe("m/44'/501'/2'/0'");
    });

    it('should return correct BCH path', () => {
      expect(getDerivationPath('BCH', 0)).toBe("m/44'/145'/0'/0/0");
    });

    it('should return correct POL path (uses ETH)', () => {
      expect(getDerivationPath('POL', 0)).toBe("m/44'/60'/0'/0/0");
    });

    it('should throw error for unsupported chain', () => {
      expect(() => getDerivationPath('UNKNOWN', 0)).toThrow('Unsupported chain');
    });
  });

  describe('WalletChain', () => {
    it('should have all expected chains', () => {
      expect(WalletChain.BTC).toBe('BTC');
      expect(WalletChain.ETH).toBe('ETH');
      expect(WalletChain.SOL).toBe('SOL');
      expect(WalletChain.POL).toBe('POL');
      expect(WalletChain.BCH).toBe('BCH');
      expect(WalletChain.BNB).toBe('BNB');
    });

    it('should have stablecoin variants', () => {
      expect(WalletChain.USDC_ETH).toBe('USDC_ETH');
      expect(WalletChain.USDC_POL).toBe('USDC_POL');
      expect(WalletChain.USDC_SOL).toBe('USDC_SOL');
      expect(WalletChain.USDT_ETH).toBe('USDT_ETH');
      expect(WalletChain.USDT_POL).toBe('USDT_POL');
      expect(WalletChain.USDT_SOL).toBe('USDT_SOL');
    });
  });

  describe('DEFAULT_CHAINS', () => {
    it('should include common chains', () => {
      expect(DEFAULT_CHAINS).toContain('BTC');
      expect(DEFAULT_CHAINS).toContain('ETH');
      expect(DEFAULT_CHAINS).toContain('SOL');
    });

    it('should be an array', () => {
      expect(Array.isArray(DEFAULT_CHAINS)).toBe(true);
    });
  });

  describe('WalletClient', () => {
    let mockFetch;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch;
    });

    describe('WalletClient.create', () => {
      it('should create wallet with default options', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            wallet_id: 'wid-test-123',
            created_at: new Date().toISOString(),
            addresses: [],
          }),
        });

        const wallet = await WalletClient.create();
        
        expect(wallet).toBeInstanceOf(WalletClient);
        expect(wallet.getMnemonic()).toBeTruthy();
        expect(wallet.getMnemonic().split(' ')).toHaveLength(12);
        expect(wallet.getWalletId()).toBe('wid-test-123');
      });

      it('should create wallet with 24 words', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            wallet_id: 'wid-test-24',
            addresses: [],
          }),
        });

        const wallet = await WalletClient.create({ words: 24 });
        
        expect(wallet.getMnemonic().split(' ')).toHaveLength(24);
      });

      it('should create wallet with custom chains', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            wallet_id: 'wid-custom',
            addresses: [],
          }),
        });

        await WalletClient.create({ chains: ['BTC', 'ETH'] });
        
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/web-wallet/create'),
          expect.objectContaining({
            method: 'POST',
          })
        );
      });

      it('should handle API errors', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          json: () => Promise.resolve({
            error: 'Server error',
          }),
        });

        await expect(WalletClient.create()).rejects.toThrow('Server error');
      });
    });

    describe('WalletClient.fromSeed', () => {
      it('should import wallet from valid mnemonic', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            wallet_id: 'wid-imported',
            imported: true,
          }),
        });

        const wallet = await WalletClient.fromSeed(TEST_MNEMONIC);
        
        expect(wallet).toBeInstanceOf(WalletClient);
        expect(wallet.getMnemonic()).toBe(TEST_MNEMONIC);
        expect(wallet.getWalletId()).toBe('wid-imported');
      });

      it('should throw error for invalid mnemonic', async () => {
        await expect(
          WalletClient.fromSeed('invalid mnemonic')
        ).rejects.toThrow('Invalid mnemonic phrase');
      });

      it('should import with custom chains', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            wallet_id: 'wid-custom-import',
            imported: true,
          }),
        });

        await WalletClient.fromSeed(TEST_MNEMONIC, { chains: ['BTC'] });
        
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/web-wallet/import'),
          expect.anything()
        );
      });

      it('should trim whitespace from mnemonic', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            wallet_id: 'wid-trimmed',
            imported: true,
          }),
        });

        const wallet = await WalletClient.fromSeed(`  ${TEST_MNEMONIC}  `);
        
        expect(wallet.getMnemonic()).toBe(TEST_MNEMONIC);
      });
    });

    describe('wallet instance methods', () => {
      let wallet;

      beforeEach(async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            wallet_id: 'wid-instance',
            addresses: [],
          }),
        });

        wallet = await WalletClient.create();
        mockFetch.mockClear();
      });

      it('getMnemonic should return the mnemonic', () => {
        const mnemonic = wallet.getMnemonic();
        expect(mnemonic).toBeTruthy();
        expect(typeof mnemonic).toBe('string');
      });

      it('getWalletId should return the wallet ID', () => {
        expect(wallet.getWalletId()).toBe('wid-instance');
      });

      describe('getAddresses', () => {
        it('should fetch addresses', async () => {
          mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
              addresses: [
                { chain: 'BTC', address: 'bc1q...' },
                { chain: 'ETH', address: '0x...' },
              ],
              total: 2,
            }),
          });

          const result = await wallet.getAddresses();
          
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('/web-wallet/wid-instance/addresses'),
            expect.anything()
          );
          expect(result.addresses).toHaveLength(2);
        });

        it('should filter by chain', async () => {
          mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
              addresses: [{ chain: 'BTC', address: 'bc1q...' }],
              total: 1,
            }),
          });

          await wallet.getAddresses({ chain: 'BTC' });
          
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('chain=BTC'),
            expect.anything()
          );
        });
      });

      describe('getBalances', () => {
        it('should fetch balances', async () => {
          mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
              balances: [
                { chain: 'BTC', balance: '0.5' },
                { chain: 'ETH', balance: '2.0' },
              ],
            }),
          });

          const result = await wallet.getBalances();
          
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('/web-wallet/wid-instance/balances'),
            expect.anything()
          );
          expect(result.balances).toHaveLength(2);
        });

        it('should force refresh when specified', async () => {
          mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ balances: [] }),
          });

          await wallet.getBalances({ refresh: true });
          
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('refresh=true'),
            expect.anything()
          );
        });
      });

      describe('getBalance', () => {
        it('should get balance for specific chain', async () => {
          mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
              balances: [{ chain: 'ETH', balance: '1.5' }],
            }),
          });

          const result = await wallet.getBalance('ETH');
          
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('chain=ETH'),
            expect.anything()
          );
        });
      });

      describe('getHistory', () => {
        it('should fetch transaction history', async () => {
          mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
              transactions: [
                { tx_id: 'tx1', chain: 'BTC', amount: '0.1' },
              ],
              total: 1,
            }),
          });

          const result = await wallet.getHistory();
          
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('/transactions'),
            expect.anything()
          );
        });

        it('should apply filters', async () => {
          mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ transactions: [], total: 0 }),
          });

          await wallet.getHistory({ chain: 'ETH', limit: 10 });
          
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('chain=ETH'),
            expect.anything()
          );
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('limit=10'),
            expect.anything()
          );
        });
      });

      describe('estimateFee', () => {
        it('should estimate fees for a chain', async () => {
          mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
              chain: 'ETH',
              estimates: [
                { priority: 'low', fee: '0.001' },
                { priority: 'medium', fee: '0.002' },
                { priority: 'high', fee: '0.003' },
              ],
            }),
          });

          const result = await wallet.estimateFee('ETH');
          
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('/estimate-fee'),
            expect.objectContaining({ method: 'POST' })
          );
        });
      });

      describe('deriveAddress', () => {
        it('should derive new address', async () => {
          mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
              address_id: 'addr-1',
              chain: 'ETH',
              address: '0x123...',
              derivation_index: 1,
            }),
          });

          const result = await wallet.deriveAddress('ETH', 1);
          
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('/derive'),
            expect.objectContaining({ method: 'POST' })
          );
        });
      });
    });
  });

  describe('backupSeed and restoreFromBackup', () => {
    // These tests require Web Crypto API which may not be available in Node.js test environment
    // Skipping for now but including structure for when crypto is available
    
    it.skip('should encrypt and decrypt seed phrase', async () => {
      // This test requires globalThis.crypto to be available
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          wallet_id: 'wid-backup-test',
          addresses: [],
        }),
      });
      global.fetch = mockFetch;

      const wallet = await WalletClient.create();
      const password = 'test-password-123';
      
      const encrypted = await wallet.backupSeed(password);
      expect(typeof encrypted).toBe('string');
      expect(encrypted.length).toBeGreaterThan(0);
      
      const decrypted = await restoreFromBackup(encrypted, password);
      expect(decrypted).toBe(wallet.getMnemonic());
    });
  });
});
