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
});
