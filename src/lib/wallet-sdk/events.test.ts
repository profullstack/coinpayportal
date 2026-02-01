import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WalletEventEmitter } from './events';
import type { WalletLike } from './events';
import type { Balance, TransactionList } from './types';

function createMockWallet(overrides?: Partial<WalletLike>): WalletLike {
  return {
    getBalances: vi.fn().mockResolvedValue([]),
    getTransactions: vi.fn().mockResolvedValue({
      transactions: [],
      total: 0,
      limit: 20,
      offset: 0,
    }),
    ...overrides,
  };
}

describe('WalletEventEmitter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('listener management', () => {
    it('should register and call listeners for events', async () => {
      const wallet = createMockWallet({
        getBalances: vi.fn()
          .mockResolvedValueOnce([
            { balance: '1.0', chain: 'ETH', address: '0xa', updatedAt: '' },
          ] as Balance[])
          .mockResolvedValueOnce([
            { balance: '2.0', chain: 'ETH', address: '0xa', updatedAt: '' },
          ] as Balance[]),
      });

      const emitter = new WalletEventEmitter(wallet);
      const callback = vi.fn();

      emitter.on('balance.changed', callback);

      // First poll: establishes baseline
      await emitter.poll();
      expect(callback).not.toHaveBeenCalled();

      // Second poll: balance changed
      await emitter.poll();
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].type).toBe('balance.changed');
      expect(callback.mock.calls[0][0].data.previousBalance).toBe('1.0');
      expect(callback.mock.calls[0][0].data.newBalance).toBe('2.0');
    });

    it('should remove listeners with off()', async () => {
      const wallet = createMockWallet({
        getBalances: vi.fn()
          .mockResolvedValueOnce([
            { balance: '1.0', chain: 'ETH', address: '0xa', updatedAt: '' },
          ] as Balance[])
          .mockResolvedValueOnce([
            { balance: '2.0', chain: 'ETH', address: '0xa', updatedAt: '' },
          ] as Balance[]),
      });

      const emitter = new WalletEventEmitter(wallet);
      const callback = vi.fn();

      emitter.on('balance.changed', callback);
      await emitter.poll(); // baseline

      emitter.off('balance.changed', callback);
      await emitter.poll(); // change, but listener removed

      expect(callback).not.toHaveBeenCalled();
    });

    it('should not throw if listener throws', async () => {
      const wallet = createMockWallet({
        getBalances: vi.fn()
          .mockResolvedValueOnce([
            { balance: '1.0', chain: 'ETH', address: '0xa', updatedAt: '' },
          ] as Balance[])
          .mockResolvedValueOnce([
            { balance: '2.0', chain: 'ETH', address: '0xa', updatedAt: '' },
          ] as Balance[]),
      });

      const emitter = new WalletEventEmitter(wallet);
      emitter.on('balance.changed', () => {
        throw new Error('listener error');
      });

      await emitter.poll();
      // No throw on second poll
      await expect(emitter.poll()).resolves.not.toThrow();
    });
  });

  describe('polling control', () => {
    it('should start and stop polling', () => {
      const wallet = createMockWallet();
      const emitter = new WalletEventEmitter(wallet);

      expect(emitter.isPolling).toBe(false);

      emitter.startPolling(1000);
      expect(emitter.isPolling).toBe(true);

      emitter.stopPolling();
      expect(emitter.isPolling).toBe(false);
    });

    it('should not start duplicate polling', () => {
      const wallet = createMockWallet();
      const emitter = new WalletEventEmitter(wallet);

      emitter.startPolling(1000);
      emitter.startPolling(1000); // should not create second interval

      expect(emitter.isPolling).toBe(true);
      emitter.stopPolling();
    });
  });

  describe('balance.changed events', () => {
    it('should not emit on first poll (no previous state)', async () => {
      const wallet = createMockWallet({
        getBalances: vi.fn().mockResolvedValue([
          { balance: '5.0', chain: 'ETH', address: '0xa', updatedAt: '' },
        ] as Balance[]),
      });

      const emitter = new WalletEventEmitter(wallet);
      const callback = vi.fn();
      emitter.on('balance.changed', callback);

      await emitter.poll();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should not emit when balance is unchanged', async () => {
      const wallet = createMockWallet({
        getBalances: vi.fn().mockResolvedValue([
          { balance: '5.0', chain: 'ETH', address: '0xa', updatedAt: '' },
        ] as Balance[]),
      });

      const emitter = new WalletEventEmitter(wallet);
      const callback = vi.fn();
      emitter.on('balance.changed', callback);

      await emitter.poll(); // baseline
      await emitter.poll(); // same balance

      expect(callback).not.toHaveBeenCalled();
    });

    it('should track multiple addresses independently', async () => {
      const wallet = createMockWallet({
        getBalances: vi.fn()
          .mockResolvedValueOnce([
            { balance: '1.0', chain: 'ETH', address: '0xa', updatedAt: '' },
            { balance: '2.0', chain: 'BTC', address: '1abc', updatedAt: '' },
          ] as Balance[])
          .mockResolvedValueOnce([
            { balance: '1.0', chain: 'ETH', address: '0xa', updatedAt: '' },
            { balance: '3.0', chain: 'BTC', address: '1abc', updatedAt: '' },
          ] as Balance[]),
      });

      const emitter = new WalletEventEmitter(wallet);
      const callback = vi.fn();
      emitter.on('balance.changed', callback);

      await emitter.poll(); // baseline
      await emitter.poll(); // only BTC changed

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].data.chain).toBe('BTC');
      expect(callback.mock.calls[0][0].data.previousBalance).toBe('2.0');
      expect(callback.mock.calls[0][0].data.newBalance).toBe('3.0');
    });
  });

  describe('transaction.incoming events', () => {
    it('should emit for new incoming transactions', async () => {
      const wallet = createMockWallet({
        getTransactions: vi.fn()
          .mockResolvedValueOnce({
            transactions: [],
            total: 0,
            limit: 20,
            offset: 0,
          } as TransactionList)
          .mockResolvedValueOnce({
            transactions: [
              {
                id: 'tx-1',
                walletId: 'w1',
                chain: 'ETH',
                txHash: '0xhash',
                direction: 'incoming',
                status: 'pending',
                amount: '1.0',
                fromAddress: '0xsender',
                toAddress: '0xreceiver',
                feeAmount: null,
                feeCurrency: null,
                confirmations: 0,
                blockNumber: null,
                blockTimestamp: null,
                createdAt: '2024-01-01T00:00:00Z',
              },
            ],
            total: 1,
            limit: 20,
            offset: 0,
          } as TransactionList),
      });

      const emitter = new WalletEventEmitter(wallet);
      const callback = vi.fn();
      emitter.on('transaction.incoming', callback);

      await emitter.poll(); // no txs
      await emitter.poll(); // new incoming tx

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].data.transaction.txHash).toBe('0xhash');
    });

    it('should not emit for already-known transactions', async () => {
      const tx = {
        id: 'tx-1',
        walletId: 'w1',
        chain: 'ETH',
        txHash: '0xhash',
        direction: 'incoming',
        status: 'pending',
        amount: '1.0',
        fromAddress: '0xs',
        toAddress: '0xr',
        feeAmount: null,
        feeCurrency: null,
        confirmations: 0,
        blockNumber: null,
        blockTimestamp: null,
        createdAt: '2024-01-01T00:00:00Z',
      };

      const wallet = createMockWallet({
        getTransactions: vi.fn().mockResolvedValue({
          transactions: [tx],
          total: 1,
          limit: 20,
          offset: 0,
        } as TransactionList),
      });

      const emitter = new WalletEventEmitter(wallet);
      const callback = vi.fn();
      emitter.on('transaction.incoming', callback);

      await emitter.poll();
      await emitter.poll(); // same tx, should not emit again

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should not emit for outgoing transactions', async () => {
      const wallet = createMockWallet({
        getTransactions: vi.fn()
          .mockResolvedValueOnce({
            transactions: [],
            total: 0,
            limit: 20,
            offset: 0,
          })
          .mockResolvedValueOnce({
            transactions: [
              {
                id: 'tx-1',
                direction: 'outgoing',
                status: 'pending',
              },
            ],
            total: 1,
            limit: 20,
            offset: 0,
          } as TransactionList),
      });

      const emitter = new WalletEventEmitter(wallet);
      const callback = vi.fn();
      emitter.on('transaction.incoming', callback);

      await emitter.poll();
      await emitter.poll();

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('transaction.confirmed events', () => {
    it('should emit when transaction status changes to confirmed', async () => {
      const pendingTx = {
        id: 'tx-1',
        walletId: 'w1',
        chain: 'ETH',
        txHash: '0xhash',
        direction: 'outgoing',
        status: 'pending',
        amount: '1.0',
        fromAddress: '0xs',
        toAddress: '0xr',
        feeAmount: null,
        feeCurrency: null,
        confirmations: 0,
        blockNumber: null,
        blockTimestamp: null,
        createdAt: '2024-01-01T00:00:00Z',
      };

      const confirmedTx = { ...pendingTx, status: 'confirmed', confirmations: 12 };

      const wallet = createMockWallet({
        getTransactions: vi.fn()
          .mockResolvedValueOnce({
            transactions: [pendingTx],
            total: 1,
            limit: 20,
            offset: 0,
          })
          .mockResolvedValueOnce({
            transactions: [confirmedTx],
            total: 1,
            limit: 20,
            offset: 0,
          }),
      });

      const emitter = new WalletEventEmitter(wallet);
      const callback = vi.fn();
      emitter.on('transaction.confirmed', callback);

      await emitter.poll(); // pending
      await emitter.poll(); // confirmed

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].data.transaction.status).toBe(
        'confirmed'
      );
    });

    it('should not emit if already confirmed', async () => {
      const confirmedTx = {
        id: 'tx-1',
        direction: 'outgoing',
        status: 'confirmed',
        confirmations: 12,
      };

      const wallet = createMockWallet({
        getTransactions: vi.fn().mockResolvedValue({
          transactions: [confirmedTx],
          total: 1,
          limit: 20,
          offset: 0,
        }),
      });

      const emitter = new WalletEventEmitter(wallet);
      const callback = vi.fn();
      emitter.on('transaction.confirmed', callback);

      await emitter.poll();
      await emitter.poll(); // already confirmed both times

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('efficiency', () => {
    it('should skip balance check if no balance.changed listeners', async () => {
      const getBalances = vi.fn().mockResolvedValue([]);
      const wallet = createMockWallet({ getBalances });

      const emitter = new WalletEventEmitter(wallet);
      // Register only a transaction listener, no balance listener
      emitter.on('transaction.incoming', () => {});

      await emitter.poll();

      expect(getBalances).not.toHaveBeenCalled();
    });

    it('should skip transaction check if no transaction listeners', async () => {
      const getTransactions = vi.fn().mockResolvedValue({
        transactions: [],
        total: 0,
        limit: 20,
        offset: 0,
      });
      const wallet = createMockWallet({ getTransactions });

      const emitter = new WalletEventEmitter(wallet);
      // Register only a balance listener
      emitter.on('balance.changed', () => {});

      await emitter.poll();

      expect(getTransactions).not.toHaveBeenCalled();
    });
  });
});
