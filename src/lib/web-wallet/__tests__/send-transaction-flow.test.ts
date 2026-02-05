/**
 * Send Transaction Flow Integration Tests
 *
 * Tests the complete send flow: prepare → sign → broadcast
 * with mocked RPC endpoints for each chain.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { broadcastTransaction, withRetry, EXPLORER_URLS } from '../broadcast';
import { prepareSendTransaction } from '../prepare-tx';
import { signTransaction, clearMemory } from '../signing';
import { deriveKeyForChain, generateMnemonic, deriveWalletBundle } from '../keys';

// ──────────────────────────────────────────────
// Mock Supabase
// ──────────────────────────────────────────────

function createMockSupabase(overrides: {
  selectData?: any;
  selectError?: any;
  updateData?: any;
  updateError?: any;
} = {}) {
  const updateMock = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({
        data: overrides.updateData ?? null,
        error: overrides.updateError ?? null,
      }),
    }),
  });

  const singleMock = vi.fn().mockResolvedValue({
    data: overrides.selectData ?? null,
    error: overrides.selectError ?? null,
  });

  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: singleMock,
          }),
        }),
      }),
      update: updateMock,
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'tx-prepared-001', status: 'pending' },
            error: null,
          }),
        }),
      }),
    }),
    _updateMock: updateMock,
  } as any;
}

// ──────────────────────────────────────────────
// Mock Global Fetch
// ──────────────────────────────────────────────

const originalFetch = global.fetch;

function mockFetch(handler: (url: string, opts: any) => any) {
  global.fetch = vi.fn(async (url: any, opts: any) => handler(url.toString(), opts)) as any;
}

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────
// EVM Send Flow (ETH)
// ──────────────────────────────────────────────

describe('Send Transaction Flow - EVM (ETH)', () => {
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  it('should sign an EVM transaction and produce valid hex output', async () => {
    const key = await deriveKeyForChain(mnemonic, 'ETH', 0);

    const unsignedTx = {
      type: 'evm' as const,
      chainId: '1',
      nonce: '0',
      maxPriorityFeePerGas: '1500000000',
      maxFeePerGas: '30000000000',
      gasLimit: '21000',
      to: '0x1234567890abcdef1234567890abcdef12345678',
      value: '1000000000000000',
      data: '',
    };

    const result = await signTransaction({
      unsigned_tx: unsignedTx,
      privateKey: key.privateKey,
    });

    expect(result.format).toBe('hex');
    expect(result.signed_tx).toMatch(/^0x02/); // EIP-1559 type prefix
    expect(result.signed_tx.length).toBeGreaterThan(100);
  });

  it('should broadcast a signed EVM transaction via eth_sendRawTransaction', async () => {
    const expectedTxHash = '0xabc123def456789';

    mockFetch((url, opts) => {
      if (opts?.body) {
        const body = JSON.parse(opts.body);
        if (body.method === 'eth_sendRawTransaction') {
          return {
            ok: true,
            json: async () => ({
              jsonrpc: '2.0',
              id: 1,
              result: expectedTxHash,
            }),
          };
        }
      }
      return { ok: false, status: 500, text: async () => 'Unknown request' };
    });

    const supabase = createMockSupabase({
      selectData: {
        id: 'tx-001',
        wallet_id: 'wallet-001',
        chain: 'ETH',
        status: 'pending',
        metadata: { expires_at: new Date(Date.now() + 300_000).toISOString() },
        from_address: '0xabc',
        to_address: '0xdef',
        amount: '0.01',
      },
    });

    const result = await broadcastTransaction(supabase, 'wallet-001', {
      tx_id: 'tx-001',
      signed_tx: '0x02f87001808459682f00851bf08eb00082520894...',
      chain: 'ETH',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tx_hash).toBe(expectedTxHash);
      expect(result.data.chain).toBe('ETH');
      expect(result.data.status).toBe('confirming');
      expect(result.data.explorer_url).toContain('etherscan.io');
    }
  });

  it('should handle EVM RPC error response', async () => {
    mockFetch((url, opts) => {
      return {
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32000, message: 'nonce too low' },
        }),
      };
    });

    const supabase = createMockSupabase({
      selectData: {
        id: 'tx-002',
        wallet_id: 'wallet-001',
        chain: 'ETH',
        status: 'pending',
        metadata: { expires_at: new Date(Date.now() + 300_000).toISOString() },
        from_address: '0xabc',
        to_address: '0xdef',
        amount: '0.01',
      },
    });

    const result = await broadcastTransaction(supabase, 'wallet-001', {
      tx_id: 'tx-002',
      signed_tx: '0x02f870...',
      chain: 'ETH',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('nonce too low');
      expect(result.code).toBe('BROADCAST_FAILED');
    }
  });
});

// ──────────────────────────────────────────────
// BTC Send Flow
// ──────────────────────────────────────────────

describe('Send Transaction Flow - BTC', () => {
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  it('should sign a BTC P2PKH transaction', async () => {
    const key = await deriveKeyForChain(mnemonic, 'BTC', 0);

    const unsignedTx = {
      type: 'btc' as const,
      inputs: [
        {
          txid: 'a'.repeat(64),
          vout: 0,
          value: 50000,
          scriptPubKey: '76a91489abcdefabbaabbaabbaabbaabbaabbaabbaabba88ac',
        },
      ],
      outputs: [
        {
          address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
          value: 40000,
        },
        {
          address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
          value: 9000,
        },
      ],
    };

    const result = await signTransaction({
      unsigned_tx: unsignedTx,
      privateKey: key.privateKey,
    });

    expect(result.format).toBe('hex');
    expect(result.signed_tx.length).toBeGreaterThan(100);
    // BTC v1 transactions start with version byte 01000000
    expect(result.signed_tx.startsWith('01000000')).toBe(true);
  });

  it('should broadcast a BTC transaction via Blockstream API', async () => {
    const expectedTxid = 'b'.repeat(64);

    mockFetch((url, opts) => {
      if (url.includes('blockstream.info/api/tx') && opts?.method === 'POST') {
        return {
          ok: true,
          text: async () => expectedTxid,
        };
      }
      return { ok: false, status: 500, text: async () => 'Unknown' };
    });

    const supabase = createMockSupabase({
      selectData: {
        id: 'tx-btc-001',
        wallet_id: 'wallet-btc',
        chain: 'BTC',
        status: 'pending',
        metadata: { expires_at: new Date(Date.now() + 300_000).toISOString() },
        from_address: '1ABC',
        to_address: '1DEF',
        amount: '0.0005',
      },
    });

    const result = await broadcastTransaction(supabase, 'wallet-btc', {
      tx_id: 'tx-btc-001',
      signed_tx: '01000000...',
      chain: 'BTC',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tx_hash).toBe(expectedTxid);
      expect(result.data.chain).toBe('BTC');
      expect(result.data.explorer_url).toContain('blockstream.info');
    }
  });
});

// ──────────────────────────────────────────────
// SOL Send Flow
// ──────────────────────────────────────────────

describe('Send Transaction Flow - SOL', () => {
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  it('should sign a SOL transaction and produce base64 output', async () => {
    const key = await deriveKeyForChain(mnemonic, 'SOL', 0);

    const unsignedTx = {
      type: 'sol' as const,
      feePayer: key.address,
      recentBlockhash: '4nZpVQ3x3bYtYBHAUYGVcz6PL6CqC5e5P5GHNnG7FbXJ',
      instructions: [
        {
          programId: '11111111111111111111111111111111',
          keys: [
            { pubkey: key.address, isSigner: true, isWritable: true },
            {
              pubkey: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
              isSigner: false,
              isWritable: true,
            },
          ],
          data: Buffer.from([2, 0, 0, 0, 64, 66, 15, 0, 0, 0, 0, 0]).toString('base64'),
        },
      ],
    };

    const result = await signTransaction({
      unsigned_tx: unsignedTx,
      privateKey: key.privateKey,
    });

    expect(result.format).toBe('base64');
    expect(result.signed_tx.length).toBeGreaterThan(50);
    // Valid base64
    expect(() => Buffer.from(result.signed_tx, 'base64')).not.toThrow();
  });

  it('should broadcast a SOL transaction via sendTransaction', async () => {
    const expectedSig = 'c'.repeat(88);

    mockFetch((url, opts) => {
      if (opts?.body) {
        const body = JSON.parse(opts.body);
        if (body.method === 'sendTransaction') {
          return {
            ok: true,
            json: async () => ({
              jsonrpc: '2.0',
              id: 1,
              result: expectedSig,
            }),
          };
        }
      }
      return { ok: false, status: 500, text: async () => 'Unknown' };
    });

    const supabase = createMockSupabase({
      selectData: {
        id: 'tx-sol-001',
        wallet_id: 'wallet-sol',
        chain: 'SOL',
        status: 'pending',
        metadata: { expires_at: new Date(Date.now() + 300_000).toISOString() },
        from_address: 'SolAddr1',
        to_address: 'SolAddr2',
        amount: '1.0',
      },
    });

    const result = await broadcastTransaction(supabase, 'wallet-sol', {
      tx_id: 'tx-sol-001',
      signed_tx: Buffer.from('signed-sol-tx').toString('base64'),
      chain: 'SOL',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tx_hash).toBe(expectedSig);
      expect(result.data.chain).toBe('SOL');
      expect(result.data.explorer_url).toContain('explorer.solana.com');
    }
  });
});

// ──────────────────────────────────────────────
// BCH Send Flow
// ──────────────────────────────────────────────

describe('Send Transaction Flow - BCH', () => {
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  it('should sign a BCH transaction with BIP143 sighash', async () => {
    const key = await deriveKeyForChain(mnemonic, 'BCH', 0);

    const unsignedTx = {
      type: 'bch' as const,
      inputs: [
        {
          txid: 'd'.repeat(64),
          vout: 0,
          value: 100000,
          scriptPubKey: '76a91489abcdefabbaabbaabbaabbaabbaabbaabbaabba88ac',
        },
      ],
      outputs: [
        {
          address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
          value: 90000,
        },
        {
          address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
          value: 9000,
        },
      ],
    };

    const result = await signTransaction({
      unsigned_tx: unsignedTx,
      privateKey: key.privateKey,
    });

    expect(result.format).toBe('hex');
    expect(result.signed_tx.length).toBeGreaterThan(100);
    // BCH v2 transactions start with version byte 02000000
    expect(result.signed_tx.startsWith('02000000')).toBe(true);
  });
});

// ──────────────────────────────────────────────
// Polygon Send Flow
// ──────────────────────────────────────────────

describe('Send Transaction Flow - POL', () => {
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  it('should sign a Polygon EIP-1559 transaction', async () => {
    const key = await deriveKeyForChain(mnemonic, 'POL', 0);

    const unsignedTx = {
      type: 'evm' as const,
      chainId: '137',
      nonce: '5',
      maxPriorityFeePerGas: '30000000000',
      maxFeePerGas: '50000000000',
      gasLimit: '21000',
      to: '0x1234567890abcdef1234567890abcdef12345678',
      value: '500000000000000000',
      data: '',
    };

    const result = await signTransaction({
      unsigned_tx: unsignedTx,
      privateKey: key.privateKey,
    });

    expect(result.format).toBe('hex');
    expect(result.signed_tx).toMatch(/^0x02/);
  });

  it('should broadcast a POL transaction via Polygon RPC', async () => {
    const expectedTxHash = '0xpol123';

    mockFetch((url, opts) => {
      if (opts?.body) {
        const body = JSON.parse(opts.body);
        if (body.method === 'eth_sendRawTransaction') {
          return {
            ok: true,
            json: async () => ({
              jsonrpc: '2.0',
              id: 1,
              result: expectedTxHash,
            }),
          };
        }
      }
      return { ok: false, status: 500, text: async () => 'Unknown' };
    });

    const supabase = createMockSupabase({
      selectData: {
        id: 'tx-pol-001',
        wallet_id: 'wallet-pol',
        chain: 'POL',
        status: 'pending',
        metadata: { expires_at: new Date(Date.now() + 300_000).toISOString() },
        from_address: '0xabc',
        to_address: '0xdef',
        amount: '0.5',
      },
    });

    const result = await broadcastTransaction(supabase, 'wallet-pol', {
      tx_id: 'tx-pol-001',
      signed_tx: '0x02f870...',
      chain: 'POL',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tx_hash).toBe(expectedTxHash);
      expect(result.data.chain).toBe('POL');
      expect(result.data.explorer_url).toContain('polygonscan.com');
    }
  });
});

// ──────────────────────────────────────────────
// Broadcast Edge Cases
// ──────────────────────────────────────────────

describe('Broadcast Edge Cases', () => {
  it('should reject expired transactions', async () => {
    const supabase = createMockSupabase({
      selectData: {
        id: 'tx-expired',
        wallet_id: 'wallet-001',
        chain: 'ETH',
        status: 'pending',
        metadata: { expires_at: new Date(Date.now() - 60_000).toISOString() },
        from_address: '0xabc',
        to_address: '0xdef',
        amount: '0.01',
      },
    });

    const result = await broadcastTransaction(supabase, 'wallet-001', {
      tx_id: 'tx-expired',
      signed_tx: '0x02f870...',
      chain: 'ETH',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('TX_EXPIRED');
    }
  });

  it('should reject already-broadcast transactions', async () => {
    const supabase = createMockSupabase({
      selectData: {
        id: 'tx-done',
        wallet_id: 'wallet-001',
        chain: 'ETH',
        status: 'confirming',
        metadata: {},
      },
    });

    const result = await broadcastTransaction(supabase, 'wallet-001', {
      tx_id: 'tx-done',
      signed_tx: '0x02f870...',
      chain: 'ETH',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('TX_ALREADY_PROCESSED');
    }
  });

  it('should reject unsupported chain', async () => {
    const supabase = createMockSupabase();

    const result = await broadcastTransaction(supabase, 'wallet-001', {
      tx_id: 'tx-001',
      signed_tx: '0x...',
      chain: 'FAKE_CHAIN',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('INVALID_CHAIN');
    }
  });

  it('should reject missing signed_tx', async () => {
    const supabase = createMockSupabase();

    const result = await broadcastTransaction(supabase, 'wallet-001', {
      tx_id: 'tx-001',
      signed_tx: '',
      chain: 'ETH',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('MISSING_SIGNED_TX');
    }
  });

  it('should reject when prepared tx not found', async () => {
    const supabase = createMockSupabase({
      selectError: { message: 'not found' },
    });

    const result = await broadcastTransaction(supabase, 'wallet-001', {
      tx_id: 'tx-missing',
      signed_tx: '0x...',
      chain: 'ETH',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('TX_NOT_FOUND');
    }
  });
});

// ──────────────────────────────────────────────
// Retry Logic
// ──────────────────────────────────────────────

describe('Retry Logic', () => {
  it('should retry on transient errors', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('network timeout');
      }
      return 'success';
    });

    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('should not retry on permanent errors (nonce too low)', async () => {
    let attempts = 0;

    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error('nonce too low');
      })
    ).rejects.toThrow('nonce too low');

    expect(attempts).toBe(1);
  });

  it('should not retry on insufficient funds', async () => {
    let attempts = 0;

    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error('insufficient funds for transfer');
      })
    ).rejects.toThrow('insufficient funds');

    expect(attempts).toBe(1);
  });

  it('should not retry on already known transactions', async () => {
    let attempts = 0;

    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error('already known');
      })
    ).rejects.toThrow('already known');

    expect(attempts).toBe(1);
  });

  it('should throw after max retries', async () => {
    let attempts = 0;

    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error('network error');
      }, 2)
    ).rejects.toThrow('network error');

    expect(attempts).toBe(3); // initial + 2 retries
  });
});

// ──────────────────────────────────────────────
// Memory Clearing
// ──────────────────────────────────────────────

describe('Memory Clearing', () => {
  it('should zero out Uint8Array buffers', () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5]);
    clearMemory(buf);
    expect(buf.every((b) => b === 0)).toBe(true);
  });

  it('should handle empty buffers', () => {
    const buf = new Uint8Array(0);
    clearMemory(buf);
    expect(buf.length).toBe(0);
  });
});

// ──────────────────────────────────────────────
// Explorer URLs
// ──────────────────────────────────────────────

describe('Explorer URLs', () => {
  it('should have URLs for all supported chains', () => {
    const expectedChains = ['BTC', 'BCH', 'ETH', 'POL', 'SOL', 'USDC_ETH', 'USDC_POL', 'USDC_SOL'];
    for (const chain of expectedChains) {
      expect(EXPLORER_URLS[chain]).toBeDefined();
      expect(EXPLORER_URLS[chain]).toMatch(/^https:\/\//);
    }
  });
});
