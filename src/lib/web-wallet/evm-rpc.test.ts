import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  evmRpcCall,
  evmRpcResult,
  evmBaseChain,
  getEvmRpcUrls,
  EvmRpcUnavailableError,
  EVM_FALLBACK_RPCS,
} from './evm-rpc';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/** A successful JSON-RPC response. */
function ok(result: unknown) {
  return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
}

/** A 200 carrying a chain-level rejection. */
function rpcError(message: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32000, message } }),
  };
}

/** A transport failure: the provider itself is broken. */
function httpError(status: number) {
  return { ok: false, status, json: async () => ({}) };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockFetch.mockReset();
  delete process.env.ETHEREUM_RPC_URL;
  delete process.env.POLYGON_RPC_URL;
  delete process.env.BASE_RPC_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('evmBaseChain', () => {
  it('maps ERC-20 variants to the chain they settle on', () => {
    expect(evmBaseChain('ETH')).toBe('ETH');
    expect(evmBaseChain('USDC_ETH')).toBe('ETH');
    expect(evmBaseChain('USDT_ETH')).toBe('ETH');
    expect(evmBaseChain('POL')).toBe('POL');
    expect(evmBaseChain('USDC_POL')).toBe('POL');
  });

  it('routes Base to Base, not Ethereum', () => {
    // These are substring matches, and USDC_BASE contains neither POL nor a
    // literal that should win for ETH. Getting this wrong would not throw — it
    // would silently read a nonce from the wrong chain.
    expect(evmBaseChain('USDC_BASE')).toBe('BASE');
  });
});

describe('getEvmRpcUrls', () => {
  it('puts the configured endpoint first, then the public fallbacks', () => {
    process.env.ETHEREUM_RPC_URL = 'https://mainnet.infura.io/v3/key';
    expect(getEvmRpcUrls('ETH')).toEqual([
      'https://mainnet.infura.io/v3/key',
      ...EVM_FALLBACK_RPCS.ETH,
    ]);
  });

  it('falls back to the public list when nothing is configured', () => {
    expect(getEvmRpcUrls('ETH')).toEqual([...EVM_FALLBACK_RPCS.ETH]);
  });

  it('never tries the same endpoint twice', () => {
    process.env.ETHEREUM_RPC_URL = EVM_FALLBACK_RPCS.ETH[0];
    const urls = getEvmRpcUrls('ETH');
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('reads the right env var per chain', () => {
    process.env.POLYGON_RPC_URL = 'https://polygon.example';
    process.env.BASE_RPC_URL = 'https://base.example';
    expect(getEvmRpcUrls('USDC_POL')[0]).toBe('https://polygon.example');
    expect(getEvmRpcUrls('USDC_BASE')[0]).toBe('https://base.example');
  });
});

describe('evmRpcCall failover', () => {
  it('uses the first provider that answers and stops there', async () => {
    mockFetch.mockResolvedValueOnce(ok('0x1'));

    const body = await evmRpcCall('ETH', 'eth_blockNumber');

    expect(body.result).toBe('0x1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('fails over past a provider returning 403', async () => {
    // This is the Infura outage exactly: the configured endpoint 403s every
    // call because the project requires an API key secret the URL lacks.
    process.env.ETHEREUM_RPC_URL = 'https://mainnet.infura.io/v3/key';
    mockFetch.mockResolvedValueOnce(httpError(403)).mockResolvedValueOnce(ok('0x2a'));

    const body = await evmRpcCall('ETH', 'eth_gasPrice');

    expect(body.result).toBe('0x2a');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toBe(EVM_FALLBACK_RPCS.ETH[0]);
  });

  it('fails over past a network error', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(ok('0x5'));

    const body = await evmRpcCall('ETH', 'eth_gasPrice');
    expect(body.result).toBe('0x5');
  });

  it('fails over past a 200 that is not JSON', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Unexpected token <');
        },
      })
      .mockResolvedValueOnce(ok('0x7'));

    const body = await evmRpcCall('ETH', 'eth_gasPrice');
    expect(body.result).toBe('0x7');
  });

  it('does NOT fail over on a chain-level rejection', async () => {
    // A JSON-RPC error in a 200 is the chain's verdict, not a broken provider.
    // Asking a second provider would repeat the rejection, and for a send it
    // would mean resubmitting.
    mockFetch.mockResolvedValueOnce(rpcError('nonce too low'));

    const body = await evmRpcCall('ETH', 'eth_sendRawTransaction', ['0xdead']);

    expect(body.error?.message).toBe('nonce too low');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws once every provider has failed, naming each one', async () => {
    process.env.ETHEREUM_RPC_URL = 'https://mainnet.infura.io/v3/supersecretkey';
    mockFetch.mockResolvedValue(httpError(403));

    await expect(evmRpcCall('ETH', 'eth_gasPrice')).rejects.toThrow(EvmRpcUnavailableError);

    // Every configured endpoint plus every fallback was tried.
    expect(mockFetch).toHaveBeenCalledTimes(1 + EVM_FALLBACK_RPCS.ETH.length);
  });

  it('reports hosts and statuses but never the API key in the URL', async () => {
    process.env.ETHEREUM_RPC_URL = 'https://mainnet.infura.io/v3/supersecretkey';
    mockFetch.mockResolvedValue(httpError(403));

    const err = await evmRpcCall('ETH', 'eth_gasPrice').catch((e) => e);

    expect(err.message).toContain('mainnet.infura.io');
    expect(err.message).toContain('403');
    // The project id lives in the URL path and these messages reach logs and
    // API error bodies, so only the host may appear.
    expect(err.message).not.toContain('supersecretkey');
  });
});

describe('evmRpcResult', () => {
  it('returns the bare result', async () => {
    mockFetch.mockResolvedValueOnce(ok('0x9'));
    await expect(evmRpcResult('ETH', 'eth_blockNumber')).resolves.toBe('0x9');
  });

  it('raises a chain-level rejection instead of returning it', async () => {
    mockFetch.mockResolvedValueOnce(rpcError('execution reverted'));
    await expect(evmRpcResult('ETH', 'eth_call')).rejects.toThrow('execution reverted');
  });
});
