import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BlockchainMonitor,
  startMonitoring,
  stopMonitoring,
  checkPaymentStatus,
} from './monitor';

describe('Blockchain Monitor', () => {
  describe('BlockchainMonitor', () => {
    let monitor: BlockchainMonitor;

    beforeEach(() => {
      monitor = new BlockchainMonitor('ETH', 'https://eth-rpc.example.com');
    });

    afterEach(() => {
      monitor.stop();
    });

    it('should create a monitor instance', () => {
      expect(monitor).toBeInstanceOf(BlockchainMonitor);
      expect(monitor.chain).toBe('ETH');
    });

    it('should start monitoring', () => {
      const callback = vi.fn();
      monitor.start(callback);
      expect(monitor.isRunning()).toBe(true);
    });

    it('should stop monitoring', () => {
      const callback = vi.fn();
      monitor.start(callback);
      monitor.stop();
      expect(monitor.isRunning()).toBe(false);
    });

    it('should watch an address', () => {
      const address = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
      monitor.watchAddress(address, 'payment-123');
      expect(monitor.isWatching(address)).toBe(true);
    });

    it('should unwatch an address', () => {
      const address = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
      monitor.watchAddress(address, 'payment-123');
      monitor.unwatchAddress(address);
      expect(monitor.isWatching(address)).toBe(false);
    });

    it('should get watched addresses', () => {
      const address1 = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
      const address2 = '0x0000000000000000000000000000000000000001';
      monitor.watchAddress(address1, 'payment-123');
      monitor.watchAddress(address2, 'payment-456');
      
      const watched = monitor.getWatchedAddresses();
      expect(watched).toHaveLength(2);
      expect(watched).toContain(address1);
      expect(watched).toContain(address2);
    });
  });

  describe('checkPaymentStatus', () => {
    it('should check payment status for an address', async () => {
      const result = await checkPaymentStatus(
        'ETH',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        'https://eth-rpc.example.com'
      );

      expect(result).toHaveProperty('address');
      expect(result).toHaveProperty('balance');
      expect(result).toHaveProperty('hasTransactions');
    });

    it('should handle errors gracefully', async () => {
      await expect(
        checkPaymentStatus('ETH', 'invalid-address', 'https://eth-rpc.example.com')
      ).rejects.toThrow();
    });
  });

  describe('startMonitoring and stopMonitoring', () => {
    it('should start global monitoring', () => {
      const callback = vi.fn();
      startMonitoring('ETH', 'https://eth-rpc.example.com', callback);
      // Monitor should be running
      stopMonitoring('ETH');
    });

    it('should stop global monitoring', () => {
      const callback = vi.fn();
      startMonitoring('ETH', 'https://eth-rpc.example.com', callback);
      stopMonitoring('ETH');
      // Monitor should be stopped
    });
  });
});