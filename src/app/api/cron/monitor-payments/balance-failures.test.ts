import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkBalance } from './balance-checkers';

const fetchMock = vi.hoisted(() => {
  vi.stubEnv('CRYPTO_APIS_KEY', '');
  return vi.fn();
});
const address = 'synthetic-address';
const chains = ['BTC', 'BCH', 'DOGE', 'ETH', 'POL', 'BNB', 'USDT', 'USDT_ETH',
  'USDT_POL', 'USDC', 'USDC_ETH', 'USDC_POL', 'USDC_BASE', 'SOL', 'USDT_SOL', 'USDC_SOL', 'XRP', 'ADA'];
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  vi.stubEnv('BLOCKFROST_API_KEY', 'synthetic-test-key');
  vi.stubEnv('CRYPTOAPIS_API_KEY', '');
  vi.stubEnv('TATUM_API_KEY', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe.each(chains)('%s balance uncertainty', chain => {
  it.each(['http', 'rpc', 'malformed', 'timeout', 'invalid-json'])('rejects %s failure instead of returning zero', async failure => {
    fetchMock.mockImplementation(async () => {
      if (failure === 'timeout') throw new DOMException('synthetic timeout', 'TimeoutError');
      if (failure === 'http') return new Response('unavailable', { status: 503 });
      if (failure === 'invalid-json') return new Response('<html>not JSON</html>');
      return Response.json(failure === 'rpc' ? { error: { code: -1, message: 'unavailable' } } : {});
    });
    await expect(checkBalance(address, chain)).rejects.toThrow();
  });
});

describe('validated balances', () => {
  it.each([
    ['BTC', { chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } }, 0],
    ['BTC', { chain_stats: { funded_txo_sum: 250000000, spent_txo_sum: 50000000 } }, 2],
    ['BCH', { confirmed: 0 }, 0],
    ['BCH', { confirmed: 100000000 }, 1],
    ['DOGE', { balance: 0 }, 0],
    ['DOGE', { balance: 150000000 }, 1.5],
    ['ETH', { result: '0x0' }, 0],
    ['ETH', { result: '0xde0b6b3a7640000' }, 1],
    ['USDC_ETH', { result: '0x000000' }, 0],
    ['SOL', { result: { value: 0 } }, 0],
    ['SOL', { result: { value: 1500000000 } }, 1.5],
    ['USDC_SOL', { result: { value: [] } }, 0],
    ['XRP', { result: { account_data: { Balance: '0' } } }, 0],
    ['XRP', { result: { error: 'actNotFound' } }, 0],
    ['ADA', { amount: [{ unit: 'lovelace', quantity: '1000000' }] }, 1],
    ['ADA', { amount: [{ unit: 'lovelace', quantity: '0' }] }, 0],
  ])('%s accepts an explicit valid balance %#', async (chain, body, expected) => {
    fetchMock.mockImplementation(async () => Response.json(body));
    expect(await checkBalance(address, chain as string)).toBe(expected);
  });

  it.each([
    ['BTC', { chain_stats: { funded_txo_sum: '10', spent_txo_sum: 0 } }],
    ['BTC', { chain_stats: { funded_txo_sum: 0, spent_txo_sum: 10 } }],
    ['BCH', { confirmed: -1 }], ['DOGE', { balance: 'not-a-number' }],
    ['ETH', { result: '' }], ['ETH', { result: '-1' }], ['ETH', { result: '1' }],
    ['ETH', { result: '0x' + 'f'.repeat(300) }],
    ['SOL', { result: { value: -1 } }], ['SOL', { result: { value: '0' } }],
    ['SOL', { result: { value: 0.1 } }], ['SOL', { result: { value: Number.MAX_SAFE_INTEGER + 1 } }],
    ['USDC_SOL', { result: { value: [{}] } }],
    ['USDC_SOL', { result: { value: {} } }],
    ['XRP', { result: { account_data: { Balance: '12garbage' } } }],
    ['ADA', { amount: [] }], ['ADA', { amount: [{ unit: 'lovelace', quantity: '-1' }] }],
  ])('%s rejects malformed/negative balances %#', async (chain, body) => {
    fetchMock.mockImplementation(async () => Response.json(body));
    await expect(checkBalance(address, chain as string)).rejects.toThrow();
  });

  it('rejects an unsupported chain without accessing the network', async () => {
    await expect(checkBalance(address, 'UNSUPPORTED')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not interpret missing ADA credentials as zero', async () => {
    vi.stubEnv('BLOCKFROST_API_KEY', '');
    await expect(checkBalance(address, 'ADA')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses a valid BCH fallback after a malformed primary result', async () => {
    vi.stubEnv('CRYPTOAPIS_API_KEY', 'synthetic-test-key');
    fetchMock.mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({ confirmed: 25000000 }));
    expect(await checkBalance(address, 'BCH')).toBe(0.25);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('uses DOGE fallback after a malformed primary result', async () => {
    vi.stubEnv('TATUM_API_KEY', 'synthetic-test-key');
    fetchMock.mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({ balance: '1.25' }));
    expect(await checkBalance(address, 'DOGE')).toBe(1.25);
  });
});
