import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  coinsToSatoshis,
  getSoChainBalance,
  getSoChainTransactions,
  getSoChainUnspentOutputs,
  satoshisToCoins,
  satoshisToNumber,
  signedCoinsToSatoshis,
} from './sochain';
import { DogecoinProvider } from './providers';
import { checkBalance } from '@/lib/payments/monitor-balance';

const ADDRESS = 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L';
const TXID = '484c94145e97c0b2dd96912c1f056c9e05c8d358ab96ea429c51039d75d0d3c4';

const ok = (data: unknown) => Response.json({ status: 'success', data });

function utxo(i: number, block: number | null = 2605714) {
  return {
    hash: i.toString(16).padStart(64, '0'),
    index: 0,
    script: '76a914830a7420e63d76244ff7cbd1c248e94c1446325988ac',
    address: ADDRESS,
    value: '1.00000001',
    block,
    tx_hex: '0100',
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('SOCHAIN_API_KEY', '');
  vi.stubEnv('TATUM_API_KEY', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function calledUrl(n = 0): string {
  return fetchMock.mock.calls[n][0] as string;
}

function calledHeaders(n = 0): Record<string, string> {
  return (fetchMock.mock.calls[n][1] as RequestInit).headers as Record<string, string>;
}

describe('SoChain amounts', () => {
  it('converts decimal strings to exact satoshis', () => {
    expect(coinsToSatoshis('0.00012345')).toBe(BigInt(12345));
    expect(coinsToSatoshis('62222.06467666')).toBe(BigInt('6222206467666'));
    expect(coinsToSatoshis('0.3')).toBe(BigInt(30000000));
    // 0.1 + 0.2 style float error cannot occur.
    expect(coinsToSatoshis('0.30000001')).toBe(BigInt(30000001));
    expect(coinsToSatoshis('92233720368.54775807')).toBe(BigInt('9223372036854775807'));
  });

  it('rejects anything that is not a plain decimal of at most 8 places', () => {
    for (const bad of ['', '1e8', '-1', '1.123456789', 'abc', ' 1', '1.', 1, null, undefined]) {
      expect(() => coinsToSatoshis(bad)).toThrow();
    }
  });

  it('accepts a sign only where one is allowed', () => {
    expect(signedCoinsToSatoshis('-0.10000000')).toBe(BigInt(-10000000));
    expect(signedCoinsToSatoshis('0.1')).toBe(BigInt(10000000));
  });

  it('formats satoshis back to coins', () => {
    expect(satoshisToCoins(BigInt(150000000))).toBe('1.5');
    expect(satoshisToCoins(BigInt(0))).toBe('0');
    expect(satoshisToCoins(BigInt(1))).toBe('0.00000001');
    expect(satoshisToCoins(BigInt(-10000000))).toBe('-0.1');
    expect(satoshisToNumber(BigInt(30000001))).toBe(0.30000001);
  });
});

describe('SoChain requests', () => {
  it('works without a key and sends no API-KEY header', async () => {
    fetchMock.mockResolvedValueOnce(ok({ confirmed: '1.00000000', unconfirmed: '0.00000000' }));
    const balance = await getSoChainBalance('DOGE', ADDRESS);
    expect(balance).toEqual({ confirmed: BigInt(100000000), unconfirmed: BigInt(0) });
    expect(calledUrl()).toBe(`https://sochain.com/api/v3/balance/DOGE/${ADDRESS}`);
    expect(calledHeaders()).not.toHaveProperty('API-KEY');
  });

  it('sends SOCHAIN_API_KEY as the API-KEY header', async () => {
    vi.stubEnv('SOCHAIN_API_KEY', 'synthetic-key');
    fetchMock.mockResolvedValueOnce(ok({ confirmed: '0.00000000', unconfirmed: '0.00000000' }));
    await getSoChainBalance('DOGE', ADDRESS);
    expect(calledHeaders()['API-KEY']).toBe('synthetic-key');
  });

  it('throws on a fail body, with the error message', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ status: 'fail', data: { error_message: 'Invalid address?' } }, { status: 404 })
    );
    await expect(getSoChainBalance('DOGE', 'nope')).rejects.toThrow('Invalid address?');
  });

  it('throws on a 429 and reports Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('slow down', { status: 429, headers: { 'Retry-After': '30' } })
    );
    await expect(getSoChainBalance('DOGE', ADDRESS)).rejects.toThrow('retry after 30s');
  });

  it('reads an address page of transactions with signed balance changes', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        transactions: [
          { hash: 'aa', value_sent: '0', value_received: '0', balance_change: '-2.5', time: null, block: null },
          { hash: 'bb', value_sent: '0', value_received: '9.51727163', balance_change: '9.51727163', time: 1790104221, block: 6385234 },
        ],
      })
    );
    const txs = await getSoChainTransactions('DOGE', ADDRESS, 2);
    expect(calledUrl()).toBe(`https://sochain.com/api/v3/transactions/DOGE/${ADDRESS}/2`);
    expect(txs).toEqual([
      { hash: 'aa', balanceChange: BigInt(-250000000), block: null, time: null },
      { hash: 'bb', balanceChange: BigInt(951727163), block: 6385234, time: 1790104221 },
    ]);
  });

  it('follows unspent_outputs pages until a short page', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ outputs: Array.from({ length: 10 }, (_, i) => utxo(i)) }))
      .mockResolvedValueOnce(ok({ outputs: [utxo(10)] }));
    const outputs = await getSoChainUnspentOutputs('DOGE', ADDRESS);
    expect(outputs).toHaveLength(11);
    expect(outputs[0].value).toBe(BigInt(100000001));
    expect(calledUrl(1)).toBe(`https://sochain.com/api/v3/unspent_outputs/DOGE/${ADDRESS}/2`);
  });
});

