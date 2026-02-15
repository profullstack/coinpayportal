/**
 * Wallet SDK - Main Wallet Class
 *
 * High-level SDK entry point that wraps all web-wallet API endpoints.
 * Uses fetch() exclusively — NO Supabase imports.
 */

import { WalletAPIClient, hexToUint8Array, uint8ArrayToHex } from './client';
import { secp256k1 } from '@noble/curves/secp256k1';
import { WalletEventEmitter } from './events';
import { WalletSDKError } from './errors';
import {
  generateMnemonic,
  isValidMnemonic,
  deriveWalletBundle,
  deriveKeyForChain,
} from '../web-wallet/keys';
import { signTransaction } from '../web-wallet/signing';
import { buildDerivationPath } from '../web-wallet/identity';
import { encryptSeedPhrase, decryptSeedPhrase, type EncryptedBackup } from './backup';
import type {
  WalletSDKConfig,
  WalletChain,
  WalletInfo,
  AddressSummary,
  DeriveAddressResult,
  Balance,
  Transaction,
  TransactionList,
  TransactionListOptions,
  SendOptions,
  SendResult,
  PrepareTransactionResult,
  BroadcastResult,
  WalletSettings,
  UpdateSettingsInput,
  FeeEstimateResult,
  WalletEventType,
  TotalBalanceUSD,
  BalanceWithUSD,
  WebhookRegistration,
  RegisterWebhookInput,
  RegisterWebhookResult,
  SwapQuote,
  SwapCreateParams,
  Swap,
  SwapCoin,
  SwapHistoryOptions,
  LightningAddress,
  LightningInvoice,
  LightningPayment,
  LightningPaymentStatus,
} from './types';

type EventCallback = (...args: any[]) => void;

export class Wallet {
  private readonly client: WalletAPIClient;
  private readonly _walletId: string;
  private _mnemonic: string | null = null;
  private _privateKeys: Map<string, string> = new Map();
  private _events: WalletEventEmitter | null = null;

  private constructor(walletId: string, client: WalletAPIClient) {
    this._walletId = walletId;
    this.client = client;
  }

  get walletId(): string {
    return this._walletId;
  }
  get isReadOnly(): boolean {
    return this._mnemonic === null && this._privateKeys.size === 0;
  }

  // ── Static Factory: Create New Wallet ──

  static async create(
    options: WalletSDKConfig & {
      chains?: WalletChain[];
      words?: 12 | 24;
    }
  ): Promise<Wallet> {
    const client = new WalletAPIClient(options);
    const chains: WalletChain[] = options.chains || [
      'BTC', 'BCH', 'ETH', 'POL', 'SOL',
      'DOGE', 'XRP', 'ADA', 'BNB',
      'USDC_ETH', 'USDC_POL', 'USDC_SOL',
      'USDT_ETH', 'USDT_POL', 'USDT_SOL',
    ];
    const mnemonic = generateMnemonic(options.words || 12);
    const bundle = await deriveWalletBundle(mnemonic, chains);

    const result = await client.request<{
      wallet_id: string;
      created_at: string;
      addresses: any[];
    }>({
      method: 'POST',
      path: '/api/web-wallet/create',
      body: {
        public_key_secp256k1: bundle.publicKeySecp256k1,
        public_key_ed25519: bundle.publicKeyEd25519,
        initial_addresses: bundle.addresses.map((a) => ({
          chain: a.chain,
          address: a.address,
          derivation_path: a.derivationPath,
        })),
      },
    });

    const wallet = new Wallet(result.wallet_id, client);
    wallet._mnemonic = mnemonic;

    for (const addr of bundle.addresses) {
      wallet._privateKeys.set(addr.address, addr.privateKey);
    }

    // Use master account key for per-request signature auth (matches stored public key)
    if (bundle.privateKeySecp256k1) {
      client.setSignatureAuth(result.wallet_id, bundle.privateKeySecp256k1);
    }

    return wallet;
  }

