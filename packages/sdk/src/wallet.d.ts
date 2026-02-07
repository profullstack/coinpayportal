/**
 * Wallet Module Type Definitions
 */

/**
 * Supported blockchain chains
 */
export declare const WalletChain: {
  readonly BTC: 'BTC';
  readonly BCH: 'BCH';
  readonly ETH: 'ETH';
  readonly POL: 'POL';
  readonly SOL: 'SOL';
  readonly BNB: 'BNB';
  readonly USDC_ETH: 'USDC_ETH';
  readonly USDC_POL: 'USDC_POL';
  readonly USDC_SOL: 'USDC_SOL';
  readonly USDT_ETH: 'USDT_ETH';
  readonly USDT_POL: 'USDT_POL';
  readonly USDT_SOL: 'USDT_SOL';
};

export type WalletChainType = (typeof WalletChain)[keyof typeof WalletChain];

/**
 * Default chains to derive on wallet creation
 */
export declare const DEFAULT_CHAINS: string[];

/**
 * Wallet creation options
 */
export interface WalletCreateOptions {
  /** Number of mnemonic words (12 or 24) */
  words?: 12 | 24;
  /** Chains to derive initial addresses for */
  chains?: string[];
  /** API base URL */
  baseUrl?: string;
  /** Request timeout in ms */
  timeout?: number;
}

/**
 * Wallet import options
 */
export interface WalletImportOptions {
  /** Chains to derive addresses for */
  chains?: string[];
  /** API base URL */
  baseUrl?: string;
  /** Request timeout in ms */
  timeout?: number;
}

/**
 * Wallet address info
 */
export interface WalletAddress {
  address_id: string;
  chain: string;
  address: string;
  derivation_index: number;
  is_active: boolean;
  cached_balance?: string;
  balance_updated_at?: string;
}

/**
 * Address list result
 */
export interface AddressListResult {
  addresses: WalletAddress[];
  total: number;
}

/**
 * Balance info
 */
export interface WalletBalance {
  chain: string;
  address: string;
  balance: string;
  balance_usd?: string;
}

/**
 * Send transaction options
 */
export interface SendOptions {
  /** Target blockchain */
  chain: string;
  /** Recipient address */
  to: string;
  /** Amount to send */
  amount: string;
  /** Fee priority */
  priority?: 'low' | 'medium' | 'high';
}

/**
 * Transaction history options
 */
export interface HistoryOptions {
  /** Filter by chain */
  chain?: string;
  /** Filter by direction */
  direction?: 'incoming' | 'outgoing';
  /** Number of results */
  limit?: number;
  /** Pagination offset */
  offset?: number;
}

/**
 * Transaction record
 */
export interface Transaction {
  tx_id: string;
  chain: string;
  direction: 'incoming' | 'outgoing';
  amount: string;
  from_address: string;
  to_address: string;
  status: string;
  tx_hash?: string;
  created_at: string;
}

/**
 * Fee estimate
 */
export interface FeeEstimate {
  priority: 'low' | 'medium' | 'high';
  fee: string;
  fee_usd?: string;
  estimated_time?: string;
}

/**
 * WalletClient class for managing wallets
 */
export declare class WalletClient {
  private constructor(options?: { baseUrl?: string; timeout?: number });
  
  /**
   * Create a new wallet with a fresh mnemonic
   */
  static create(options?: WalletCreateOptions): Promise<WalletClient>;
  
  /**
   * Import an existing wallet from a mnemonic
   */
  static fromSeed(mnemonic: string, options?: WalletImportOptions): Promise<WalletClient>;
  
  /**
   * Get the mnemonic phrase (for backup)
   */
  getMnemonic(): string | null;
  
  /**
   * Get the wallet ID
   */
  getWalletId(): string | null;
  
  /**
   * Authenticate with the server
   */
  authenticate(): Promise<void>;
  
  /**
   * Get wallet info
   */
  getInfo(): Promise<{
    wallet_id: string;
    status: string;
    created_at: string;
    last_active_at?: string;
    address_count: number;
  }>;
  
  /**
   * Get all addresses for this wallet
   */
  getAddresses(options?: { chain?: string; activeOnly?: boolean }): Promise<AddressListResult>;
  
  /**
   * Derive a new address for a chain
   */
  deriveAddress(chain: string, index?: number): Promise<WalletAddress>;
  
  /**
   * Derive addresses for any missing chains
   */
  deriveMissingChains(targetChains?: string[]): Promise<WalletAddress[]>;
  
  /**
   * Get all balances for this wallet
   */
  getBalances(options?: { chain?: string; refresh?: boolean }): Promise<{ balances: WalletBalance[] }>;
  
  /**
   * Get balance for a specific chain
   */
  getBalance(chain: string): Promise<{ balances: WalletBalance[] }>;
  
  /**
   * Send a transaction
   */
  send(options: SendOptions): Promise<{
    tx_id: string;
    tx_hash: string;
    status: string;
  }>;
  
  /**
   * Get transaction history
   */
  getHistory(options?: HistoryOptions): Promise<{
    transactions: Transaction[];
    total: number;
  }>;
  
  /**
   * Estimate transaction fee
   */
  estimateFee(chain: string, to?: string, amount?: string): Promise<{
    chain: string;
    estimates: FeeEstimate[];
  }>;
  
  /**
   * Encrypt and backup the seed phrase
   */
  backupSeed(password: string): Promise<string>;
}

/**
 * Generate a new mnemonic phrase
 * @param words - Number of words (12 or 24)
 */
export declare function generateMnemonic(words?: 12 | 24): string;

/**
 * Validate a mnemonic phrase
 */
export declare function validateMnemonic(mnemonic: string): boolean;

/**
 * Get derivation path for a chain
 */
export declare function getDerivationPath(chain: string, index?: number): string;

/**
 * Restore a seed from encrypted backup
 */
export declare function restoreFromBackup(encryptedBackup: string, password: string): Promise<string>;

export default WalletClient;
