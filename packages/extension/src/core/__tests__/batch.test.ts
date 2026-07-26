/**
 * Batch runner behaviour: partial success, per-account serialization,
 * cross-account concurrency, and retry policy.
 *
 * The API is faked so these assert orchestration only — signing itself is
 * covered by signing.diff.test.ts and private-keys.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  runBatchPayments,
  summarizeBatch,
  isTransientChainError,
  type BatchPaymentRequest,
} from '../batch.js';
import type { CoinPayApi } from '../api.js';
import { seedFromMnemonic } from '../derivation.js';
import { derivePrivateKey } from '../private-keys.js';
import { signTransaction } from '../signing.js';

const SEED = seedFromMnemonic(
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
);
const AUTH_KEY = new Uint8Array(32).fill(9);

/** Sender per chain, each at its own index — the shape the runner takes. */
const ADDRESSES = {
  BTC: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
  BCH: 'bitcoincash:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy',
  ETH: '0x1111111111111111111111111111111111111111',
  POL: '0x1111111111111111111111111111111111111111',
  SOL: '11111111111111111111111111111112',
};

/** Sender per chain, each at its own derivation index. */
const senderMap = (indexes: Record<string, number> = {}) =>
  Object.fromEntries(
    Object.entries(ADDRESSES).map(([chain, address]) => [
      chain,
      { address, index: indexes[chain] ?? 0 },
    ]),
  );
const SENDERS = senderMap();

interface FakeApiOptions {
  /** Per-request-id list of errors to throw before succeeding. */
  failures?: Record<string, string[]>;
  /** Records call order across the whole batch. */
  trace?: string[];
}

function fakeApi(options: FakeApiOptions = {}): CoinPayApi {
  const { failures = {}, trace = [] } = options;
  const attempts = new Map<string, number>();
  let counter = 0;

  // The runner passes to_address through untouched, so we key fakes off it.
  const idFor = (to: string): string => to;

  return {
    async prepareTx(_walletId: unknown, _key: unknown, input: any) {
      const id = idFor(input.to_address);
      const attempt = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, attempt);
      trace.push(`prepare:${id}:${attempt}`);

      const queued = failures[id];
      if (queued && queued.length >= attempt) {
        throw new Error(queued[attempt - 1]);
      }

      return {
        tx_id: `tx-${++counter}`,
        chain: input.chain,
        from_address: input.from_address,
        to_address: input.to_address,
        amount: input.amount,
        fee: {},
        expires_at: new Date(Date.now() + 300_000).toISOString(),
        // Minimal EVM shape; signing is stubbed out below.
        unsigned_tx: {
          type: 'evm',
          chainId: 1,
          nonce: 0,
          to: '0x2222222222222222222222222222222222222222',
          value: '0x1',
          gasLimit: 21000,
          maxFeePerGas: '1',
          maxPriorityFeePerGas: '1',
        },
      } as any;
    },
    async broadcast(_walletId: unknown, _key: unknown, input: any) {
      trace.push(`broadcast:${input.tx_id}`);
      return {
        tx_hash: `hash-${input.tx_id}`,
        chain: input.chain,
        status: 'pending' as const,
        explorer_url: `https://explorer/${input.tx_id}`,
      };
    },
  } as unknown as CoinPayApi;
}

// Signing is exercised elsewhere; here it must not depend on real tx bytes.
vi.mock('../signing.js', () => ({
  signTransaction: vi.fn(async () => ({ signed_tx: '0xdeadbeef', format: 'hex' as const })),
}));

function request(overrides: Partial<BatchPaymentRequest> & { id: string }): BatchPaymentRequest {
  return {
    chain: 'ETH',
    to: overrides.id,
    amount: '0.01',
    ...overrides,
  };
}

const noSleep = async (): Promise<void> => {};

function run(requests: BatchPaymentRequest[], api: CoinPayApi, extra: Record<string, unknown> = {}) {
  return runBatchPayments(requests, {
    api,
    walletId: 'wallet-1',
    seed: SEED,
    authKey: AUTH_KEY,
    senders: SENDERS,
    sleep: noSleep,
    ...extra,
  } as any);
}

/**
 * The account paying and the key signing must be the same one.
 *
 * This was broken in 0.4.0 and earlier: the from-address came from the ACTIVE
 * account while the signing key was hardcoded to index 0, so every send from a
 * second account signed with the first account's key and could not be valid.
 */