  // ── Static Factory: Import from Mnemonic ──

  static async fromSeed(
    mnemonic: string,
    options: WalletSDKConfig & {
      chains?: WalletChain[];
    }
  ): Promise<Wallet> {
    if (!isValidMnemonic(mnemonic)) {
      throw new WalletSDKError(
        'INVALID_MNEMONIC',
        'Invalid BIP39 mnemonic phrase',
        400
      );
    }

    const client = new WalletAPIClient(options);
    // Default to all derivable chains
    const chains: WalletChain[] = options.chains || [
      'BTC', 'BCH', 'ETH', 'POL', 'SOL',
      'DOGE', 'XRP', 'ADA', 'BNB',
      'USDC_ETH', 'USDC_POL', 'USDC_SOL',
      'USDT_ETH', 'USDT_POL', 'USDT_SOL',
    ];
    const bundle = await deriveWalletBundle(mnemonic, chains);

    if (!bundle.privateKeySecp256k1) {
      throw new WalletSDKError(
        'NO_SECP256K1_KEY',
        'Cannot derive proof-of-ownership key',
        400
      );
    }

    // Sign proof with the master account key (m/44'/60'/0') that matches
    // the public_key_secp256k1 stored on the wallet record
    const proofMessage = `coinpayportal:import:${Date.now()}`;
    const messageBytes = new TextEncoder().encode(proofMessage);
    const masterPrivKeyBytes = hexToUint8Array(bundle.privateKeySecp256k1);
    const signatureBytes = secp256k1.sign(messageBytes, masterPrivKeyBytes);
    const signatureHex = uint8ArrayToHex(signatureBytes);

    const result = await client.request<{
      wallet_id: string;
      imported: boolean;
      already_exists?: boolean;
      addresses_registered?: number;
      created_at?: string;
    }>({
      method: 'POST',
      path: '/api/web-wallet/import',
      body: {
        public_key_secp256k1: bundle.publicKeySecp256k1,
        public_key_ed25519: bundle.publicKeyEd25519,
        addresses: bundle.addresses.map((a) => ({
          chain: a.chain,
          address: a.address,
          derivation_path: a.derivationPath,
        })),
        proof_of_ownership: {
          message: proofMessage,
          signature: signatureHex,
        },
      },
    });

    const wallet = new Wallet(result.wallet_id, client);
    wallet._mnemonic = mnemonic;

    for (const addr of bundle.addresses) {
      wallet._privateKeys.set(addr.address, addr.privateKey);
    }

    // Use master key for per-request signature auth too
    client.setSignatureAuth(result.wallet_id, bundle.privateKeySecp256k1);
    return wallet;
  }

  // ── Static Factory: Read-Only ──

  static fromWalletId(
    walletId: string,
    options: WalletSDKConfig & {
      authToken?: string;
      authTokenExpiresAt?: string;
    }
  ): Wallet {
    const client = new WalletAPIClient(options);
    const wallet = new Wallet(walletId, client);

    if (options.authToken && options.authTokenExpiresAt) {
      client.setJWTToken(options.authToken, options.authTokenExpiresAt);
    }

    return wallet;
  }

  /**
   * Create a read-only wallet instance for public endpoints.
   * Useful for operations like getting swap quotes that don't require auth.
   */
  static readOnly(options: WalletSDKConfig): Wallet {
    const client = new WalletAPIClient(options);
    return new Wallet('__readonly__', client);
  }

  // ── Wallet Info ──

  async getInfo(): Promise<WalletInfo> {
    const data = await this.client.request<any>({
      method: 'GET',
      path: `/api/web-wallet/${this._walletId}`,
      authenticated: true,
    });

    return {
      walletId: data.wallet_id,
      status: data.status,
      createdAt: data.created_at,
      lastActiveAt: data.last_active_at,
      addressCount: data.address_count,
      settings: {
        dailySpendLimit: data.settings?.daily_spend_limit ?? null,
        whitelistEnabled: data.settings?.whitelist_enabled ?? false,
        requireConfirmation: data.settings?.require_confirmation ?? false,
      },
    };
  }

