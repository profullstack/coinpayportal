/**
 * Comprehensive tests for key derivation across all supported chains.
 * Tests address format, derivation consistency, and known test vectors.
 */

import { describe, it, expect } from 'vitest';
import {
  generateMnemonic,
  isValidMnemonic,
  deriveKeyForChain,
  deriveWalletBundle,
  DERIVABLE_CHAINS,
  DERIVABLE_CHAIN_INFO,
  type DerivableChain,
} from './keys';
import { validateAddress } from './identity';

// Standard test mnemonic (DO NOT use in production!)
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('Mnemonic Generation', () => {
  it('generates valid 12-word mnemonic', () => {
    const mnemonic = generateMnemonic(12);
    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(isValidMnemonic(mnemonic)).toBe(true);
  });

  it('generates valid 24-word mnemonic', () => {
    const mnemonic = generateMnemonic(24);
    expect(mnemonic.split(' ')).toHaveLength(24);
    expect(isValidMnemonic(mnemonic)).toBe(true);
  });

  it('validates test mnemonic', () => {
    expect(isValidMnemonic(TEST_MNEMONIC)).toBe(true);
  });

  it('rejects invalid mnemonic', () => {
    expect(isValidMnemonic('invalid mnemonic phrase')).toBe(false);
    expect(isValidMnemonic('')).toBe(false);
  });
});

describe('DERIVABLE_CHAINS constant', () => {
  it('contains all expected chains', () => {
    expect(DERIVABLE_CHAINS).toContain('BTC');
    expect(DERIVABLE_CHAINS).toContain('BCH');
    expect(DERIVABLE_CHAINS).toContain('ETH');
    expect(DERIVABLE_CHAINS).toContain('POL');
    expect(DERIVABLE_CHAINS).toContain('SOL');
    expect(DERIVABLE_CHAINS).toContain('DOGE');
    expect(DERIVABLE_CHAINS).toContain('XRP');
    expect(DERIVABLE_CHAINS).toContain('ADA');
    expect(DERIVABLE_CHAINS).toContain('BNB');
    expect(DERIVABLE_CHAINS).toContain('USDC_ETH');
    expect(DERIVABLE_CHAINS).toContain('USDC_POL');
    expect(DERIVABLE_CHAINS).toContain('USDC_SOL');
    expect(DERIVABLE_CHAINS).toContain('USDT_ETH');
    expect(DERIVABLE_CHAINS).toContain('USDT_POL');
    expect(DERIVABLE_CHAINS).toContain('USDT_SOL');
  });

  it('has info for all chains', () => {
    for (const chain of DERIVABLE_CHAINS) {
      expect(DERIVABLE_CHAIN_INFO[chain]).toBeDefined();
      expect(DERIVABLE_CHAIN_INFO[chain].name).toBeTruthy();
      expect(DERIVABLE_CHAIN_INFO[chain].symbol).toBeTruthy();
    }
  });
});

describe('Bitcoin (BTC)', () => {
  it('derives valid BTC address', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'BTC', 0);
    expect(key.chain).toBe('BTC');
    expect(key.address).toMatch(/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/);
    expect(key.publicKey).toMatch(/^[0-9a-f]{66}$/); // 33 bytes compressed
    expect(key.privateKey).toMatch(/^[0-9a-f]{64}$/); // 32 bytes
    expect(key.derivationPath).toBe("m/44'/0'/0'/0/0");
    expect(key.index).toBe(0);
  });

  it('derives known BTC address for test mnemonic', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'BTC', 0);
    // Known address for "abandon..." mnemonic, BIP44 path m/44'/0'/0'/0/0
    expect(key.address).toBe('1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA');
  });

  it('derives different addresses for different indices', async () => {
    const key0 = await deriveKeyForChain(TEST_MNEMONIC, 'BTC', 0);
    const key1 = await deriveKeyForChain(TEST_MNEMONIC, 'BTC', 1);
    expect(key0.address).not.toBe(key1.address);
    expect(key0.privateKey).not.toBe(key1.privateKey);
  });

  it('validates derived BTC address', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'BTC', 0);
    expect(validateAddress(key.address, 'BTC')).toBe(true);
  });
});