describe('DogecoinProvider (SoChain)', () => {
  it('returns the confirmed balance as an exact decimal string', async () => {
    fetchMock.mockResolvedValueOnce(ok({ confirmed: '62222.06467666', unconfirmed: '5.00000000' }));
    expect(await new DogecoinProvider('').getBalance(ADDRESS)).toBe('62222.06467666');
  });

  it('maps a mined transaction', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        hash: TXID,
        confirmations: 35607,
        block_height: 6385234,
        time: 1790104221,
        fee: '0.45600000',
        inputs: [{ address: 'DGUzATWpGdehtujWNyM464LB9Zx7Ch1Z67', value: '70.36607481' }],
        outputs: [
          { address: ADDRESS, value: '9.51727163' },
          { address: 'DGUzATWpGdehtujWNyM464LB9Zx7Ch1Z67', value: '60.39280318' },
        ],
      })
    );
    const tx = await new DogecoinProvider('').getTransaction(TXID);
    expect(tx).toEqual({
      hash: TXID,
      from: 'DGUzATWpGdehtujWNyM464LB9Zx7Ch1Z67',
      to: ADDRESS,
      value: '9.51727163',
      confirmations: 35607,
      blockNumber: 6385234,
      timestamp: 1790104221,
      status: 'confirmed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['pending', 'pending'],
    ['replaced', 'failed'],
    ['dropped', 'failed'],
  ])('reports an unconfirmed transaction whose status is %s as %s', async (state, expected) => {
    fetchMock
      .mockResolvedValueOnce(
        ok({ hash: TXID, confirmations: 0, block_height: null, time: 1790104221, fee: '0.01', inputs: [], outputs: [] })
      )
      .mockResolvedValueOnce(ok({ network: 'DOGE', hash: TXID, status: state, block_height: null, confirmations: 0 }));
    const tx = await new DogecoinProvider('').getTransaction(TXID);
    expect(calledUrl(1)).toBe(`https://sochain.com/api/v3/transaction_status/DOGE/${TXID}`);
    expect(tx.status).toBe(expected);
  });

  it('lists only confirmed UTXOs, in satoshis', async () => {
    fetchMock.mockResolvedValueOnce(ok({ outputs: [utxo(1), utxo(2, null)] }));
    const provider = new DogecoinProvider('') as unknown as {
      getUTXOs(address: string): Promise<Array<{ txid: string; value: number; txHex?: string }>>;
    };
    const utxos = await provider.getUTXOs(ADDRESS);
    expect(utxos).toHaveLength(1);
    expect(utxos[0]).toMatchObject({ vout: 0, value: 100000001, txHex: '0100' });
  });
});

describe('DOGE payment monitor (SoChain)', () => {
  it('reports the confirmed balance and the newest confirmed incoming transaction', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ confirmed: '12.50000000', unconfirmed: '1.00000000' }))
      .mockResolvedValueOnce(
        ok({
          transactions: [
            { hash: 'unconfirmed', balance_change: '1.00000000', block: null, time: null },
            { hash: 'spend', balance_change: '-0.50000000', block: 6385235, time: 1790104300 },
            { hash: 'funding', balance_change: '13.00000000', block: 6385234, time: 1790104221 },
          ],
        })
      );
    expect(await checkBalance(ADDRESS, 'DOGE')).toEqual({ balance: 12.5, txHash: 'funding' });
  });

  it('does not look up transactions for an empty address', async () => {
    fetchMock.mockResolvedValueOnce(ok({ confirmed: '0.00000000', unconfirmed: '0.00000000' }));
    expect(await checkBalance(ADDRESS, 'DOGE')).toEqual({ balance: 0, txHash: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to Tatum when SoChain fails', async () => {
    vi.stubEnv('TATUM_API_KEY', 'synthetic-tatum');
    fetchMock
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ balance: '3.25' }));
    expect(await checkBalance(ADDRESS, 'DOGE')).toEqual({ balance: 3.25 });
    expect(calledUrl(1)).toContain('api.tatum.io/v3/dogecoin/address/balance');
  });

  it('reports an error, not zero, when every source fails', async () => {
    fetchMock.mockResolvedValue(new Response('unavailable', { status: 503 }));
    const result = await checkBalance(ADDRESS, 'DOGE');
    expect(result.balance).toBe(0);
    expect(result.error).toBeTruthy();
  });
});
