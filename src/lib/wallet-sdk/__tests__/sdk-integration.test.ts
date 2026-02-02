/**
 * Wallet SDK Integration Tests
 *
 * Tests the SDK's high-level operations through the Wallet class,
 * mocking the HTTP layer to verify correct API interactions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Wallet } from '../wallet';
import { WalletAPIClient, hexToUint8Array, uint8ArrayToHex } from '../client';
import { WalletEventEmitter } from '../events';
import { WalletSDKError, InsufficientFundsError, InvalidAddressError } from '../errors';
import { generateMnemonic, isValidMnemonic, deriveWalletBundle } from '../../web-wallet/keys';

// ──────────────────────────────────────────────
// Mock Fetch for SDK API Calls
// ──────────────────────────────────────────────

const mockFetch = vi.fn();

function apiOk(data: any) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    }),
  };
}

function apiError(code: string, message: string, status: number) {
  return {
    ok: false,
    status,
    json: async () => ({
      success: false,
      data: null,
      error: { code, message },
      timestamp: new Date().toISOString(),
    }),
  };
}

const BASE_URL = 'https://test-api.coinpayportal.com';

// ──────────────────────────────────────────────
// Wallet.create() Tests
// ──────────────────────────────────────────────

describe('SDK Integration - Wallet.create()', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should create a wallet and register with API', async () => {
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-new-001',
      created_at: '2025-01-01T00:00:00Z',
      addresses: [],
    }));

    const wallet = await Wallet.create({
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['ETH'],
      words: 12,
    });

    expect(wallet.walletId).toBe('wid-new-001');
    expect(wallet.isReadOnly).toBe(false);
    expect(wallet.getMnemonic()).toBeTruthy();
    expect(isValidMnemonic(wallet.getMnemonic()!)).toBe(true);

    // Verify API was called correctly
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/web-wallet/create');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body);
    expect(body.public_key_secp256k1).toBeTruthy();
    expect(body.initial_addresses).toBeInstanceOf(Array);
    expect(body.initial_addresses.length).toBeGreaterThan(0);
    expect(body.initial_addresses[0].chain).toBe('ETH');

    wallet.destroy();
  });

  it('should create wallet with multiple chains', async () => {
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-multi-001',
      created_at: '2025-01-01T00:00:00Z',
      addresses: [],
    }));

    const wallet = await Wallet.create({
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['BTC', 'ETH', 'SOL'],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const chains = body.initial_addresses.map((a: any) => a.chain);
    expect(chains).toContain('BTC');
    expect(chains).toContain('ETH');
    expect(chains).toContain('SOL');

    wallet.destroy();
  });

  it('should create wallet with 24-word mnemonic', async () => {
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-24w',
      created_at: '2025-01-01T00:00:00Z',
      addresses: [],
    }));

    const wallet = await Wallet.create({
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['ETH'],
      words: 24,
    });

    const mnemonic = wallet.getMnemonic()!;
    expect(mnemonic.split(' ').length).toBe(24);

    wallet.destroy();
  });
});

// ──────────────────────────────────────────────
// Wallet.fromSeed() Tests
// ──────────────────────────────────────────────

describe('SDK Integration - Wallet.fromSeed()', () => {
  const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should import a wallet from mnemonic', async () => {
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-import-001',
      imported: true,
      addresses_registered: 5,
      created_at: '2025-01-01T00:00:00Z',
    }));

    const wallet = await Wallet.fromSeed(testMnemonic, {
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['BTC', 'ETH'],
    });

    expect(wallet.walletId).toBe('wid-import-001');
    expect(wallet.isReadOnly).toBe(false);
    expect(wallet.getMnemonic()).toBe(testMnemonic);

    // Should have sent proof of ownership
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.proof_of_ownership).toBeDefined();
    expect(body.proof_of_ownership.message).toContain('coinpayportal:import:');
    expect(body.proof_of_ownership.signature).toBeTruthy();

    wallet.destroy();
  });

  it('should reject invalid mnemonic', async () => {
    await expect(
      Wallet.fromSeed('invalid mnemonic phrase here', {
        baseUrl: BASE_URL,
        fetch: mockFetch as any,
      })
    ).rejects.toThrow('Invalid BIP39 mnemonic phrase');
  });

  it('should handle already-existing wallet import', async () => {
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-existing',
      imported: true,
      already_exists: true,
    }));

    const wallet = await Wallet.fromSeed(testMnemonic, {
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
    });

    expect(wallet.walletId).toBe('wid-existing');
    wallet.destroy();
  });
});

// ──────────────────────────────────────────────
// Wallet.fromWalletId() Tests
// ──────────────────────────────────────────────

describe('SDK Integration - Wallet.fromWalletId()', () => {
  it('should create read-only wallet', () => {
    const wallet = Wallet.fromWalletId('wid-readonly', {
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
    });

    expect(wallet.walletId).toBe('wid-readonly');
    expect(wallet.isReadOnly).toBe(true);
    expect(wallet.getMnemonic()).toBeNull();

    wallet.destroy();
  });

  it('should create wallet with auth token', () => {
    const wallet = Wallet.fromWalletId('wid-auth', {
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      authToken: 'jwt-token-123',
      authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    expect(wallet.walletId).toBe('wid-auth');
    expect(wallet.isReadOnly).toBe(true); // Still read-only (no private keys)

    wallet.destroy();
  });
});

// ──────────────────────────────────────────────
// Wallet Address Operations
// ──────────────────────────────────────────────

describe('SDK Integration - Address Operations', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should get addresses from API', async () => {
    // Create wallet first
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-addr-001',
      created_at: '2025-01-01T00:00:00Z',
      addresses: [],
    }));

    const wallet = await Wallet.create({
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['ETH'],
    });

    // Now mock getAddresses
    mockFetch.mockResolvedValueOnce(apiOk({
      addresses: [
        {
          address_id: 'addr-001',
          chain: 'ETH',
          address: '0x1234567890abcdef1234567890abcdef12345678',
          derivation_index: 0,
          is_active: true,
          cached_balance: '1.5',
        },
      ],
    }));

    const addresses = await wallet.getAddresses();
    expect(addresses).toHaveLength(1);
    expect(addresses[0].chain).toBe('ETH');
    expect(addresses[0].address).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(addresses[0].cachedBalance).toBe('1.5');

    wallet.destroy();
  });

  it('should filter addresses by chain', async () => {
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-filter',
      created_at: '2025-01-01T00:00:00Z',
      addresses: [],
    }));

    const wallet = await Wallet.create({
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['ETH'],
    });

    mockFetch.mockResolvedValueOnce(apiOk({
      addresses: [
        { address_id: 'a1', chain: 'BTC', address: '1ABC', derivation_index: 0, is_active: true },
      ],
    }));

    await wallet.getAddresses({ chain: 'BTC' });

    const [url] = mockFetch.mock.calls[1];
    expect(url).toContain('chain=BTC');

    wallet.destroy();
  });

  it('should derive a new address', async () => {
    const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-derive',
      imported: true,
      addresses_registered: 1,
    }));

    const wallet = await Wallet.fromSeed(testMnemonic, {
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['ETH'],
    });

    // Mock getAddresses for next index calculation
    mockFetch.mockResolvedValueOnce(apiOk({
      addresses: [
        { address_id: 'a0', chain: 'ETH', address: '0x...', derivation_index: 0, is_active: true },
      ],
    }));

    // Mock derive endpoint
    mockFetch.mockResolvedValueOnce(apiOk({
      address_id: 'a1',
      chain: 'ETH',
      address: '0xnewaddr',
      derivation_index: 1,
      derivation_path: "m/44'/60'/0'/0/1",
      created_at: '2025-01-01T00:00:00Z',
    }));

    const result = await wallet.deriveAddress('ETH');
    expect(result.chain).toBe('ETH');
    expect(result.derivationIndex).toBe(1);

    wallet.destroy();
  });

  it('should reject derive on read-only wallet', async () => {
    const wallet = Wallet.fromWalletId('wid-ro', {
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
    });

    await expect(wallet.deriveAddress('ETH')).rejects.toThrow('read-only');

    wallet.destroy();
  });
});

// ──────────────────────────────────────────────
// Wallet Balance & Transaction Operations
// ──────────────────────────────────────────────

describe('SDK Integration - Balances & Transactions', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should fetch balances', async () => {
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-bal',
      created_at: '2025-01-01T00:00:00Z',
      addresses: [],
    }));

    const wallet = await Wallet.create({
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['ETH'],
    });

    mockFetch.mockResolvedValueOnce(apiOk({
      balances: [
        { chain: 'ETH', address: '0xabc', balance: '2.5', updated_at: '2025-01-01T00:00:00Z' },
      ],
    }));

    const balances = await wallet.getBalances();
    expect(balances).toHaveLength(1);
    expect(balances[0].balance).toBe('2.5');
    expect(balances[0].chain).toBe('ETH');

    wallet.destroy();
  });

  it('should fetch total balance in USD', async () => {
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-usd',
      created_at: '2025-01-01T00:00:00Z',
      addresses: [],
    }));

    const wallet = await Wallet.create({
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['ETH'],
    });

    mockFetch.mockResolvedValueOnce(apiOk({
      total_usd: 5000.50,
      balances: [
        { chain: 'ETH', address: '0xabc', balance: '2.0', usd_value: 5000.50, rate: 2500.25, updated_at: '2025-01-01' },
      ],
    }));

    const result = await wallet.getTotalBalanceUSD();
    expect(result.totalUsd).toBe(5000.50);
    expect(result.balances[0].usdValue).toBe(5000.50);

    wallet.destroy();
  });

  it('should fetch transaction history with pagination', async () => {
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-txhist',
      created_at: '2025-01-01T00:00:00Z',
      addresses: [],
    }));

    const wallet = await Wallet.create({
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['ETH'],
    });

    mockFetch.mockResolvedValueOnce(apiOk({
      transactions: [
        {
          id: 'tx-001',
          wallet_id: 'wid-txhist',
          chain: 'ETH',
          tx_hash: '0xhash',
          direction: 'outgoing',
          status: 'confirmed',
          amount: '1.0',
          from_address: '0xabc',
          to_address: '0xdef',
          confirmations: 12,
          created_at: '2025-01-01T00:00:00Z',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    }));

    const txList = await wallet.getTransactions({ chain: 'ETH', limit: 50, offset: 0 });
    expect(txList.transactions).toHaveLength(1);
    expect(txList.transactions[0].chain).toBe('ETH');
    expect(txList.transactions[0].direction).toBe('outgoing');
    expect(txList.total).toBe(1);

    wallet.destroy();
  });
});

// ──────────────────────────────────────────────
// Wallet Send Flow (Prepare → Sign → Broadcast)
// ──────────────────────────────────────────────

describe('SDK Integration - Send Flow', () => {
  const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should execute full send flow: prepare → sign → broadcast', async () => {
    // Create wallet via import (so we have private keys)
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-send',
      imported: true,
      addresses_registered: 1,
    }));

    const wallet = await Wallet.fromSeed(testMnemonic, {
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['ETH'],
    });

    // Need the actual address to match private key
    const bundle = await deriveWalletBundle(testMnemonic, ['ETH']);
    const ethAddr = bundle.addresses.find(a => a.chain === 'ETH')!;

    // Mock prepare-tx
    mockFetch.mockResolvedValueOnce(apiOk({
      tx_id: 'tx-prepared-001',
      chain: 'ETH',
      from_address: ethAddr.address,
      to_address: '0x1234567890abcdef1234567890abcdef12345678',
      amount: '0.01',
      fee: '0.0001',
      expires_at: new Date(Date.now() + 300_000).toISOString(),
      unsigned_tx: {
        type: 'evm',
        chainId: '1',
        nonce: '0',
        maxPriorityFeePerGas: '1500000000',
        maxFeePerGas: '30000000000',
        gasLimit: '21000',
        to: '0x1234567890abcdef1234567890abcdef12345678',
        value: '10000000000000000',
        data: '',
      },
    }));

    // Mock broadcast
    mockFetch.mockResolvedValueOnce(apiOk({
      tx_hash: '0xtxhash123',
      chain: 'ETH',
      status: 'confirming',
      explorer_url: 'https://etherscan.io/tx/0xtxhash123',
    }));

    const result = await wallet.send({
      fromAddress: ethAddr.address,
      toAddress: '0x1234567890abcdef1234567890abcdef12345678',
      chain: 'ETH',
      amount: '0.01',
      priority: 'medium',
    });

    expect(result.txHash).toBe('0xtxhash123');
    expect(result.chain).toBe('ETH');
    expect(result.status).toBe('confirming');
    expect(result.explorerUrl).toContain('etherscan.io');

    // Verify the correct sequence of API calls was made
    const calls = mockFetch.mock.calls;
    expect(calls[1][0]).toContain('/prepare-tx'); // prepare
    expect(calls[2][0]).toContain('/broadcast');   // broadcast

    // Verify broadcast body contains signed_tx
    const broadcastBody = JSON.parse(calls[2][1].body);
    expect(broadcastBody.signed_tx).toBeTruthy();
    expect(broadcastBody.tx_id).toBe('tx-prepared-001');

    wallet.destroy();
  });

  it('should throw when no private key available', async () => {
    const wallet = Wallet.fromWalletId('wid-nopk', {
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
    });

    await expect(
      wallet.send({
        fromAddress: '0xunknown',
        toAddress: '0xdest',
        chain: 'ETH',
        amount: '0.01',
      })
    ).rejects.toThrow('No private key');

    wallet.destroy();
  });

  it('should estimate fees', async () => {
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-fees',
      created_at: '2025-01-01T00:00:00Z',
      addresses: [],
    }));

    const wallet = await Wallet.create({
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['ETH'],
    });

    mockFetch.mockResolvedValueOnce(apiOk({
      low: { fee: '0.0001', feeCurrency: 'ETH' },
      medium: { fee: '0.0002', feeCurrency: 'ETH' },
      high: { fee: '0.0005', feeCurrency: 'ETH' },
    }));

    const fees = await wallet.estimateFee('ETH');
    expect(fees).toHaveProperty('low');
    expect(fees).toHaveProperty('medium');
    expect(fees).toHaveProperty('high');

    wallet.destroy();
  });
});

// ──────────────────────────────────────────────
// Wallet Settings
// ──────────────────────────────────────────────

describe('SDK Integration - Settings', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should get wallet settings', async () => {
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-settings',
      created_at: '2025-01-01T00:00:00Z',
      addresses: [],
    }));

    const wallet = await Wallet.create({
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['ETH'],
    });

    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-settings',
      daily_spend_limit: '1000',
      whitelist_addresses: ['0xabc'],
      whitelist_enabled: true,
      require_confirmation: false,
      confirmation_delay_seconds: 0,
    }));

    const settings = await wallet.getSettings();
    expect(settings.dailySpendLimit).toBe('1000');
    expect(settings.whitelistEnabled).toBe(true);
    expect(settings.whitelistAddresses).toContain('0xabc');

    wallet.destroy();
  });

  it('should update wallet settings', async () => {
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-settings2',
      created_at: '2025-01-01T00:00:00Z',
      addresses: [],
    }));

    const wallet = await Wallet.create({
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['ETH'],
    });

    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-settings2',
      daily_spend_limit: '500',
      whitelist_addresses: [],
      whitelist_enabled: false,
      require_confirmation: true,
      confirmation_delay_seconds: 30,
    }));

    const settings = await wallet.updateSettings({
      dailySpendLimit: '500',
      requireConfirmation: true,
      confirmationDelaySeconds: 30,
    });

    expect(settings.dailySpendLimit).toBe('500');
    expect(settings.requireConfirmation).toBe(true);

    wallet.destroy();
  });
});

// ──────────────────────────────────────────────
// Wallet Webhooks
// ──────────────────────────────────────────────

describe('SDK Integration - Webhooks', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should register a webhook', async () => {
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-wh',
      created_at: '2025-01-01T00:00:00Z',
      addresses: [],
    }));

    const wallet = await Wallet.create({
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['ETH'],
    });

    mockFetch.mockResolvedValueOnce(apiOk({
      id: 'wh-001',
      url: 'https://example.com/webhook',
      events: ['transaction.incoming', 'balance.changed'],
      is_active: true,
      secret: 'whsec_123',
      created_at: '2025-01-01T00:00:00Z',
    }));

    const wh = await wallet.registerWebhook({
      url: 'https://example.com/webhook',
      events: ['transaction.incoming', 'balance.changed'],
    });

    expect(wh.id).toBe('wh-001');
    expect(wh.url).toBe('https://example.com/webhook');
    expect(wh.secret).toBe('whsec_123');

    wallet.destroy();
  });

  it('should list webhooks', async () => {
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-whlist',
      created_at: '2025-01-01T00:00:00Z',
      addresses: [],
    }));

    const wallet = await Wallet.create({
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['ETH'],
    });

    mockFetch.mockResolvedValueOnce(apiOk({
      webhooks: [
        {
          id: 'wh-001',
          url: 'https://example.com/webhook',
          events: ['transaction.incoming'],
          is_active: true,
          created_at: '2025-01-01T00:00:00Z',
        },
      ],
    }));

    const list = await wallet.listWebhooks();
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe('https://example.com/webhook');

    wallet.destroy();
  });
});

// ──────────────────────────────────────────────
// Wallet Lifecycle
// ──────────────────────────────────────────────

describe('SDK Integration - Lifecycle', () => {
  it('should clear all sensitive data on destroy', async () => {
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-destroy',
      created_at: '2025-01-01T00:00:00Z',
      addresses: [],
    }));

    const wallet = await Wallet.create({
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['ETH'],
    });

    expect(wallet.getMnemonic()).toBeTruthy();
    expect(wallet.isReadOnly).toBe(false);

    wallet.destroy();

    expect(wallet.getMnemonic()).toBeNull();
  });

  it('should support events polling lifecycle', async () => {
    mockFetch.mockResolvedValueOnce(apiOk({
      wallet_id: 'wid-events',
      created_at: '2025-01-01T00:00:00Z',
      addresses: [],
    }));

    const wallet = await Wallet.create({
      baseUrl: BASE_URL,
      fetch: mockFetch as any,
      chains: ['ETH'],
    });

    const handler = vi.fn();
    wallet.on('transaction.incoming', handler);

    // Start and immediately stop (no actual poll happens)
    wallet.startPolling(60000);
    wallet.stopPolling();

    // Should not throw
    wallet.off('transaction.incoming', handler);

    wallet.destroy();
  });
});

// ──────────────────────────────────────────────
// Error Types
// ──────────────────────────────────────────────

describe('SDK Error Classes', () => {
  it('should create WalletSDKError with correct properties', () => {
    const err = new WalletSDKError('SOME_CODE', 'something went wrong', 400);
    expect(err.code).toBe('SOME_CODE');
    expect(err.message).toBe('something went wrong');
    expect(err.statusCode).toBe(400);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(WalletSDKError);
  });

  it('should create InsufficientFundsError', () => {
    const err = new InsufficientFundsError('Not enough BTC');
    expect(err.code).toBe('INSUFFICIENT_FUNDS');
    expect(err).toBeInstanceOf(WalletSDKError);
  });

  it('should create InvalidAddressError', () => {
    const err = new InvalidAddressError('Bad address format');
    expect(err.code).toBe('INVALID_ADDRESS');
    expect(err).toBeInstanceOf(WalletSDKError);
  });
});

// ──────────────────────────────────────────────
// Key Derivation Integration
// ──────────────────────────────────────────────

describe('SDK Integration - Key Derivation', () => {
  it('should generate valid 12-word mnemonic', () => {
    const mnemonic = generateMnemonic(12);
    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(isValidMnemonic(mnemonic)).toBe(true);
  });

  it('should generate valid 24-word mnemonic', () => {
    const mnemonic = generateMnemonic(24);
    expect(mnemonic.split(' ')).toHaveLength(24);
    expect(isValidMnemonic(mnemonic)).toBe(true);
  });

  it('should derive wallet bundle with all chains', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const bundle = await deriveWalletBundle(mnemonic, ['BTC', 'BCH', 'ETH', 'POL', 'SOL']);

    expect(bundle.publicKeySecp256k1).toBeTruthy();
    expect(bundle.publicKeyEd25519).toBeTruthy();
    expect(bundle.addresses).toHaveLength(5);

    const chains = bundle.addresses.map(a => a.chain);
    expect(chains).toContain('BTC');
    expect(chains).toContain('BCH');
    expect(chains).toContain('ETH');
    expect(chains).toContain('POL');
    expect(chains).toContain('SOL');

    // All addresses should be valid strings
    for (const addr of bundle.addresses) {
      expect(addr.address.length).toBeGreaterThan(10);
      expect(addr.privateKey.length).toBe(64); // 32 bytes hex
      expect(addr.publicKey.length).toBeGreaterThan(0);
      expect(addr.derivationPath).toMatch(/^m\/44'/);
    }
  });

  it('should derive deterministic addresses from same mnemonic', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    const bundle1 = await deriveWalletBundle(mnemonic, ['ETH']);
    const bundle2 = await deriveWalletBundle(mnemonic, ['ETH']);

    expect(bundle1.addresses[0].address).toBe(bundle2.addresses[0].address);
    expect(bundle1.addresses[0].privateKey).toBe(bundle2.addresses[0].privateKey);
    expect(bundle1.publicKeySecp256k1).toBe(bundle2.publicKeySecp256k1);
  });
});
