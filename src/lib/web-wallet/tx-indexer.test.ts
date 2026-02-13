import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchOnChainHistory } from './tx-indexer';

// ──────────────────────────────────────────────
// Mock fetch
// ──────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Test constants
const TEST_SOL_ADDRESS = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
const TEST_RPC_URL = 'https://api.mainnet-beta.solana.com';

// ──────────────────────────────────────────────
// SOL Transaction Indexer Tests
// ──────────────────────────────────────────────

describe('fetchOnChainHistory - SOL', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Set default RPC URL
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL = TEST_RPC_URL;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('SOL transaction filtering', () => {
    it('should include transactions with actual balance changes', async () => {
      // Mock getSignaturesForAddress response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: [
            {
              signature: 'sig1_incoming_tx',
              slot: 123456,
              blockTime: 1640995200,
              confirmationStatus: 'finalized',
              err: null,
            },
            {
              signature: 'sig2_outgoing_tx', 
              slot: 123457,
              blockTime: 1640995300,
              confirmationStatus: 'finalized',
              err: null,
            },
          ],
          id: 1,
        }),
      });

      // Mock getTransaction responses for each signature
      // First call: incoming transaction (balance increased by 2 SOL)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: {
            meta: {
              fee: 5000,
              preBalances: [1000000000, 5000000000], // 1 SOL, 5 SOL
              postBalances: [1000000000, 7000000000], // 1 SOL, 7 SOL (+2 SOL)
              err: null,
            },
            transaction: {
              message: {
                accountKeys: [
                  { pubkey: 'sender_account' },
                  { pubkey: TEST_SOL_ADDRESS },
                ],
              },
            },
          },
          id: 1,
        }),
      });

      // Second call: outgoing transaction (balance decreased by 1.5 SOL)  
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: {
            meta: {
              fee: 5000,
              preBalances: [3000000000, 7000000000], // 3 SOL, 7 SOL
              postBalances: [4500000000, 5500000000], // 4.5 SOL, 5.5 SOL (-1.5 SOL)
              err: null,
            },
            transaction: {
              message: {
                accountKeys: [
                  { pubkey: 'recipient_account' },
                  { pubkey: TEST_SOL_ADDRESS },
                ],
              },
            },
          },
          id: 1,
        }),
      });

      const result = await fetchOnChainHistory(TEST_SOL_ADDRESS, 'SOL');

      expect(result).toHaveLength(2);
      
      // Check incoming transaction
      expect(result[0]).toMatchObject({
        txHash: 'sig1_incoming_tx',
        chain: 'SOL',
        direction: 'incoming',
        amount: '2',
        fromAddress: 'sender_account',
        toAddress: TEST_SOL_ADDRESS,
        status: 'confirmed',
        confirmations: 32,
      });

      // Check outgoing transaction  
      expect(result[1]).toMatchObject({
        txHash: 'sig2_outgoing_tx',
        chain: 'SOL',
        direction: 'outgoing', 
        amount: '1.5',
        fromAddress: TEST_SOL_ADDRESS,
        toAddress: 'recipient_account',
        status: 'confirmed',
        confirmations: 32,
      });
    });

    it('should filter out 0-value system program transactions', async () => {
      // Mock getSignaturesForAddress response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: [
            {
              signature: 'sig1_system_program',
              slot: 123456,
              blockTime: 1640995200,
              confirmationStatus: 'finalized',
              err: null,
            },
            {
              signature: 'sig2_compute_budget',
              slot: 123457,
              blockTime: 1640995300,
              confirmationStatus: 'finalized', 
              err: null,
            },
            {
              signature: 'sig3_real_transfer',
              slot: 123458,
              blockTime: 1640995400,
              confirmationStatus: 'finalized',
              err: null,
            },
          ],
          id: 1,
        }),
      });

      // Mock getTransaction responses
      // First call: system program instruction with 0 balance change
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: {
            meta: {
              fee: 5000,
              preBalances: [5000000000], // 5 SOL
              postBalances: [5000000000], // 5 SOL (no change)
              err: null,
            },
            transaction: {
              message: {
                accountKeys: [
                  { pubkey: TEST_SOL_ADDRESS },
                ],
              },
            },
          },
          id: 1,
        }),
      });

      // Second call: compute budget instruction with 0 balance change
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: {
            meta: {
              fee: 5000,
              preBalances: [5000000000], // 5 SOL
              postBalances: [5000000000], // 5 SOL (no change)
              err: null,
            },
            transaction: {
              message: {
                accountKeys: [
                  { pubkey: TEST_SOL_ADDRESS },
                ],
              },
            },
          },
          id: 1,
        }),
      });

      // Third call: actual transfer with balance change
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: {
            meta: {
              fee: 5000,
              preBalances: [2000000000, 5000000000], // 2 SOL, 5 SOL
              postBalances: [2000000000, 6000000000], // 2 SOL, 6 SOL (+1 SOL)
              err: null,
            },
            transaction: {
              message: {
                accountKeys: [
                  { pubkey: 'sender_account' },
                  { pubkey: TEST_SOL_ADDRESS },
                ],
              },
            },
          },
          id: 1,
        }),
      });

      const result = await fetchOnChainHistory(TEST_SOL_ADDRESS, 'SOL');

      // Should only return the real transfer, filtering out the 0-value transactions
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        txHash: 'sig3_real_transfer',
        chain: 'SOL',
        direction: 'incoming',
        amount: '1',
        fromAddress: 'sender_account',
        toAddress: TEST_SOL_ADDRESS,
      });
    });

    it('should NOT add fallback entries for failed transaction fetches', async () => {
      // Mock getSignaturesForAddress response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0', 
          result: [
            {
              signature: 'sig1_fetch_fails',
              slot: 123456,
              blockTime: 1640995200,
              confirmationStatus: 'finalized',
              err: null,
            },
            {
              signature: 'sig2_network_error',
              slot: 123457,
              blockTime: 1640995300,
              confirmationStatus: 'finalized',
              err: null,
            },
            {
              signature: 'sig3_successful',
              slot: 123458,
              blockTime: 1640995400,
              confirmationStatus: 'finalized',
              err: null,
            },
          ],
          id: 1,
        }),
      });

      // First transaction fetch fails with HTTP error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // Second transaction fetch throws network error
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      // Third transaction fetch succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: {
            meta: {
              fee: 5000,
              preBalances: [2000000000, 3000000000], // 2 SOL, 3 SOL
              postBalances: [2000000000, 3500000000], // 2 SOL, 3.5 SOL (+0.5 SOL)
              err: null,
            },
            transaction: {
              message: {
                accountKeys: [
                  { pubkey: 'sender_account' },
                  { pubkey: TEST_SOL_ADDRESS },
                ],
              },
            },
          },
          id: 1,
        }),
      });

      const result = await fetchOnChainHistory(TEST_SOL_ADDRESS, 'SOL');

      // Should only return successful transaction, NOT create fallback entries for failed fetches
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        txHash: 'sig3_successful',
        chain: 'SOL',
        direction: 'incoming',
        amount: '0.5',
        fromAddress: 'sender_account',
        toAddress: TEST_SOL_ADDRESS,
      });
    });

    it('should correctly detect direction based on pre/post balance diff', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: [
            {
              signature: 'sig1_positive_diff',
              slot: 123456,
              blockTime: 1640995200,
              confirmationStatus: 'finalized',
              err: null,
            },
            {
              signature: 'sig2_negative_diff',
              slot: 123457,
              blockTime: 1640995300,
              confirmationStatus: 'finalized',
              err: null,
            },
          ],
          id: 1,
        }),
      });

      // Positive balance difference (incoming)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: {
            meta: {
              fee: 5000,
              preBalances: [1000000000, 2000000000], // 1 SOL, 2 SOL
              postBalances: [1000000000, 4500000000], // 1 SOL, 4.5 SOL (+2.5 SOL)
              err: null,
            },
            transaction: {
              message: {
                accountKeys: [
                  { pubkey: 'other_account' },
                  { pubkey: TEST_SOL_ADDRESS },
                ],
              },
            },
          },
          id: 1,
        }),
      });

      // Negative balance difference (outgoing)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: {
            meta: {
              fee: 5000,
              preBalances: [3000000000, 4500000000], // 3 SOL, 4.5 SOL
              postBalances: [4200000000, 3300000000], // 4.2 SOL, 3.3 SOL (-1.2 SOL)
              err: null,
            },
            transaction: {
              message: {
                accountKeys: [
                  { pubkey: 'recipient_account' },
                  { pubkey: TEST_SOL_ADDRESS },
                ],
              },
            },
          },
          id: 1,
        }),
      });

      const result = await fetchOnChainHistory(TEST_SOL_ADDRESS, 'SOL');

      expect(result).toHaveLength(2);

      // Positive diff should be incoming
      expect(result[0]).toMatchObject({
        direction: 'incoming',
        amount: '2.5',
        fromAddress: 'other_account',
        toAddress: TEST_SOL_ADDRESS,
      });

      // Negative diff should be outgoing
      expect(result[1]).toMatchObject({
        direction: 'outgoing',
        amount: '1.2',
        fromAddress: TEST_SOL_ADDRESS,
        toAddress: 'recipient_account',
      });
    });

    it('should correctly convert lamports to SOL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: [
            {
              signature: 'sig1_precise_amount',
              slot: 123456,
              blockTime: 1640995200,
              confirmationStatus: 'finalized',
              err: null,
            },
          ],
          id: 1,
        }),
      });

      // Test precise lamports conversion (123456789 lamports = 0.123456789 SOL)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: {
            meta: {
              fee: 5000,
              preBalances: [1000000000, 2000000000], // 1 SOL, 2 SOL
              postBalances: [1000000000, 2123456789], // 1 SOL, 2.123456789 SOL (+0.123456789 SOL)
              err: null,
            },
            transaction: {
              message: {
                accountKeys: [
                  { pubkey: 'sender_account' },
                  { pubkey: TEST_SOL_ADDRESS },
                ],
              },
            },
          },
          id: 1,
        }),
      });

      const result = await fetchOnChainHistory(TEST_SOL_ADDRESS, 'SOL');

      expect(result).toHaveLength(1);
      expect(result[0].amount).toBe('0.123456789');
    });

    it('should handle pending transactions correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: [
            {
              signature: 'sig1_pending',
              slot: 123456,
              blockTime: null, // No block time yet
              confirmationStatus: 'processed', // Not finalized
              err: null,
            },
          ],
          id: 1,
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: {
            meta: {
              fee: 5000,
              preBalances: [1000000000, 2000000000],
              postBalances: [1000000000, 3000000000], // +1 SOL
              err: null,
            },
            transaction: {
              message: {
                accountKeys: [
                  { pubkey: 'sender_account' },
                  { pubkey: TEST_SOL_ADDRESS },
                ],
              },
            },
          },
          id: 1,
        }),
      });

      const result = await fetchOnChainHistory(TEST_SOL_ADDRESS, 'SOL');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        status: 'pending',
        confirmations: 0,
      });
      // Should use current time if no blockTime
      expect(new Date(result[0].timestamp).getTime()).toBeGreaterThan(Date.now() - 10000);
    });

    it('should include fee information when available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: [
            {
              signature: 'sig1_with_fee',
              slot: 123456,
              blockTime: 1640995200,
              confirmationStatus: 'finalized',
              err: null,
            },
          ],
          id: 1,
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: {
            meta: {
              fee: 10000, // 0.00001 SOL fee
              preBalances: [1000000000, 2000000000],
              postBalances: [1000000000, 3000000000], // +1 SOL
              err: null,
            },
            transaction: {
              message: {
                accountKeys: [
                  { pubkey: 'sender_account' },
                  { pubkey: TEST_SOL_ADDRESS },
                ],
              },
            },
          },
          id: 1,
        }),
      });

      const result = await fetchOnChainHistory(TEST_SOL_ADDRESS, 'SOL');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        fee: '0.00001',
        blockNumber: 123456,
      });
    });

    it('should handle account not found in transaction', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: [
            {
              signature: 'sig1_no_account',
              slot: 123456,
              blockTime: 1640995200,
              confirmationStatus: 'finalized',
              err: null,
            },
          ],
          id: 1,
        }),
      });

      // Transaction where our address is not in accountKeys
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: {
            meta: {
              fee: 5000,
              preBalances: [1000000000, 2000000000],
              postBalances: [1500000000, 1500000000],
              err: null,
            },
            transaction: {
              message: {
                accountKeys: [
                  { pubkey: 'some_other_account' },
                  { pubkey: 'another_account' },
                ],
              },
            },
          },
          id: 1,
        }),
      });

      const result = await fetchOnChainHistory(TEST_SOL_ADDRESS, 'SOL');

      // Should filter out transaction where our account is not found
      expect(result).toHaveLength(0);
    });

    it('should handle RPC errors gracefully', async () => {
      // Mock failed signatures fetch
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(fetchOnChainHistory(TEST_SOL_ADDRESS, 'SOL')).rejects.toThrow('SOL signatures fetch failed: 500');
    });

    it('should handle RPC response errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          error: { message: 'Invalid address format' },
          id: 1,
        }),
      });

      await expect(fetchOnChainHistory(TEST_SOL_ADDRESS, 'SOL')).rejects.toThrow('SOL RPC error: Invalid address format');
    });
  });
});