describe('Bitcoin Cash (BCH)', () => {
  it('derives valid BCH CashAddr address', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'BCH', 0);
    expect(key.chain).toBe('BCH');
    expect(key.address).toMatch(/^bitcoincash:[qp][a-z0-9]{41}$/);
    expect(key.derivationPath).toBe("m/44'/145'/0'/0/0");
  });

  it('validates derived BCH address', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'BCH', 0);
    expect(validateAddress(key.address, 'BCH')).toBe(true);
  });
});

describe('Ethereum (ETH)', () => {
  it('derives valid ETH address', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'ETH', 0);
    expect(key.chain).toBe('ETH');
    expect(key.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(key.derivationPath).toBe("m/44'/60'/0'/0/0");
  });

  it('derives known ETH address for test mnemonic', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'ETH', 0);
    // Known address for "abandon..." mnemonic
    expect(key.address.toLowerCase()).toBe('0x9858effd232b4033e47d90003d41ec34ecaeda94');
  });

  it('produces EIP-55 checksummed address', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'ETH', 0);
    // Address should have mixed case (checksum)
    expect(key.address).not.toBe(key.address.toLowerCase());
    expect(key.address).not.toBe(key.address.toUpperCase());
  });

  it('validates derived ETH address', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'ETH', 0);
    expect(validateAddress(key.address, 'ETH')).toBe(true);
  });
});

describe('Polygon (POL)', () => {
  it('derives valid POL address (same as ETH)', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'POL', 0);
    expect(key.chain).toBe('POL');
    expect(key.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('POL and ETH derive same address', async () => {
    const ethKey = await deriveKeyForChain(TEST_MNEMONIC, 'ETH', 0);
    const polKey = await deriveKeyForChain(TEST_MNEMONIC, 'POL', 0);
    expect(polKey.address).toBe(ethKey.address);
  });
});

describe('BNB Smart Chain (BNB)', () => {
  it('derives valid BNB address (same as ETH)', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'BNB', 0);
    expect(key.chain).toBe('BNB');
    expect(key.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('BNB and ETH derive same address', async () => {
    const ethKey = await deriveKeyForChain(TEST_MNEMONIC, 'ETH', 0);
    const bnbKey = await deriveKeyForChain(TEST_MNEMONIC, 'BNB', 0);
    expect(bnbKey.address).toBe(ethKey.address);
  });

  it('validates derived BNB address', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'BNB', 0);
    expect(validateAddress(key.address, 'BNB')).toBe(true);
  });
});

describe('Solana (SOL)', () => {
  it('derives valid SOL address', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'SOL', 0);
    expect(key.chain).toBe('SOL');
    expect(key.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(key.derivationPath).toBe("m/44'/501'/0'/0'");
  });

  it('validates derived SOL address', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'SOL', 0);
    expect(validateAddress(key.address, 'SOL')).toBe(true);
  });
});

describe('Dogecoin (DOGE)', () => {
  it('derives valid DOGE address', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'DOGE', 0);
    expect(key.chain).toBe('DOGE');
    expect(key.address).toMatch(/^D[a-km-zA-HJ-NP-Z1-9]{25,34}$/);
    expect(key.derivationPath).toBe("m/44'/3'/0'/0/0");
  });

  it('DOGE address starts with D', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'DOGE', 0);
    expect(key.address[0]).toBe('D');
  });

  it('validates derived DOGE address', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'DOGE', 0);
    expect(validateAddress(key.address, 'DOGE')).toBe(true);
  });
});

