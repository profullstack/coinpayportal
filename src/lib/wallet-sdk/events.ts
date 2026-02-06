/**
 * Wallet SDK Event Emitter
 *
 * Polling-based event detection for incoming transactions,
 * confirmation changes, and balance changes.
 */

import type {
  WalletEventType,
  Balance,
  Transaction,
  TransactionEvent,
  BalanceChangedEvent,
  TransactionList,
} from './types';

type EventCallback = (event: {
  type: WalletEventType;
  data: any;
  timestamp: string;
}) => void;

/** Minimal interface for the Wallet methods the emitter needs. */
export interface WalletLike {
  getBalances(): Promise<Balance[]>;
  getTransactions(opts?: { limit?: number }): Promise<TransactionList>;
}

export class WalletEventEmitter {
  private readonly wallet: WalletLike;
  private listeners: Map<WalletEventType, Set<EventCallback>> = new Map();
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs: number = 15_000;

  private lastBalances: Map<string, string> = new Map();
  private knownTxIds: Set<string> = new Set();
  private lastConfirmationStatus: Map<string, string> = new Map();

  constructor(wallet: WalletLike) {
    this.wallet = wallet;
  }

  on(event: WalletEventType, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: WalletEventType, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: WalletEventType, data: any): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb({ type: event, data, timestamp: new Date().toISOString() });
        } catch {
          /* swallow listener errors */
        }
      }
    }
  }

  startPolling(intervalMs?: number): void {
    if (this.pollingInterval) return;
    if (intervalMs) this.pollIntervalMs = intervalMs;

    this.poll().catch(() => {});
    this.pollingInterval = setInterval(() => {
      this.poll().catch(() => {});
    }, this.pollIntervalMs);
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  get isPolling(): boolean {
    return this.pollingInterval !== null;
  }

  async poll(): Promise<void> {
    await Promise.allSettled([
      this.checkBalanceChanges(),
      this.checkTransactionChanges(),
    ]);
  }

  private async checkBalanceChanges(): Promise<void> {
    const listeners = this.listeners.get('balance.changed');
    if (!listeners || listeners.size === 0) return;

    const balances = await this.wallet.getBalances();
    for (const b of balances) {
      const key = `${b.chain}:${b.address}`;
      const previous = this.lastBalances.get(key);
      if (previous !== undefined && previous !== b.balance) {
        this.emit('balance.changed', {
          address: b.address,
          chain: b.chain,
          previousBalance: previous,
          newBalance: b.balance,
        } satisfies BalanceChangedEvent);
      }
      this.lastBalances.set(key, b.balance);
    }
  }

  private async checkTransactionChanges(): Promise<void> {
    const hasIncoming =
      (this.listeners.get('transaction.incoming')?.size || 0) > 0;
    const hasConfirmed =
      (this.listeners.get('transaction.confirmed')?.size || 0) > 0;
    if (!hasIncoming && !hasConfirmed) return;

    const { transactions } = await this.wallet.getTransactions({ limit: 20 });

    for (const tx of transactions) {
      if (
        hasIncoming &&
        tx.direction === 'incoming' &&
        !this.knownTxIds.has(tx.id)
      ) {
        this.emit('transaction.incoming', {
          transaction: tx,
        } satisfies TransactionEvent);
      }

      if (hasConfirmed) {
        const prevStatus = this.lastConfirmationStatus.get(tx.id);
        if (
          prevStatus &&
          prevStatus !== 'confirmed' &&
          tx.status === 'confirmed'
        ) {
          this.emit('transaction.confirmed', {
            transaction: tx,
          } satisfies TransactionEvent);
        }
        this.lastConfirmationStatus.set(tx.id, tx.status);
      }

      this.knownTxIds.add(tx.id);
    }
  }
}