describe('signing key follows the paying account', () => {
  function keyHex(chain: 'ETH' | 'BTC', index: number): string {
    const key = derivePrivateKey(SEED, chain, index);
    return Array.from(key, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  it('signs with the key derived at that chain own index', async () => {
    vi.mocked(signTransaction).mockClear();
    await run([request({ id: 'a' })], fakeApi(), { senders: senderMap({ ETH: 2 }) });

    const { privateKey } = vi.mocked(signTransaction).mock.calls[0]![0] as { privateKey: string };
    expect(privateKey).toBe(keyHex('ETH', 2));
    expect(privateKey).not.toBe(keyHex('ETH', 0));
  });

  it('still signs with index 0 for a chain first address', async () => {
    vi.mocked(signTransaction).mockClear();
    await run([request({ id: 'a' })], fakeApi(), { senders: senderMap() });

    const { privateKey } = vi.mocked(signTransaction).mock.calls[0]![0] as { privateKey: string };
    expect(privateKey).toBe(keyHex('ETH', 0));
  });

  it('applies the index per signing chain, not just EVM', async () => {
    vi.mocked(signTransaction).mockClear();
    await run([request({ id: 'a', chain: 'BTC' })], fakeApi(), { senders: senderMap({ BTC: 3 }) });

    const { privateKey } = vi.mocked(signTransaction).mock.calls[0]![0] as { privateKey: string };
    expect(privateKey).toBe(keyHex('BTC', 3));
  });

  it('lets each chain sit on a different index', async () => {
    // BTC on 2 while ETH is on 0 — the web wallet advances chains separately,
    // and a single shared index would sign one with the other chain's key.
    vi.mocked(signTransaction).mockClear();
    const senders = senderMap({ BTC: 2 });
    await run([request({ id: 'a', chain: 'BTC' }), request({ id: 'b', chain: 'ETH' })], fakeApi(), {
      senders,
    });

    const keys = vi.mocked(signTransaction).mock.calls.map(
      ([arg]) => (arg as { privateKey: string }).privateKey,
    );
    expect(keys).toContain(keyHex('BTC', 2));
    expect(keys).toContain(keyHex('ETH', 0));
  });
});

describe('runBatchPayments', () => {
  it('pays every item and returns results in the requested order', async () => {
    const requests = [request({ id: 'a' }), request({ id: 'b' }), request({ id: 'c' })];
    const results = await run(requests, fakeApi());

    expect(results.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(results.every((r) => r.status === 'sent')).toBe(true);
    expect(results[0]!.txHash).toMatch(/^hash-tx-/);
    expect(results[0]!.explorerUrl).toContain('https://explorer/');
  });

  it('keeps paying the rest when one item fails (partial success)', async () => {
    const requests = [request({ id: 'a' }), request({ id: 'b' }), request({ id: 'c' })];
    const results = await run(
      requests,
      fakeApi({ failures: { b: ['Insufficient funds', 'Insufficient funds', 'Insufficient funds'] } }),
    );

    expect(results.map((r) => r.status)).toEqual(['sent', 'failed', 'sent']);
    expect(results[1]!.error).toMatch(/Insufficient funds/);
  });

  it('does not retry terminal errors', async () => {
    const trace: string[] = [];
    await run([request({ id: 'a' })], fakeApi({ failures: { a: ['Insufficient funds'] }, trace }));

    expect(trace.filter((t) => t.startsWith('prepare:a'))).toEqual(['prepare:a:1']);
  });

  it('retries transient chain-state errors and succeeds', async () => {
    const trace: string[] = [];
    const results = await run(
      [request({ id: 'a' })],
      fakeApi({ failures: { a: ['nonce too low'] }, trace }),
    );

    expect(results[0]!.status).toBe('sent');
    expect(trace.filter((t) => t.startsWith('prepare:a'))).toEqual(['prepare:a:1', 'prepare:a:2']);
  });

  it('gives up after maxAttempts on a persistently transient error', async () => {
    const results = await run(
      [request({ id: 'a' })],
      fakeApi({ failures: { a: ['nonce too low', 'nonce too low', 'nonce too low'] } }),
    );

    expect(results[0]!.status).toBe('failed');
    expect(results[0]!.error).toMatch(/nonce too low/);
  });

  it('serializes same-account payments: each broadcast precedes the next prepare', async () => {
    const trace: string[] = [];
    await run(
      [request({ id: 'a' }), request({ id: 'b' }), request({ id: 'c' })],
      fakeApi({ trace }),
    );

    expect(trace).toEqual([
      'prepare:a:1',
      'broadcast:tx-1',
      'prepare:b:1',
      'broadcast:tx-2',
      'prepare:c:1',
      'broadcast:tx-3',
    ]);
  });

  it('runs different accounts concurrently', async () => {
    const trace: string[] = [];
    await run(
      [
        request({ id: 'eth-1', chain: 'ETH' }),
        request({ id: 'sol-1', chain: 'SOL' }),
        request({ id: 'eth-2', chain: 'ETH' }),
      ],
      fakeApi({ trace }),
    );

    // Solana starts before the second Ethereum item — it is not stuck behind
    // the ETH queue.
    expect(trace.indexOf('prepare:sol-1:1')).toBeLessThan(trace.indexOf('prepare:eth-2:1'));
  });

  it('treats USDC_ETH as sharing the ETH account queue', async () => {
    const trace: string[] = [];
    await run(
      [request({ id: 'a', chain: 'ETH' }), request({ id: 'b', chain: 'USDC_ETH' })],
      fakeApi({ trace }),
    );

    // Same account ⇒ strictly serialized, or they would collide on one nonce.
    expect(trace).toEqual(['prepare:a:1', 'broadcast:tx-1', 'prepare:b:1', 'broadcast:tx-2']);
  });

  it('skips remaining payments once aborted, without marking them sent', async () => {
    const controller = new AbortController();
    const requests = [request({ id: 'a' }), request({ id: 'b' }), request({ id: 'c' })];
    const api = fakeApi();
    const originalBroadcast = (api as any).broadcast;
    (api as any).broadcast = async (...args: unknown[]) => {
      controller.abort(); // cancel right after the first send goes out
      return originalBroadcast(...args);
    };

    const results = await run(requests, api, { signal: controller.signal });

    expect(results[0]!.status).toBe('sent');
    expect(results[1]!.status).toBe('skipped');
    expect(results[2]!.status).toBe('skipped');
  });

  it('fails an item whose chain has no address, without touching the others', async () => {
    const results = await runBatchPayments([request({ id: 'a', chain: 'BTC' }), request({ id: 'b' })], {
      api: fakeApi(),
      walletId: 'wallet-1',
      seed: SEED,
      authKey: AUTH_KEY,
      senders: { ETH: { address: ADDRESSES.ETH, index: 0 } }, // no BTC address
      sleep: noSleep,
    } as any);

    expect(results[0]!.status).toBe('failed');
    expect(results[0]!.error).toMatch(/no BTC address/);
    expect(results[1]!.status).toBe('sent');
  });

  it('reports progress ending in a terminal stage per item', async () => {
    const events: string[] = [];
    await run([request({ id: 'a' }), request({ id: 'b' })], fakeApi(), {
      onProgress: (p: any) => events.push(`${p.id}:${p.stage}`),
    });

    expect(events).toContain('a:preparing');
    expect(events).toContain('a:broadcasting');
    expect(events).toContain('a:sent');
    expect(events).toContain('b:sent');
  });

  it('counts completed items monotonically up to the total', async () => {
    const completions: number[] = [];
    await run([request({ id: 'a' }), request({ id: 'b' })], fakeApi(), {
      onProgress: (p: any) => {
        if (p.stage === 'sent' || p.stage === 'failed') completions.push(p.completed);
        expect(p.total).toBe(2);
      },
    });

    expect(completions).toEqual([1, 2]);
  });
});

describe('isTransientChainError', () => {
  it('flags chain-state races as retryable', () => {
    expect(isTransientChainError('nonce too low')).toBe(true);
    expect(isTransientChainError('bad-txns-inputs-missingorspent')).toBe(true);
    expect(isTransientChainError('Blockhash not found')).toBe(true);
    expect(isTransientChainError('replacement transaction underpriced')).toBe(true);
  });

  it('does not flag errors that retrying cannot fix', () => {
    expect(isTransientChainError('Insufficient funds: need 5000 sats')).toBe(false);
    expect(isTransientChainError('Invalid recipient address')).toBe(false);
    expect(isTransientChainError('Wallet is locked')).toBe(false);
  });
});

describe('summarizeBatch', () => {
  it('totals amount and USD per chain', () => {
    const summary = summarizeBatch([
      request({ id: 'a', chain: 'USDC_SOL', amount: '10.5', amountUsd: 10.5 }),
      request({ id: 'b', chain: 'USDC_SOL', amount: '4.5', amountUsd: 4.5 }),
      request({ id: 'c', chain: 'BTC', amount: '0.001', amountUsd: 60 }),
    ]);

    expect(summary).toEqual([
      { chain: 'USDC_SOL', count: 2, total: '15', totalUsd: 15 },
      { chain: 'BTC', count: 1, total: '0.001', totalUsd: 60 },
    ]);
  });

  it('keeps satoshi-level precision', () => {
    const summary = summarizeBatch([
      request({ id: 'a', chain: 'BTC', amount: '0.00000001' }),
      request({ id: 'b', chain: 'BTC', amount: '0.00000002' }),
    ]);

    expect(summary[0]!.total).toBe('0.00000003');
  });
});