describe('XRP (Ripple)', () => {
  it('derives valid XRP address', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'XRP', 0);
    expect(key.chain).toBe('XRP');
    expect(key.address).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/);
    expect(key.derivationPath).toBe("m/44'/144'/0'/0/0");
  });

  it('XRP address starts with r', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'XRP', 0);
    expect(key.address[0]).toBe('r');
  });

  it('validates derived XRP address', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'XRP', 0);
    expect(validateAddress(key.address, 'XRP')).toBe(true);
  });
});

describe('Cardano (ADA)', () => {
  it('derives valid ADA address', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'ADA', 0);
    expect(key.chain).toBe('ADA');
    expect(key.address).toMatch(/^addr1[a-z0-9]{50,100}$/);
    expect(key.derivationPath).toBe("m/1852'/1815'/0'/0'/0'");
  });

  it('ADA address is bech32 with addr prefix', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'ADA', 0);
    expect(key.address.startsWith('addr1')).toBe(true);
  });

  it('validates derived ADA address', async () => {
    const key = await deriveKeyForChain(TEST_MNEMONIC, 'ADA', 0);
    expect(validateAddress(key.address, 'ADA')).toBe(true);
  });
});

describe('USDC Tokens', () => {
  it('USDC_ETH derives same address as ETH', async () => {
    const ethKey = await deriveKeyForChain(TEST_MNEMONIC, 'ETH', 0);
    const usdcKey = await deriveKeyForChain(TEST_MNEMONIC, 'USDC_ETH', 0);
    expect(usdcKey.address).toBe(ethKey.address);
    expect(usdcKey.chain).toBe('USDC_ETH');
  });

  it('USDC_POL derives same address as POL', async () => {
    const polKey = await deriveKeyForChain(TEST_MNEMONIC, 'POL', 0);
    const usdcKey = await deriveKeyForChain(TEST_MNEMONIC, 'USDC_POL', 0);
    expect(usdcKey.address).toBe(polKey.address);
    expect(usdcKey.chain).toBe('USDC_POL');
  });

  it('USDC_SOL derives same address as SOL', async () => {
    const solKey = await deriveKeyForChain(TEST_MNEMONIC, 'SOL', 0);
    const usdcKey = await deriveKeyForChain(TEST_MNEMONIC, 'USDC_SOL', 0);
    expect(usdcKey.address).toBe(solKey.address);
    expect(usdcKey.chain).toBe('USDC_SOL');
  });

  it('validates USDC addresses', async () => {
    const usdcEth = await deriveKeyForChain(TEST_MNEMONIC, 'USDC_ETH', 0);
    const usdcPol = await deriveKeyForChain(TEST_MNEMONIC, 'USDC_POL', 0);
    const usdcSol = await deriveKeyForChain(TEST_MNEMONIC, 'USDC_SOL', 0);
    expect(validateAddress(usdcEth.address, 'USDC_ETH')).toBe(true);
    expect(validateAddress(usdcPol.address, 'USDC_POL')).toBe(true);
    expect(validateAddress(usdcSol.address, 'USDC_SOL')).toBe(true);
  });
});

