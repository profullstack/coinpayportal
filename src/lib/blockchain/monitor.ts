import { getProvider, type BlockchainType } from './providers';

/**
 * Transaction event interface
 */
export interface TransactionEvent {
  address: string;
  txHash: string;
  amount: string;
  confirmations: number;
  paymentId: string;
  timestamp: number;
}

/**
 * Payment status interface
 */
export interface PaymentStatus {
  address: string;
  balance: string;
  hasTransactions: boolean;
  lastChecked: number;
}

/**
 * Blockchain monitor for watching addresses and detecting transactions
 */
export class BlockchainMonitor {
  chain: BlockchainType;
  rpcUrl: string;
  private watchedAddresses: Map<string, string>; // address -> paymentId
  private intervalId: NodeJS.Timeout | null = null;
  private callback: ((event: TransactionEvent) => void) | null = null;
  private checkInterval: number = 30000; // 30 seconds default

  constructor(chain: BlockchainType, rpcUrl: string, checkInterval?: number) {
    this.chain = chain;
    this.rpcUrl = rpcUrl;
    this.watchedAddresses = new Map();
    if (checkInterval) {
      this.checkInterval = checkInterval;
    }
  }

  /**
   * Start monitoring watched addresses
   */
  start(callback: (event: TransactionEvent) => void): void {
    if (this.intervalId) {
      throw new Error('Monitor is already running');
    }

    this.callback = callback;
    this.intervalId = setInterval(() => {
      this.checkAddresses();
    }, this.checkInterval);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.callback = null;
    }
  }

  /**
   * Check if monitor is running
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }

  /**
   * Add an address to watch
   */
  watchAddress(address: string, paymentId: string): void {
    this.watchedAddresses.set(address, paymentId);
  }

  /**
   * Remove an address from watch list
   */
  unwatchAddress(address: string): void {
    this.watchedAddresses.delete(address);
  }

  /**
   * Check if an address is being watched
   */
  isWatching(address: string): boolean {
    return this.watchedAddresses.has(address);
  }

  /**
   * Get all watched addresses
   */
  getWatchedAddresses(): string[] {
    return Array.from(this.watchedAddresses.keys());
  }

  /**
   * Check all watched addresses for transactions
   */
  private async checkAddresses(): Promise<void> {
    if (!this.callback) return;

    const provider = getProvider(this.chain, this.rpcUrl);

    for (const [address, paymentId] of this.watchedAddresses.entries()) {
      try {
        const balance = await provider.getBalance(address);
        
        // If balance is greater than 0, there's been a transaction
        if (parseFloat(balance) > 0) {
          const event: TransactionEvent = {
            address,
            txHash: '', // Would need to fetch actual tx hash from provider
            amount: balance,
            confirmations: 0, // Would need to check actual confirmations
            paymentId,
            timestamp: Date.now(),
          };

          this.callback(event);
        }
      } catch (error) {
        console.error(`Error checking address ${address}:`, error);
      }
    }
  }
}

/**
 * Global monitors map
 */
const monitors = new Map<BlockchainType, BlockchainMonitor>();

/**
 * Start monitoring for a specific blockchain
 */
export function startMonitoring(
  chain: BlockchainType,
  rpcUrl: string,
  callback: (event: TransactionEvent) => void,
  checkInterval?: number
): BlockchainMonitor {
  if (monitors.has(chain)) {
    throw new Error(`Monitor for ${chain} is already running`);
  }

  const monitor = new BlockchainMonitor(chain, rpcUrl, checkInterval);
  monitor.start(callback);
  monitors.set(chain, monitor);

  return monitor;
}

/**
 * Stop monitoring for a specific blockchain
 */
export function stopMonitoring(chain: BlockchainType): void {
  const monitor = monitors.get(chain);
  if (monitor) {
    monitor.stop();
    monitors.delete(chain);
  }
}

/**
 * Get monitor for a specific blockchain
 */
export function getMonitor(chain: BlockchainType): BlockchainMonitor | undefined {
  return monitors.get(chain);
}

/**
 * Check payment status for an address
 */
export async function checkPaymentStatus(
  chain: BlockchainType,
  address: string,
  rpcUrl: string
): Promise<PaymentStatus> {
  const provider = getProvider(chain, rpcUrl);
  
  try {
    const balance = await provider.getBalance(address);
    
    return {
      address,
      balance,
      hasTransactions: parseFloat(balance) > 0,
      lastChecked: Date.now(),
    };
  } catch (error) {
    throw new Error(`Failed to check payment status: ${error}`);
  }
}

/**
 * Watch a payment address across all active monitors
 */
export function watchPaymentAddress(
  chain: BlockchainType,
  address: string,
  paymentId: string
): void {
  const monitor = monitors.get(chain);
  if (monitor) {
    monitor.watchAddress(address, paymentId);
  }
}

/**
 * Unwatch a payment address across all active monitors
 */
export function unwatchPaymentAddress(
  chain: BlockchainType,
  address: string
): void {
  const monitor = monitors.get(chain);
  if (monitor) {
    monitor.unwatchAddress(address);
  }
}