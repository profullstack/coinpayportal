import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('bitcoinjs-lib', () => ({
  crypto: {
    hash256: vi.fn(() => Buffer.alloc(32)),
  },
}));

import { checkBalance } from './balance-checkers';

const originalFetch = global.fetch;
const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('cron balance checkers', () => {
  it('uses eth_call balanceOf for USDT_POL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: '0x0000000000000000000000000000000000000000000000000000000000b71b00', // 12 USDT (6 decimals)
        id: 1,
      }),
    });

    const address = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28';
    const balance = await checkBalance(address, 'USDT_POL');

    expect(balance).toBe(12);
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.method).toBe('eth_call');
    expect(body.params[0].to).toBe('0xc2132D05D31c914a87C6611C10748AEb04B58e8F');
  });

  it('uses eth_call balanceOf for USDC_POL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: '0x00000000000000000000000000000000000000000000000000000000030291a0', // 50.5 USDC (6 decimals)
        id: 1,
      }),
    });

    const address = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28';
    const balance = await checkBalance(address, 'USDC_POL');

    expect(balance).toBe(50.5);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.method).toBe('eth_call');
    expect(body.params[0].to).toBe('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
    expect(body.params[0].data).toMatch(/^0x70a08231/);
  });

  it('keeps native POL checks on eth_getBalance', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: '0xde0b6b3a7640000', // 1 POL
        id: 1,
      }),
    });

    const balance = await checkBalance('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28', 'POL');

    expect(balance).toBe(1);
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.method).toBe('eth_getBalance');
  });

  it('uses getTokenAccountsByOwner for USDT_SOL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: {
          value: [
            {
              account: {
                data: {
                  parsed: {
                    info: {
                      tokenAmount: {
                        amount: '2500000',
                        decimals: 6,
                        uiAmount: 2.5,
                      },
                    },
                  },
                },
              },
            },
          ],
        },
        id: 1,
      }),
    });

    const balance = await checkBalance('FX8QhU1TPUHGs2X8PibbHikd4YvdQMPfVuFd6mqk9qJw', 'USDT_SOL');

    expect(balance).toBe(2.5);
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.method).toBe('getTokenAccountsByOwner');
    expect(body.params[1]).toEqual({ mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' });
    expect(body.params[2]).toEqual({ encoding: 'jsonParsed' });
  });

  it('uses getTokenAccountsByOwner for USDC_SOL instead of native SOL balance', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: {
          value: [
            {
              account: {
                data: {
                  parsed: {
                    info: {
                      tokenAmount: {
                        amount: '50500000',
                        decimals: 6,
                        uiAmount: 50.5,
                      },
                    },
                  },
                },
              },
            },
          ],
        },
        id: 1,
      }),
    });

    const balance = await checkBalance('FX8QhU1TPUHGs2X8PibbHikd4YvdQMPfVuFd6mqk9qJw', 'USDC_SOL');

    expect(balance).toBe(50.5);
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.method).toBe('getTokenAccountsByOwner');
    expect(body.params[1]).toEqual({ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' });
  });
});