  // ── Addresses ──

  async getAddresses(options?: {
    chain?: WalletChain;
    activeOnly?: boolean;
  }): Promise<AddressSummary[]> {
    const data = await this.client.request<any>({
      method: 'GET',
      path: `/api/web-wallet/${this._walletId}/addresses`,
      query: {
        chain: options?.chain,
        active_only: options?.activeOnly ? 'true' : undefined,
      },
      authenticated: true,
    });

    return (data.addresses || []).map((a: any) => ({
      addressId: a.address_id,
      chain: a.chain,
      address: a.address,
      derivationIndex: a.derivation_index,
      isActive: a.is_active,
      cachedBalance: a.cached_balance?.toString() ?? null,
    }));
  }

  async deriveAddress(
    chain: WalletChain,
    index?: number
  ): Promise<DeriveAddressResult> {
    if (!this._mnemonic) {
      throw new WalletSDKError(
        'READ_ONLY',
        'Cannot derive addresses in read-only mode',
        400
      );
    }

    const derivationIndex =
      index ?? (await this.getNextDerivationIndex(chain));
    const key = await deriveKeyForChain(this._mnemonic, chain, derivationIndex);
    const derivationPath = buildDerivationPath(chain, derivationIndex);

    const data = await this.client.request<any>({
      method: 'POST',
      path: `/api/web-wallet/${this._walletId}/derive`,
      body: {
        chain,
        address: key.address,
        derivation_index: derivationIndex,
        derivation_path: derivationPath,
      },
      authenticated: true,
    });

    this._privateKeys.set(key.address, key.privateKey);

    return {
      addressId: data.address_id,
      chain: data.chain,
      address: data.address,
      derivationIndex: data.derivation_index,
      derivationPath: data.derivation_path,
      createdAt: data.created_at,
    };
  }