describe('USDT Tokens', () => {
  it('USDT_ETH derives same address as ETH', async () => {
    const ethKey = await deriveKeyForChain(TEST_MNEMONIC, 'ETH', 0);
    const usdtKey = await deriveKeyForChain(TEST_MNEMONIC, 'USDT_ETH', 0);
    expect(usdtKey.address).toBe(ethKey.address);
    expect(usdtKey.chain).toBe('USDT_ETH');
  });

  it('USDT_POL derives same address as POL', async () => {
    const polKey = await deriveKeyForChain(TEST_MNEMONIC, 'POL', 0);
    const usdtKey = await deriveKeyForChain(TEST_MNEMONIC, 'USDT_POL', 0);
    expect(usdtKey.address).toBe(polKey.address);
    expect(usdtKey.chain).toBe('USDT_POL');
  });

  it('USDT_SOL derives same address as SOL', async () => {
    const solKey = await deriveKeyForChain(TEST_MNEMONIC, 'SOL', 0);
    const usdtKey = await deriveKeyForChain(TEST_MNEMONIC, 'USDT_SOL', 0);
    expect(usdtKey.address).toBe(solKey.address);
    expect(usdtKey.chain).toBe('USDT_SOL');
  });

  it('validates USDT addresses', async () => {
    const usdtEth = await deriveKeyForChain(TEST_MNEMONIC, 'USDT_ETH', 0);
    const usdtPol = await deriveKeyForChain(TEST_MNEMONIC, 'USDT_POL', 0);
    const usdtSol = await deriveKeyForChain(TEST_MNEMONIC, 'USDT_SOL', 0);
    expect(validateAddress(usdtEth.address, 'USDT_ETH')).toBe(true);
    expect(validateAddress(usdtPol.address, 'USDT_POL')).toBe(true);
    expect(validateAddress(usdtSol.address, 'USDT_SOL')).toBe(true);
  });
});

describe('Wallet Bundle', () => {
  it('derives all chains by default', async () => {
    const bundle = await deriveWalletBundle(TEST_MNEMONIC);
    expect(bundle.addresses).toHaveLength(DERIVABLE_CHAINS.length);
    
    for (const chain of DERIVABLE_CHAINS) {
      const addr = bundle.addresses.find(a => a.chain === chain);
      expect(addr).toBeDefined();
      expect(addr?.address).toBeTruthy();
    }
  });

  it('includes master keys', async () => {
    const bundle = await deriveWalletBundle(TEST_MNEMONIC);
    expect(bundle.publicKeySecp256k1).toMatch(/^[0-9a-f]{66}$/);
    expect(bundle.privateKeySecp256k1).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.publicKeyEd25519).toBeTruthy();
  });

  it('derives only specified chains', async () => {
    const bundle = await deriveWalletBundle(TEST_MNEMONIC, ['BTC', 'ETH']);
    expect(bundle.addresses).toHaveLength(2);
    expect(bundle.addresses.map(a => a.chain)).toContain('BTC');
    expect(bundle.addresses.map(a => a.chain)).toContain('ETH');
  });
});

describe('Error Handling', () => {
  it('rejects invalid mnemonic', async () => {
    await expect(deriveKeyForChain('invalid phrase', 'BTC', 0))
      .rejects.toThrow('Invalid mnemonic');
  });

  it('rejects unsupported chain', async () => {
    await expect(deriveKeyForChain(TEST_MNEMONIC, 'FAKE' as any, 0))
      .rejects.toThrow('Unsupported chain');
  });
});

describe('Derivation Consistency', () => {
  it('produces same keys for same mnemonic', async () => {
    const key1 = await deriveKeyForChain(TEST_MNEMONIC, 'BTC', 0);
    const key2 = await deriveKeyForChain(TEST_MNEMONIC, 'BTC', 0);
    expect(key1.address).toBe(key2.address);
    expect(key1.privateKey).toBe(key2.privateKey);
  });

  it('produces different keys for different mnemonics', async () => {
    const mnemonic2 = generateMnemonic(12);
    const key1 = await deriveKeyForChain(TEST_MNEMONIC, 'ETH', 0);
    const key2 = await deriveKeyForChain(mnemonic2, 'ETH', 0);
    expect(key1.address).not.toBe(key2.address);
  });

  it('all chains produce unique addresses', async () => {
    const bundle = await deriveWalletBundle(TEST_MNEMONIC);
    
    // Native chains should have unique addresses (tokens share parent address)
    const nativeChains = ['BTC', 'BCH', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA'] as const;
    const nativeAddresses = bundle.addresses
      .filter(a => nativeChains.includes(a.chain as any))
      .map(a => a.address);
    
    const uniqueAddresses = new Set(nativeAddresses);
    expect(uniqueAddresses.size).toBe(nativeAddresses.length);
  });
});
