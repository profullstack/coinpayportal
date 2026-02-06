import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Wallet } from './wallet';
import { WalletSDKError } from './errors';

const mockFetch = vi.fn();

function okResponse(data: any, status = 200) {
  return {
    ok: true,
    status,
    json: async () => ({
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    }),
  };
}

function errorResponse(code: string, message: string, status: number) {
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

const SDK_CONFIG = {
  baseUrl: 'https://api.example.com',
  fetch: mockFetch as any,
};

describe('Wallet', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('Wallet.create()', () => {
    it('should generate mnemonic, derive keys, and register with API', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          wallet_id: 'w-new',
          created_at: '2024-01-01T00:00:00Z',
          addresses: [
            { chain: 'ETH', address: '0xabc', derivation_index: 0 },
          ],
        })
      );

      const wallet = await Wallet.create({
        ...SDK_CONFIG,
        chains: ['ETH'],
        words: 12,
      });

      expect(wallet.walletId).toBe('w-new');
      expect(wallet.isReadOnly).toBe(false);
      expect(wallet.getMnemonic()).toBeTruthy();
      expect(wallet.getMnemonic()!.split(' ').length).toBe(12);

      // Verify the create API was called
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain('/api/web-wallet/create');
      const body = JSON.parse(call[1].body);
      expect(body.public_key_secp256k1).toBeTruthy();
      expect(body.initial_addresses).toHaveLength(1);
      expect(body.initial_addresses[0].chain).toBe('ETH');
    });

    it('should store private keys for derived addresses', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          wallet_id: 'w-keys',
          created_at: '2024-01-01T00:00:00Z',
          addresses: [],
        })
      );

      const wallet = await Wallet.create({
        ...SDK_CONFIG,
        chains: ['ETH', 'BTC'],
      });

      // Wallet should not be read-only since it has keys
      expect(wallet.isReadOnly).toBe(false);
    });
  });

  describe('Wallet.fromSeed()', () => {
    it('should reject invalid mnemonic', async () => {
      await expect(
        Wallet.fromSeed('invalid mnemonic words here', SDK_CONFIG)
      ).rejects.toThrow(WalletSDKError);
    });

    it('should derive keys and register via import endpoint', async () => {
      // Generate a valid mnemonic first
      const { generateMnemonic } = await import('../web-wallet/keys');
      const mnemonic = generateMnemonic(12);

      mockFetch.mockResolvedValueOnce(
        okResponse({
          wallet_id: 'w-imported',
          imported: true,
          addresses_registered: 5,
          created_at: '2024-01-01T00:00:00Z',
        })
      );

      const wallet = await Wallet.fromSeed(mnemonic, {
        ...SDK_CONFIG,
        chains: ['ETH'],
      });

      expect(wallet.walletId).toBe('w-imported');
      expect(wallet.isReadOnly).toBe(false);
      expect(wallet.getMnemonic()).toBe(mnemonic);

      // Verify import endpoint was called with proof_of_ownership
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.proof_of_ownership).toBeTruthy();
      expect(body.proof_of_ownership.message).toContain('coinpayportal:import:');
      expect(body.proof_of_ownership.signature).toBeTruthy();
    });
  });

  describe('Wallet.fromWalletId()', () => {
    it('should create a read-only wallet', () => {
      const wallet = Wallet.fromWalletId('w-readonly', SDK_CONFIG);

      expect(wallet.walletId).toBe('w-readonly');
      expect(wallet.isReadOnly).toBe(true);
      expect(wallet.getMnemonic()).toBeNull();
    });

    it('should accept pre-obtained JWT token', async () => {
      const wallet = Wallet.fromWalletId('w-jwt', {
        ...SDK_CONFIG,
        authToken: 'my-jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      mockFetch.mockResolvedValueOnce(
        okResponse({
          wallet_id: 'w-jwt',
          status: 'active',
          created_at: '2024-01-01T00:00:00Z',
          last_active_at: null,
          address_count: 3,
          settings: {},
        })
      );

      await wallet.getInfo();

      const authHeader = mockFetch.mock.calls[0][1].headers['Authorization'];
      expect(authHeader).toBe('Bearer my-jwt');
    });
  });

  describe('getInfo()', () => {
    it('should fetch wallet info and map to SDK types', async () => {
      const wallet = Wallet.fromWalletId('w1', {
        ...SDK_CONFIG,
        authToken: 'jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      mockFetch.mockResolvedValueOnce(
        okResponse({
          wallet_id: 'w1',
          status: 'active',
          created_at: '2024-01-01T00:00:00Z',
          last_active_at: '2024-01-02T00:00:00Z',
          address_count: 5,
          settings: {
            daily_spend_limit: 1000,
            whitelist_enabled: true,
            require_confirmation: false,
          },
        })
      );

      const info = await wallet.getInfo();

      expect(info.walletId).toBe('w1');
      expect(info.status).toBe('active');
      expect(info.addressCount).toBe(5);
      expect(info.settings.dailySpendLimit).toBe(1000);
      expect(info.settings.whitelistEnabled).toBe(true);
    });
  });

  describe('getAddresses()', () => {
    it('should list addresses and map snake_case to camelCase', async () => {
      const wallet = Wallet.fromWalletId('w1', {
        ...SDK_CONFIG,
        authToken: 'jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      mockFetch.mockResolvedValueOnce(
        okResponse({
          addresses: [
            {
              address_id: 'a1',
              chain: 'ETH',
              address: '0xabc',
              derivation_index: 0,
              is_active: true,
              cached_balance: '1.5',
            },
          ],
          total: 1,
        })
      );

      const addresses = await wallet.getAddresses();

      expect(addresses).toHaveLength(1);
      expect(addresses[0].addressId).toBe('a1');
      expect(addresses[0].chain).toBe('ETH');
      expect(addresses[0].derivationIndex).toBe(0);
      expect(addresses[0].isActive).toBe(true);
      expect(addresses[0].cachedBalance).toBe('1.5');
    });
  });

  describe('deriveAddress()', () => {
    it('should throw in read-only mode', async () => {
      const wallet = Wallet.fromWalletId('w1', SDK_CONFIG);

      await expect(wallet.deriveAddress('ETH')).rejects.toThrow(
        'read-only mode'
      );
    });

    it('should derive key locally and register with API', async () => {
      // Create a wallet first to get mnemonic
      mockFetch
        .mockResolvedValueOnce(
          okResponse({
            wallet_id: 'w1',
            created_at: '2024-01-01T00:00:00Z',
            addresses: [],
          })
        )
        // getAddresses call for next index
        .mockResolvedValueOnce(
          okResponse({
            addresses: [
              { address_id: 'a0', chain: 'ETH', address: '0xfirst', derivation_index: 0 },
            ],
            total: 1,
          })
        )
        // derive endpoint
        .mockResolvedValueOnce(
          okResponse({
            address_id: 'a-new',
            chain: 'ETH',
            address: '0xnewaddr',
            derivation_index: 1,
            derivation_path: "m/44'/60'/0'/0/1",
            created_at: '2024-01-01T00:00:00Z',
          })
        );

      const wallet = await Wallet.create({
        ...SDK_CONFIG,
        chains: ['ETH'],
      });

      const result = await wallet.deriveAddress('ETH');

      expect(result.addressId).toBe('a-new');
      expect(result.derivationIndex).toBe(1);
      expect(result.chain).toBe('ETH');
    });
  });

  describe('getBalances()', () => {
    it('should fetch all balances', async () => {
      const wallet = Wallet.fromWalletId('w1', {
        ...SDK_CONFIG,
        authToken: 'jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      mockFetch.mockResolvedValueOnce(
        okResponse({
          balances: [
            {
              balance: '1.5',
              chain: 'ETH',
              address: '0xabc',
              updated_at: '2024-01-01T00:00:00Z',
            },
            {
              balance: '0.01',
              chain: 'BTC',
              address: '1abc',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
        })
      );

      const balances = await wallet.getBalances();

      expect(balances).toHaveLength(2);
      expect(balances[0].balance).toBe('1.5');
      expect(balances[0].chain).toBe('ETH');
      expect(balances[1].chain).toBe('BTC');
    });

    it('should support chain filter', async () => {
      const wallet = Wallet.fromWalletId('w1', {
        ...SDK_CONFIG,
        authToken: 'jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      mockFetch.mockResolvedValueOnce(okResponse({ balances: [] }));

      await wallet.getBalances({ chain: 'ETH' });

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('chain=ETH');
    });
  });

  describe('getBalance()', () => {
    it('should fetch balance for a single address', async () => {
      const wallet = Wallet.fromWalletId('w1', {
        ...SDK_CONFIG,
        authToken: 'jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      mockFetch.mockResolvedValueOnce(
        okResponse({
          balance: '2.5',
          chain: 'ETH',
          address: '0xabc',
          updated_at: '2024-01-01T00:00:00Z',
        })
      );

      const balance = await wallet.getBalance('addr-1');

      expect(balance.balance).toBe('2.5');
      expect(balance.chain).toBe('ETH');
      expect(mockFetch.mock.calls[0][0]).toContain('/addresses/addr-1/balance');
    });
  });

  describe('getTransactions()', () => {
    it('should fetch transaction history with pagination', async () => {
      const wallet = Wallet.fromWalletId('w1', {
        ...SDK_CONFIG,
        authToken: 'jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      mockFetch.mockResolvedValueOnce(
        okResponse({
          transactions: [
            {
              id: 'tx-1',
              wallet_id: 'w1',
              chain: 'ETH',
              tx_hash: '0xhash',
              direction: 'incoming',
              status: 'confirmed',
              amount: '1000000000000000000',
              from_address: '0xsender',
              to_address: '0xreceiver',
              fee_amount: '21000',
              fee_currency: 'ETH',
              confirmations: 12,
              block_number: 123456,
              block_timestamp: '2024-01-01T00:00:00Z',
              created_at: '2024-01-01T00:00:00Z',
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
        })
      );

      const result = await wallet.getTransactions({ chain: 'ETH', limit: 10 });

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].txHash).toBe('0xhash');
      expect(result.transactions[0].direction).toBe('incoming');
      expect(result.total).toBe(1);
    });
  });

  describe('getTransaction()', () => {
    it('should fetch a single transaction', async () => {
      const wallet = Wallet.fromWalletId('w1', {
        ...SDK_CONFIG,
        authToken: 'jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      mockFetch.mockResolvedValueOnce(
        okResponse({
          id: 'tx-1',
          wallet_id: 'w1',
          chain: 'BTC',
          tx_hash: 'btchash',
          direction: 'outgoing',
          status: 'confirmed',
          amount: '50000',
          from_address: '1abc',
          to_address: '1def',
          confirmations: 3,
          created_at: '2024-01-01T00:00:00Z',
        })
      );

      const tx = await wallet.getTransaction('tx-1');

      expect(tx.txHash).toBe('btchash');
      expect(tx.direction).toBe('outgoing');
      expect(tx.chain).toBe('BTC');
    });
  });

  describe('estimateFee()', () => {
    it('should return fee estimates for a chain', async () => {
      const wallet = Wallet.fromWalletId('w1', {
        ...SDK_CONFIG,
        authToken: 'jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      const feeData = {
        low: { chain: 'ETH', fee: '0.001', priority: 'low' },
        medium: { chain: 'ETH', fee: '0.002', priority: 'medium' },
        high: { chain: 'ETH', fee: '0.005', priority: 'high' },
      };

      mockFetch.mockResolvedValueOnce(okResponse(feeData));

      const fees = await wallet.estimateFee('ETH');

      expect(fees).toEqual(feeData);
    });
  });

  describe('send()', () => {
    it('should throw if no private key available', async () => {
      const wallet = Wallet.fromWalletId('w1', SDK_CONFIG);

      await expect(
        wallet.send({
          fromAddress: '0xunknown',
          toAddress: '0xdest',
          chain: 'ETH',
          amount: '1000000000000000000',
        })
      ).rejects.toThrow('No private key');
    });

    it('should orchestrate prepare -> sign -> broadcast', async () => {
      // Create wallet to get keys
      mockFetch
        // create
        .mockResolvedValueOnce(
          okResponse({
            wallet_id: 'w-send',
            created_at: '2024-01-01T00:00:00Z',
            addresses: [],
          })
        )
        // prepare-tx
        .mockResolvedValueOnce(
          okResponse({
            tx_id: 'tx-prepared',
            chain: 'ETH',
            from_address: '0xfrom',
            to_address: '0xto',
            amount: '1000',
            fee: { chain: 'ETH', fee: '0.002', priority: 'medium' },
            expires_at: new Date(Date.now() + 300_000).toISOString(),
            unsigned_tx: {
              type: 'evm',
              chainId: 1,
              nonce: 0,
              to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
              value: '0x3e8',
              gasLimit: 21000,
              maxFeePerGas: '0x3b9aca00',
              maxPriorityFeePerGas: '0x77359400',
            },
          })
        )
        // broadcast
        .mockResolvedValueOnce(
          okResponse({
            tx_hash: '0xbroadcasted',
            chain: 'ETH',
            status: 'pending',
            explorer_url: 'https://etherscan.io/tx/0xbroadcasted',
          })
        );

      const wallet = await Wallet.create({
        ...SDK_CONFIG,
        chains: ['ETH'],
      });

      // Get the first ETH address from the created wallet
      const addresses = Array.from(
        (wallet as any)._privateKeys.keys()
      ) as string[];
      const fromAddr = addresses[0];

      const result = await wallet.send({
        fromAddress: fromAddr,
        toAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        chain: 'ETH',
        amount: '1000',
      });

      expect(result.txHash).toBe('0xbroadcasted');
      expect(result.explorerUrl).toContain('etherscan.io');

      // Verify prepare-tx was called
      const prepareCall = mockFetch.mock.calls[1];
      expect(prepareCall[0]).toContain('/prepare-tx');

      // Verify broadcast was called
      const broadcastCall = mockFetch.mock.calls[2];
      expect(broadcastCall[0]).toContain('/broadcast');
      const broadcastBody = JSON.parse(broadcastCall[1].body);
      expect(broadcastBody.tx_id).toBe('tx-prepared');
      expect(broadcastBody.signed_tx).toBeTruthy();
    });
  });

  describe('prepareTx()', () => {
    it('should prepare an unsigned transaction', async () => {
      const wallet = Wallet.fromWalletId('w1', {
        ...SDK_CONFIG,
        authToken: 'jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      mockFetch.mockResolvedValueOnce(
        okResponse({
          tx_id: 'tx-1',
          chain: 'ETH',
          from_address: '0xfrom',
          to_address: '0xto',
          amount: '1000',
          fee: { chain: 'ETH', fee: '0.002' },
          expires_at: '2024-01-01T00:05:00Z',
          unsigned_tx: { type: 'evm', chainId: 1 },
        })
      );

      const result = await wallet.prepareTx({
        fromAddress: '0xfrom',
        toAddress: '0xto',
        chain: 'ETH',
        amount: '1000',
      });

      expect(result.txId).toBe('tx-1');
      expect(result.unsignedTx).toBeTruthy();
    });
  });

  describe('broadcast()', () => {
    it('should broadcast a signed transaction', async () => {
      const wallet = Wallet.fromWalletId('w1', {
        ...SDK_CONFIG,
        authToken: 'jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      mockFetch.mockResolvedValueOnce(
        okResponse({
          tx_hash: '0xhash',
          chain: 'ETH',
          status: 'pending',
          explorer_url: 'https://etherscan.io/tx/0xhash',
        })
      );

      const result = await wallet.broadcast('tx-1', '0xsigneddata', 'ETH');

      expect(result.txHash).toBe('0xhash');
      expect(result.explorerUrl).toContain('etherscan.io');
    });
  });

  describe('getSettings() / updateSettings()', () => {
    it('should fetch current settings', async () => {
      const wallet = Wallet.fromWalletId('w1', {
        ...SDK_CONFIG,
        authToken: 'jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      mockFetch.mockResolvedValueOnce(
        okResponse({
          wallet_id: 'w1',
          daily_spend_limit: 500,
          whitelist_addresses: ['0xabc'],
          whitelist_enabled: true,
          require_confirmation: false,
          confirmation_delay_seconds: 0,
        })
      );

      const settings = await wallet.getSettings();

      expect(settings.walletId).toBe('w1');
      expect(settings.dailySpendLimit).toBe(500);
      expect(settings.whitelistAddresses).toEqual(['0xabc']);
      expect(settings.whitelistEnabled).toBe(true);
    });

    it('should update settings', async () => {
      const wallet = Wallet.fromWalletId('w1', {
        ...SDK_CONFIG,
        authToken: 'jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      mockFetch.mockResolvedValueOnce(
        okResponse({
          wallet_id: 'w1',
          daily_spend_limit: 1000,
          whitelist_addresses: [],
          whitelist_enabled: false,
          require_confirmation: true,
          confirmation_delay_seconds: 30,
        })
      );

      const settings = await wallet.updateSettings({
        dailySpendLimit: 1000,
        requireConfirmation: true,
        confirmationDelaySeconds: 30,
      });

      expect(settings.dailySpendLimit).toBe(1000);
      expect(settings.requireConfirmation).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.daily_spend_limit).toBe(1000);
    });
  });

  describe('getTotalBalanceUSD()', () => {
    it('should fetch total balance in USD with per-address breakdown', async () => {
      const wallet = Wallet.fromWalletId('w1', {
        ...SDK_CONFIG,
        authToken: 'jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      mockFetch.mockResolvedValueOnce(
        okResponse({
          total_usd: 5250.75,
          balances: [
            {
              chain: 'ETH',
              address: '0xabc',
              balance: '1.5',
              usd_value: 5000.25,
              rate: 3333.50,
              updated_at: '2024-01-01T00:00:00Z',
            },
            {
              chain: 'BTC',
              address: '1abc',
              balance: '0.005',
              usd_value: 250.50,
              rate: 50100.00,
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
        })
      );

      const result = await wallet.getTotalBalanceUSD();

      expect(result.totalUsd).toBe(5250.75);
      expect(result.balances).toHaveLength(2);
      expect(result.balances[0].chain).toBe('ETH');
      expect(result.balances[0].usdValue).toBe(5000.25);
      expect(result.balances[0].rate).toBe(3333.50);
      expect(result.balances[1].chain).toBe('BTC');
      expect(mockFetch.mock.calls[0][0]).toContain('/balances/total-usd');
    });
  });

  describe('registerWebhook()', () => {
    it('should register a webhook and return secret', async () => {
      const wallet = Wallet.fromWalletId('w1', {
        ...SDK_CONFIG,
        authToken: 'jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      mockFetch.mockResolvedValueOnce(
        okResponse({
          id: 'wh-1',
          url: 'https://example.com/hook',
          events: ['transaction.incoming', 'balance.changed'],
          is_active: true,
          secret: 'webhook-secret-123',
          last_delivered_at: null,
          last_error: null,
          consecutive_failures: 0,
          created_at: '2024-01-01T00:00:00Z',
        })
      );

      const result = await wallet.registerWebhook({
        url: 'https://example.com/hook',
        events: ['transaction.incoming', 'balance.changed'],
      });

      expect(result.id).toBe('wh-1');
      expect(result.url).toBe('https://example.com/hook');
      expect(result.secret).toBe('webhook-secret-123');
      expect(result.events).toEqual(['transaction.incoming', 'balance.changed']);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.url).toBe('https://example.com/hook');
    });
  });

  describe('listWebhooks()', () => {
    it('should list all webhooks for the wallet', async () => {
      const wallet = Wallet.fromWalletId('w1', {
        ...SDK_CONFIG,
        authToken: 'jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      mockFetch.mockResolvedValueOnce(
        okResponse({
          webhooks: [
            {
              id: 'wh-1',
              url: 'https://example.com/hook1',
              events: ['transaction.incoming'],
              is_active: true,
              last_delivered_at: null,
              last_error: null,
              consecutive_failures: 0,
              created_at: '2024-01-01T00:00:00Z',
            },
            {
              id: 'wh-2',
              url: 'https://example.com/hook2',
              events: ['balance.changed'],
              is_active: false,
              last_delivered_at: '2024-01-02T00:00:00Z',
              last_error: 'HTTP 500',
              consecutive_failures: 3,
              created_at: '2024-01-01T00:00:00Z',
            },
          ],
        })
      );

      const webhooks = await wallet.listWebhooks();

      expect(webhooks).toHaveLength(2);
      expect(webhooks[0].url).toBe('https://example.com/hook1');
      expect(webhooks[0].isActive).toBe(true);
      expect(webhooks[1].isActive).toBe(false);
      expect(webhooks[1].consecutiveFailures).toBe(3);
    });
  });

  describe('deleteWebhook()', () => {
    it('should delete a webhook', async () => {
      const wallet = Wallet.fromWalletId('w1', {
        ...SDK_CONFIG,
        authToken: 'jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      mockFetch.mockResolvedValueOnce(okResponse({ deleted: true }));

      await wallet.deleteWebhook('wh-1');

      expect(mockFetch.mock.calls[0][0]).toContain('/webhooks/wh-1');
      const opts = mockFetch.mock.calls[0][1];
      expect(opts.method).toBe('DELETE');
    });
  });

  describe('destroy()', () => {
    it('should clear mnemonic and private keys', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          wallet_id: 'w1',
          created_at: '2024-01-01T00:00:00Z',
          addresses: [],
        })
      );

      const wallet = await Wallet.create({
        ...SDK_CONFIG,
        chains: ['ETH'],
      });

      expect(wallet.getMnemonic()).toBeTruthy();
      expect(wallet.isReadOnly).toBe(false);

      wallet.destroy();

      expect(wallet.getMnemonic()).toBeNull();
      expect(wallet.isReadOnly).toBe(true);
    });
  });

  describe('getMissingChains()', () => {
    it('should return chains that do not have addresses', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          wallet_id: 'w1',
          created_at: '2024-01-01T00:00:00Z',
          addresses: [
            { chain: 'ETH', address: '0xabc', derivation_index: 0 },
          ],
        })
      );

      const wallet = await Wallet.create({
        ...SDK_CONFIG,
        chains: ['ETH'],
      });

      // Mock getAddresses to return only ETH
      mockFetch.mockResolvedValueOnce(
        okResponse({
          addresses: [
            { address_id: 'a1', chain: 'ETH', address: '0xabc', derivation_index: 0, is_active: true },
          ],
        })
      );

      const missing = await wallet.getMissingChains(['ETH', 'BTC', 'SOL']);

      expect(missing).toEqual(['BTC', 'SOL']);
    });

    it('should return empty array when all chains have addresses', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          wallet_id: 'w1',
          created_at: '2024-01-01T00:00:00Z',
          addresses: [
            { chain: 'ETH', address: '0xabc', derivation_index: 0 },
          ],
        })
      );

      const wallet = await Wallet.create({
        ...SDK_CONFIG,
        chains: ['ETH'],
      });

      // Mock getAddresses to return ETH and BTC
      mockFetch.mockResolvedValueOnce(
        okResponse({
          addresses: [
            { address_id: 'a1', chain: 'ETH', address: '0xabc', derivation_index: 0, is_active: true },
            { address_id: 'a2', chain: 'BTC', address: 'bc1abc', derivation_index: 0, is_active: true },
          ],
        })
      );

      const missing = await wallet.getMissingChains(['ETH', 'BTC']);

      expect(missing).toEqual([]);
    });
  });

  describe('deriveMissingChains()', () => {
    it('should throw error in read-only mode', async () => {
      const wallet = Wallet.fromWalletId('w1', {
        ...SDK_CONFIG,
        authToken: 'jwt',
        authTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      await expect(wallet.deriveMissingChains()).rejects.toThrow('read-only');
    });

    it('should derive addresses for missing chains', async () => {
      // Create wallet with ETH only
      mockFetch.mockResolvedValueOnce(
        okResponse({
          wallet_id: 'w1',
          created_at: '2024-01-01T00:00:00Z',
          addresses: [
            { chain: 'ETH', address: '0xabc', derivation_index: 0 },
          ],
        })
      );

      const wallet = await Wallet.create({
        ...SDK_CONFIG,
        chains: ['ETH'],
      });

      // Mock getAddresses for deriveMissingChains (returns only ETH, so BCH is missing)
      mockFetch.mockResolvedValueOnce(
        okResponse({
          addresses: [
            { address_id: 'a1', chain: 'ETH', address: '0xabc', derivation_index: 0, is_active: true },
          ],
        })
      );

      // Mock derive endpoint for BCH (called with index=0, so no getNextDerivationIndex call)
      mockFetch.mockResolvedValueOnce(
        okResponse({
          address_id: 'a2',
          chain: 'BCH',
          address: 'bitcoincash:qtest',
          derivation_index: 0,
          derivation_path: "m/44'/145'/0'/0/0",
          created_at: '2024-01-01T00:00:00Z',
        }, 201)
      );

      const results = await wallet.deriveMissingChains(['ETH', 'BCH']);

      expect(results).toHaveLength(1);
      expect(results[0].chain).toBe('BCH');
    });

    it('should return empty array when no chains are missing', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          wallet_id: 'w1',
          created_at: '2024-01-01T00:00:00Z',
          addresses: [
            { chain: 'ETH', address: '0xabc', derivation_index: 0 },
          ],
        })
      );

      const wallet = await Wallet.create({
        ...SDK_CONFIG,
        chains: ['ETH'],
      });

      // Mock getAddresses to return ETH (which is the only target chain)
      mockFetch.mockResolvedValueOnce(
        okResponse({
          addresses: [
            { address_id: 'a1', chain: 'ETH', address: '0xabc', derivation_index: 0, is_active: true },
          ],
        })
      );

      const results = await wallet.deriveMissingChains(['ETH']);

      expect(results).toEqual([]);
    });
  });

  describe('Swap', () => {
    describe('getSwapQuote()', () => {
      it('should return a swap quote', async () => {
        const wallet = Wallet.readOnly(SDK_CONFIG);

        mockFetch.mockResolvedValueOnce(
          okResponse({
            from: 'BTC',
            to: 'ETH',
            depositAmount: '0.1',
            settleAmount: '1.5',
            rate: '15.0',
            minAmount: 0.001,
          })
        );

        const quote = await wallet.getSwapQuote('BTC', 'ETH', '0.1');

        expect(quote.from).toBe('BTC');
        expect(quote.to).toBe('ETH');
        expect(quote.depositAmount).toBe('0.1');
        expect(quote.settleAmount).toBe('1.5');
        expect(quote.rate).toBe('15.0');
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/swap/quote'),
          expect.anything()
        );
      });
    });

    describe('createSwap()', () => {
      it('should create a swap transaction', async () => {
        const wallet = Wallet.readOnly(SDK_CONFIG);

        mockFetch.mockResolvedValueOnce(
          okResponse({
            swap: {
              id: 'swap-123',
              from_coin: 'BTC',
              to_coin: 'ETH',
              deposit_address: 'bc1qdeposit',
              deposit_amount: '0.1',
              settle_address: '0xreceive',
              settle_amount: null,
              status: 'pending',
              created_at: '2024-01-01T00:00:00Z',
            },
          })
        );

        const swap = await wallet.createSwap({
          from: 'BTC',
          to: 'ETH',
          amount: '0.1',
          settleAddress: '0xreceive',
        });

        expect(swap.id).toBe('swap-123');
        expect(swap.from).toBe('BTC');
        expect(swap.to).toBe('ETH');
        expect(swap.depositAddress).toBe('bc1qdeposit');
        expect(swap.status).toBe('pending');
      });
    });

    describe('getSwapStatus()', () => {
      it('should return swap status', async () => {
        const wallet = Wallet.readOnly(SDK_CONFIG);

        mockFetch.mockResolvedValueOnce(
          okResponse({
            swap: {
              id: 'swap-123',
              from_coin: 'BTC',
              to_coin: 'ETH',
              deposit_address: 'bc1qdeposit',
              deposit_amount: '0.1',
              settle_address: '0xreceive',
              settle_amount: '1.5',
              status: 'settled',
              created_at: '2024-01-01T00:00:00Z',
            },
          })
        );

        const swap = await wallet.getSwapStatus('swap-123');

        expect(swap.id).toBe('swap-123');
        expect(swap.status).toBe('settled');
        expect(swap.settleAmount).toBe('1.5');
      });
    });

    describe('getSwapCoins()', () => {
      it('should return list of supported coins', async () => {
        const wallet = Wallet.readOnly(SDK_CONFIG);

        mockFetch.mockResolvedValueOnce(
          okResponse({
            coins: [
              { ticker: 'btc', name: 'Bitcoin', network: 'btc' },
              { ticker: 'eth', name: 'Ethereum', network: 'eth' },
            ],
          })
        );

        const coins = await wallet.getSwapCoins();

        expect(coins).toHaveLength(2);
        expect(coins[0].ticker).toBe('btc');
        expect(coins[1].name).toBe('Ethereum');
      });
    });

    describe('getSwapHistory()', () => {
      it('should return swap history for wallet', async () => {
        // Create authenticated wallet
        mockFetch.mockResolvedValueOnce(
          okResponse({
            wallet_id: 'w1',
            created_at: '2024-01-01T00:00:00Z',
            addresses: [
              { chain: 'ETH', address: '0xabc', derivation_index: 0 },
            ],
          })
        );

        const wallet = await Wallet.create({
          ...SDK_CONFIG,
          chains: ['ETH'],
        });

        mockFetch.mockResolvedValueOnce(
          okResponse({
            swaps: [
              {
                id: 'swap-1',
                from_coin: 'BTC',
                to_coin: 'ETH',
                deposit_address: 'bc1q1',
                deposit_amount: '0.1',
                settle_address: '0xabc',
                settle_amount: '1.5',
                status: 'settled',
                created_at: '2024-01-01T00:00:00Z',
              },
              {
                id: 'swap-2',
                from_coin: 'ETH',
                to_coin: 'SOL',
                deposit_address: '0xdep',
                deposit_amount: '2.0',
                settle_address: 'Sol123',
                settle_amount: null,
                status: 'pending',
                created_at: '2024-01-02T00:00:00Z',
              },
            ],
          })
        );

        const swaps = await wallet.getSwapHistory({ limit: 10 });

        expect(swaps).toHaveLength(2);
        expect(swaps[0].id).toBe('swap-1');
        expect(swaps[0].status).toBe('settled');
        expect(swaps[1].status).toBe('pending');
      });
    });

    describe('Wallet.readOnly()', () => {
      it('should create a read-only wallet instance', () => {
        const wallet = Wallet.readOnly(SDK_CONFIG);

        expect(wallet.walletId).toBe('__readonly__');
        expect(wallet.isReadOnly).toBe(true);
      });
    });
  });
});