  /**
   * Derive addresses for any chains that don't have addresses yet.
   * Useful when new coins are added to the platform.
   * 
   * @param targetChains - Chains to check and derive if missing. Defaults to all supported chains.
   * @returns Array of newly derived addresses
   */
  async deriveMissingChains(
    targetChains?: WalletChain[]
  ): Promise<DeriveAddressResult[]> {
    if (!this._mnemonic) {
      throw new WalletSDKError(
        'READ_ONLY',
        'Cannot derive addresses in read-only mode',
        400
      );
    }

    // Default chains that should exist
    const defaultChains: WalletChain[] = targetChains || [
      'BTC', 'BCH', 'ETH', 'POL', 'SOL',
      'DOGE', 'XRP', 'ADA', 'BNB',
      'USDC_ETH', 'USDC_POL', 'USDC_SOL',
      'USDT_ETH', 'USDT_POL', 'USDT_SOL',
    ];

    // Get current addresses
    const currentAddresses = await this.getAddresses();
    const existingChains = new Set(currentAddresses.map((a) => a.chain));

    // Find missing chains
    const missingChains = defaultChains.filter((c) => !existingChains.has(c));

    if (missingChains.length === 0) {
      return [];
    }

    // Derive addresses for each missing chain
    const results: DeriveAddressResult[] = [];
    const failures: { chain: WalletChain; error: string }[] = [];
    
    for (const chain of missingChains) {
      try {
        const result = await this.deriveAddress(chain, 0);
        results.push(result);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Wallet] Failed to derive ${chain}:`, err);
        failures.push({ chain, error: errorMsg });
      }
    }

    // If ALL chains failed, throw an error with details
    if (results.length === 0 && failures.length > 0) {
      const failedChains = failures.map(f => f.chain).join(', ');
      const firstError = failures[0].error;
      throw new WalletSDKError(
        'DERIVE_FAILED',
        `Failed to derive addresses for: ${failedChains}. Error: ${firstError}`,
        500
      );
    }

    return results;
  }

  /**
   * Get list of chains that don't have addresses yet.
   * 
   * @param targetChains - Chains to check against. Defaults to all supported chains.
   * @returns Array of chain names that are missing
   */
  async getMissingChains(
    targetChains?: WalletChain[]
  ): Promise<WalletChain[]> {
    // Dynamically fetch current supported chains from the server
    // This ensures old wallets see newly added chains
    let supportedChains: WalletChain[];
    
    if (targetChains) {
      supportedChains = targetChains;
    } else {
      try {
        // Fetch from API to get latest supported chains
        const resp = await this.client.request<{ chains: string[] }>({
          method: 'GET',
          path: '/api/web-wallet/supported-chains',
        });
        supportedChains = (resp.chains || []) as WalletChain[];
      } catch {
        // Fallback to hardcoded list if API fails
        supportedChains = [
          'BTC', 'BCH', 'ETH', 'POL', 'SOL',
          'DOGE', 'XRP', 'ADA', 'BNB',
          'USDC_ETH', 'USDC_POL', 'USDC_SOL',
          'USDT_ETH', 'USDT_POL', 'USDT_SOL',
        ];
      }
    }

    const currentAddresses = await this.getAddresses();
    const existingChains = new Set(currentAddresses.map((a) => a.chain));

    return supportedChains.filter((c) => !existingChains.has(c));
  }

  // ── Balances ──

  async getBalances(options?: {
    chain?: WalletChain;
    refresh?: boolean;
  }): Promise<Balance[]> {
    const data = await this.client.request<any>({
      method: 'GET',
      path: `/api/web-wallet/${this._walletId}/balances`,
      query: {
        chain: options?.chain,
        refresh: options?.refresh ? 'true' : undefined,
      },
      authenticated: true,
    });

    return (data.balances || []).map((b: any) => ({
      balance: b.balance,
      chain: b.chain,
      address: b.address,
      updatedAt: b.updatedAt || b.updated_at,
    }));
  }

  async getBalance(addressId: string, refresh?: boolean): Promise<Balance> {
    const data = await this.client.request<any>({
      method: 'GET',
      path: `/api/web-wallet/${this._walletId}/addresses/${addressId}/balance`,
      query: { refresh: refresh ? 'true' : undefined },
      authenticated: true,
    });

    return {
      balance: data.balance,
      chain: data.chain,
      address: data.address,
      updatedAt: data.updatedAt || data.updated_at,
    };
  }

  // ── Transactions ──

  async getTransactions(
    options?: TransactionListOptions
  ): Promise<TransactionList> {
    const data = await this.client.request<any>({
      method: 'GET',
      path: `/api/web-wallet/${this._walletId}/transactions`,
      query: {
        chain: options?.chain,
        direction: options?.direction,
        status: options?.status,
        from_date: options?.fromDate,
        to_date: options?.toDate,
        limit: options?.limit?.toString(),
        offset: options?.offset?.toString(),
      },
      authenticated: true,
    });

    return {
      transactions: (data.transactions || []).map(mapTransaction),
      total: data.total || 0,
      limit: data.limit || 50,
      offset: data.offset || 0,
    };
  }

  async getTransaction(txId: string): Promise<Transaction> {
    const data = await this.client.request<any>({
      method: 'GET',
      path: `/api/web-wallet/${this._walletId}/transactions/${txId}`,
      authenticated: true,
    });

    return mapTransaction(data);
  }

  // ── Sync History (on-chain indexing) ──

  async syncHistory(
    chain?: WalletChain
  ): Promise<{ newTransactions: number }> {
    const data = await this.client.request<{
      new_transactions: number;
      results: Array<{
        chain: string;
        address: string;
        new_transactions: number;
        errors: string[];
      }>;
    }>({
      method: 'POST',
      path: `/api/web-wallet/${this._walletId}/sync-history`,
      body: chain ? { chain } : {},
      authenticated: true,
    });

    return {
      newTransactions: data.new_transactions,
    };
  }

  // ── Fee Estimation ──

  async estimateFee(chain: WalletChain): Promise<FeeEstimateResult> {
    return this.client.request<FeeEstimateResult>({
      method: 'POST',
      path: `/api/web-wallet/${this._walletId}/estimate-fee`,
      body: { chain },
      authenticated: true,
    });
  }

  // ── Send (Prepare -> Sign -> Broadcast) ──

  async prepareTx(options: {
    fromAddress: string;
    toAddress: string;
    chain: WalletChain;
    amount: string;
    priority?: 'low' | 'medium' | 'high';
  }): Promise<PrepareTransactionResult> {
    const data = await this.client.request<any>({
      method: 'POST',
      path: `/api/web-wallet/${this._walletId}/prepare-tx`,
      body: {
        from_address: options.fromAddress,
        to_address: options.toAddress,
        chain: options.chain,
        amount: options.amount,
        priority: options.priority || 'medium',
      },
      authenticated: true,
    });

    return {
      txId: data.tx_id,
      chain: data.chain,
      fromAddress: data.from_address,
      toAddress: data.to_address,
      amount: data.amount,
      fee: data.fee,
      expiresAt: data.expires_at,
      unsignedTx: data.unsigned_tx,
    };
  }

  async broadcast(
    txId: string,
    signedTx: string,
    chain: WalletChain
  ): Promise<BroadcastResult> {
    const data = await this.client.request<any>({
      method: 'POST',
      path: `/api/web-wallet/${this._walletId}/broadcast`,
      body: { tx_id: txId, signed_tx: signedTx, chain },
      authenticated: true,
    });

    return {
      txHash: data.tx_hash,
      chain: data.chain,
      status: data.status,
      explorerUrl: data.explorer_url,
    };
  }

  async send(options: SendOptions): Promise<SendResult> {
    console.log('[WalletSDK.send] Starting send:', {
      chain: options.chain,
      fromAddress: options.fromAddress,
      toAddress: options.toAddress,
      amount: options.amount,
    });

    const privateKey =
      options.privateKey || this._privateKeys.get(options.fromAddress);
    if (!privateKey) {
      console.error('[WalletSDK.send] No private key for address:', options.fromAddress);
      console.log('[WalletSDK.send] Available addresses:', Array.from(this._privateKeys.keys()));
      throw new WalletSDKError(
        'NO_PRIVATE_KEY',
        `No private key available for address ${options.fromAddress}. Provide privateKey in options.`,
        400
      );
    }

    console.log('[WalletSDK.send] Preparing transaction...');
    const prepared = await this.prepareTx({
      fromAddress: options.fromAddress,
      toAddress: options.toAddress,
      chain: options.chain,
      amount: options.amount,
      priority: options.priority,
    });
    console.log('[WalletSDK.send] Prepared tx:', { txId: prepared.txId, fee: prepared.fee });

    console.log('[WalletSDK.send] Signing transaction...');
    const signed = await signTransaction({
      unsigned_tx: prepared.unsignedTx,
      privateKey,
    });
    console.log('[WalletSDK.send] Signed, broadcasting...');

    const result = await this.broadcast(
      prepared.txId,
      signed.signed_tx,
      options.chain
    );
    console.log('[WalletSDK.send] Broadcast result:', result);

    return {
      txHash: result.txHash,
      chain: result.chain,
      status: result.status,
      explorerUrl: result.explorerUrl,
    };
  }

  // ── Settings ──

  async getSettings(): Promise<WalletSettings> {
    const data = await this.client.request<any>({
      method: 'GET',
      path: `/api/web-wallet/${this._walletId}/settings`,
      authenticated: true,
    });

    return mapSettings(data);
  }

  async updateSettings(input: UpdateSettingsInput): Promise<WalletSettings> {
    const data = await this.client.request<any>({
      method: 'PATCH',
      path: `/api/web-wallet/${this._walletId}/settings`,
      body: {
        daily_spend_limit: input.dailySpendLimit,
        whitelist_addresses: input.whitelistAddresses,
        whitelist_enabled: input.whitelistEnabled,
        require_confirmation: input.requireConfirmation,
        confirmation_delay_seconds: input.confirmationDelaySeconds,
        display_currency: input.displayCurrency,
      },
      authenticated: true,
    });

    return mapSettings(data);
  }

  // ── Total Balance USD ──

  async getTotalBalanceUSD(): Promise<TotalBalanceUSD> {
    const data = await this.client.request<any>({
      method: 'GET',
      path: `/api/web-wallet/${this._walletId}/balances/total-usd`,
      authenticated: true,
    });

    return {
      totalUsd: data.total_usd,
      balances: (data.balances || []).map((b: any): BalanceWithUSD => ({
        chain: b.chain,
        address: b.address,
        balance: b.balance,
        usdValue: b.usd_value,
        rate: b.rate,
        updatedAt: b.updated_at,
      })),
    };
  }

  // ── Webhooks ──

  async registerWebhook(input: RegisterWebhookInput): Promise<RegisterWebhookResult> {
    const data = await this.client.request<any>({
      method: 'POST',
      path: `/api/web-wallet/${this._walletId}/webhooks`,
      body: { url: input.url, events: input.events },
      authenticated: true,
    });

    return mapWebhook(data) as RegisterWebhookResult;
  }

  async listWebhooks(): Promise<WebhookRegistration[]> {
    const data = await this.client.request<any>({
      method: 'GET',
      path: `/api/web-wallet/${this._walletId}/webhooks`,
      authenticated: true,
    });

    return (data.webhooks || []).map(mapWebhook);
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.client.request<any>({
      method: 'DELETE',
      path: `/api/web-wallet/${this._walletId}/webhooks/${webhookId}`,
      authenticated: true,
    });
  }

  // ── Swap ──

  /**
   * Get a swap quote for exchanging coins.
   * @param from - Source coin (e.g., 'BTC', 'ETH')
   * @param to - Destination coin (e.g., 'SOL', 'USDC_ETH')
   * @param amount - Amount to swap (in source coin units)
   */
  async getSwapQuote(from: string, to: string, amount: string): Promise<SwapQuote> {
    const data = await this.client.request<any>({
      method: 'GET',
      path: '/api/swap/quote',
      query: { from, to, amount },
      authenticated: false,
    });

    return {
      from: data.from || from,
      to: data.to || to,
      depositAmount: data.depositAmount,
      settleAmount: data.settleAmount,
      rate: data.rate,
      minAmount: data.minAmount,
      expiresAt: data.expiresAt,
    };
  }

  /**
   * Create a swap transaction.
   * @param params - Swap parameters including coins, amount, and addresses
   */
  async createSwap(params: SwapCreateParams): Promise<Swap> {
    const data = await this.client.request<any>({
      method: 'POST',
      path: '/api/swap/create',
      body: {
        from: params.from,
        to: params.to,
        amount: params.amount,
        settleAddress: params.settleAddress,
        refundAddress: params.refundAddress,
        walletId: params.walletId || this._walletId,
      },
      authenticated: false,
    });

    return mapSwap(data.swap || data);
  }

  /**
   * Get the status of a swap by ID.
   */
  async getSwapStatus(swapId: string): Promise<Swap> {
    const data = await this.client.request<any>({
      method: 'GET',
      path: `/api/swap/${swapId}`,
      authenticated: false,
    });

    return mapSwap(data.swap || data);
  }

  /**
   * Get swap history for this wallet.
   */
  async getSwapHistory(options?: SwapHistoryOptions): Promise<Swap[]> {
    const data = await this.client.request<any>({
      method: 'GET',
      path: '/api/swap/history',
      query: {
        walletId: this._walletId,
        status: options?.status,
        limit: options?.limit?.toString(),
        offset: options?.offset?.toString(),
      },
      authenticated: true,
    });

    return (data.swaps || []).map(mapSwap);
  }

  /**
   * Get list of coins supported for swaps.
   */
  async getSwapCoins(): Promise<SwapCoin[]> {
    const data = await this.client.request<any>({
      method: 'GET',
      path: '/api/swap/coins',
      authenticated: false,
    });

    return data.coins || [];
  }

  // ── Events ──

  on(event: WalletEventType, callback: EventCallback): void {
    this.ensureEvents().on(event, callback);
  }

  off(event: WalletEventType, callback: EventCallback): void {
    this.ensureEvents().off(event, callback);
  }

  startPolling(intervalMs?: number): void {
    this.ensureEvents().startPolling(intervalMs);
  }

  stopPolling(): void {
    if (this._events) {
      this._events.stopPolling();
    }
  }

  // ── Mnemonic Access ──

  getMnemonic(): string | null {
    return this._mnemonic;
  }

  // ── Seed Phrase Backup ──

  /**
   * Export an encrypted GPG backup of the seed phrase.
   * Returns raw bytes that can be saved to a .gpg file.
   * Decrypt with: gpg --decrypt wallet_<id>_seedphrase.txt.gpg
   *
   * @param password - Passphrase for GPG symmetric encryption
   * @returns Encrypted backup with data, filename, and walletId
   * @throws if wallet is read-only (no mnemonic)
   */
  async exportEncryptedBackup(password: string): Promise<EncryptedBackup> {
    if (!this._mnemonic) {
      throw new WalletSDKError(
        'READ_ONLY',
        'Cannot export backup in read-only mode — no mnemonic available',
        400
      );
    }
    return encryptSeedPhrase(this._mnemonic, password, this._walletId);
  }

  /**
   * Decrypt a GPG-encrypted seed phrase backup.
   * Static method — works without an instantiated wallet.
   *
   * @param encrypted - Raw GPG encrypted bytes
   * @param password - The passphrase used during encryption
   * @returns The decrypted seed phrase, or null if password is wrong
   */
  static async decryptBackup(
    encrypted: Uint8Array,
    password: string
  ): Promise<string | null> {
    return decryptSeedPhrase(encrypted, password);
  }

  // ── Cleanup ──

  destroy(): void {
    this._mnemonic = null;
    this._privateKeys.clear();
    this.client.clearAuth();
    if (this._events) {
      this._events.stopPolling();
      this._events = null;
    }
  }

  // ── Private Helpers ──

  private async getNextDerivationIndex(chain: WalletChain): Promise<number> {
    const addresses = await this.getAddresses({ chain });
    if (addresses.length === 0) return 0;
    const maxIndex = Math.max(...addresses.map((a) => a.derivationIndex));
    return maxIndex + 1;
  }

  private ensureEvents(): WalletEventEmitter {
    if (!this._events) {
      this._events = new WalletEventEmitter(this);
    }
    return this._events;
  }
}

// ── Mapping Helpers ──

function mapTransaction(raw: any): Transaction {
  return {
    id: raw.id,
    walletId: raw.wallet_id,
    chain: raw.chain,
    txHash: raw.tx_hash,
    direction: raw.direction,
    status: raw.status,
    amount: raw.amount?.toString() || '0',
    fromAddress: raw.from_address,
    toAddress: raw.to_address,
    feeAmount: raw.fee_amount?.toString() ?? null,
    feeCurrency: raw.fee_currency ?? null,
    confirmations: raw.confirmations || 0,
    blockNumber: raw.block_number ?? null,
    blockTimestamp: raw.block_timestamp ?? null,
    createdAt: raw.created_at,
  };
}

function mapSettings(data: any): WalletSettings {
  return {
    walletId: data.wallet_id,
    dailySpendLimit: data.daily_spend_limit,
    whitelistAddresses: data.whitelist_addresses || [],
    whitelistEnabled: data.whitelist_enabled,
    requireConfirmation: data.require_confirmation,
    confirmationDelaySeconds: data.confirmation_delay_seconds,
    displayCurrency: data.display_currency || 'USD',
  };
}

function mapWebhook(raw: any): WebhookRegistration {
  return {
    id: raw.id,
    url: raw.url,
    events: raw.events || [],
    isActive: raw.is_active ?? true,
    secret: raw.secret,
    lastDeliveredAt: raw.last_delivered_at ?? null,
    lastError: raw.last_error ?? null,
    consecutiveFailures: raw.consecutive_failures ?? 0,
    createdAt: raw.created_at,
  };
  // ── Lightning Network ──

  /**
   * Get the Lightning Address for this wallet.
   */
  async getLightningAddress(): Promise<LightningAddress> {
    const data = await this.client.request<any>({
      method: 'GET',
      path: '/api/lightning/address',
      query: { wallet_id: this._walletId },
      authenticated: false,
    });
    return {
      lightning_address: data.lightning_address || null,
      username: data.username,
    };
  }

  /**
   * Register a Lightning Address (username@coinpayportal.com).
   * @param username - Desired username (lowercase, 3-32 chars)
   */
  async setLightningAddress(username: string): Promise<LightningAddress> {
    const data = await this.client.request<any>({
      method: 'POST',
      path: '/api/lightning/address',
      body: { wallet_id: this._walletId, username },
      authenticated: true,
    });
    return {
      lightning_address: data.lightning_address,
      username: data.username,
    };
  }

  /**
   * Create a Lightning invoice (BOLT11).
   * @param amount - Amount in sats
   * @param memo - Invoice description
   */
  async createLightningInvoice(amount: number, memo?: string): Promise<LightningInvoice> {
    const data = await this.client.request<any>({
      method: 'POST',
      path: '/api/lightning/invoices',
      body: {
        node_id: this._walletId,
        amount_sats: amount,
        description: memo || '',
        mnemonic: this.getMnemonic(),
      },
      authenticated: true,
    });
    return {
      payment_hash: data.data?.payment_hash || data.payment_hash,
      payment_request: data.data?.invoice?.bolt11 || data.payment_request,
      checking_id: data.data?.checking_id || data.checking_id,
    };
  }

  /**
   * Pay a Lightning invoice (BOLT11).
   * @param bolt11 - BOLT11 invoice string
   */
  async payLightningInvoice(bolt11: string): Promise<LightningPayment> {
    const data = await this.client.request<any>({
      method: 'POST',
      path: '/api/lightning/payments',
      body: {
        node_id: this._walletId,
        bolt11,
        mnemonic: this.getMnemonic(),
      },
      authenticated: true,
    });
    return data.data || data;
  }

  /**
   * Check a Lightning payment status.
   * @param paymentHash - Payment hash to check
   */
  async checkLightningPayment(paymentHash: string): Promise<LightningPaymentStatus> {
    const data = await this.client.request<any>({
      method: 'GET',
      path: `/api/lightning/payments/${paymentHash}`,
      authenticated: true,
    });
    return { paid: data.paid ?? data.data?.paid ?? false };
  }

  /**
   * List Lightning payments.
   * @param limit - Max number of payments to return
   */
  async listLightningPayments(limit: number = 20): Promise<LightningPayment[]> {
    const data = await this.client.request<any>({
      method: 'GET',
      path: '/api/lightning/payments',
      query: { node_id: this._walletId, limit: String(limit) },
      authenticated: true,
    });
    return data.data?.payments || data.payments || [];
  }
}

function mapSwap(raw: any): Swap {
  return {
    id: raw.id,
    from: raw.from_coin || raw.from || raw.depositCoin,
    to: raw.to_coin || raw.to || raw.settleCoin,
    depositAddress: raw.deposit_address || raw.depositAddress,
    depositAmount: raw.deposit_amount || raw.depositAmount,
    settleAddress: raw.settle_address || raw.settleAddress,
    settleAmount: raw.settle_amount || raw.settleAmount || null,
    status: raw.status,
    createdAt: raw.created_at || raw.createdAt,
    expiresAt: raw.expires_at || raw.expiresAt,
  };
}
