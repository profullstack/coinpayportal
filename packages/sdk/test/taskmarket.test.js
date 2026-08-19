import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TASKMARKET_API_URL,
  TaskMarketError,
  PaymentNotAuthorizedError,
  discoverTasks,
  getTask,
  listSubmissions,
  createTask,
  withinSpendingLimit,
} from '../src/taskmarket.js';

const PAY_TO = '0x' + '11'.repeat(20);
const EIP712_EXTRA = {
  eip712: {
    domain: { name: 'Token', version: '1', chainId: 8453 },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
  },
};
const ACCEPT = {
  scheme: 'exact',
  network: 'eip155:8453',
  amount: '4500000',
  asset: 'USDC',
  payTo: PAY_TO,
  maxTimeoutSeconds: 300,
  extra: EIP712_EXTRA,
};
const REQUIREMENTS = { resource: `${TASKMARKET_API_URL}/api/tasks`, accepts: [ACCEPT] };

function signerStub({ address = PAY_TO } = {}) {
  return {
    address,
    signTypedData: vi.fn(async ({ message }) => '0x' + 'ab'.repeat(65)),
  };
}

function jsonResponse(status, payload, ok = status < 400) {
  return {
    ok,
    status,
    json: vi.fn(async () => payload),
  };
}

describe('taskmarket module', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes the TaskMarket API base URL', () => {
    expect(TASKMARKET_API_URL).toMatch(/^https?:\/\//);
  });

  it('discoverTasks parses the {data:{tasks}} envelope and query params', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { data: { tasks: [{ id: '0xabc', status: 'open' }] } })
    );
    const tasks = await discoverTasks({ status: 'open', limit: 25, mode: 'bounty' });
    expect(tasks).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/tasks?');
    expect(url).toContain('status=open');
    expect(url).toContain('limit=25');
    expect(url).toContain('mode=bounty');
  });

  it('discoverTasks surfaces HTTP errors as TaskMarketError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    await expect(discoverTasks()).rejects.toMatchObject({ name: 'TaskMarketError', status: 500 });
  });

  it('getTask unwraps a bare task payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: '0xabc', phase: 'active' }));
    const task = await getTask('0xabc');
    expect(task.phase).toBe('active');
    expect(fetchMock.mock.calls[0][0]).toContain('/api/tasks/0xabc');
  });

  it('listSubmissions returns the raw array', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [{ id: 's1', workerAddress: '0x1' }]));
    const subs = await listSubmissions('0xabc');
    expect(subs).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/submissions');
  });

  it('createTask posts with an idempotency key and returns taskId on direct 2xx', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { taskId: '0xcreated' }));
    const out = await createTask(
      { title: 'T', description: 'D', reward: 1000000 },
      { signer: signerStub() }
    );
    expect(out.taskId).toBe('0xcreated');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${TASKMARKET_API_URL}/api/tasks`);
    expect(init.method).toBe('POST');
    expect(init.headers['X-Taskmarket-Idempotency-Key']).toBeTruthy();
    expect(init.body).toContain('"reward":1000000');
  });

  it('createTask follows the 402 flow with spending limit and explicit authorize', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(402, REQUIREMENTS))
      .mockResolvedValueOnce(jsonResponse(200, { taskId: '0xpaid' }));
    const authorize = vi.fn(async () => true);
    const signer = signerStub();

    const out = await createTask(
      { title: 'T', description: 'D', reward: 4500000 },
      { signer, spendingLimitUsd: 10, authorize, idempotencyKey: 'k-1' }
    );

    expect(out.taskId).toBe('0xpaid');
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ asset: 'USDC', amount: '4500000', payTo: PAY_TO })
    );
    expect(signer.signTypedData).toHaveBeenCalledTimes(1);
    const signed = signer.signTypedData.mock.calls[0][0];
    expect(signed.message).toMatchObject({ from: PAY_TO, to: PAY_TO, value: '4500000' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init2] = fetchMock.mock.calls[1];
    expect(init2.headers['X-Taskmarket-Idempotency-Key']).toBe('k-1');
    const header = init2.headers['PAYMENT-SIGNATURE'];
    expect(header).toBeTruthy();
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
    expect(decoded.x402Version).toBe(2);
    expect(decoded.resource).toBe(REQUIREMENTS.resource);
    expect(decoded.accepted).toMatchObject({ network: 'eip155:8453', asset: 'USDC' });
    expect(decoded.payload.signature).toBe('0x' + 'ab'.repeat(65));
    expect(decoded.payload.authorization.value).toBe('4500000');
  });

  it('createTask refuses when the quoted amount exceeds spendingLimitUsd', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(402, REQUIREMENTS));
    await expect(
      createTask({ title: 'T', description: 'D', reward: 4500000 }, { signer: signerStub(), spendingLimitUsd: 1 })
    ).rejects.toMatchObject({ name: 'TaskMarketError', status: 402 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('createTask refuses when authorize() declines', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(402, REQUIREMENTS));
    await expect(
      createTask(
        { title: 'T', description: 'D', reward: 4500000 },
        { signer: signerStub(), authorize: async () => false }
      )
    ).rejects.toBeInstanceOf(PaymentNotAuthorizedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(signerStub().signTypedData).not.toHaveBeenCalled();
  });

  it('createTask refuses to pay blind when the asset decimals are unknown', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(402, { resource: 'r', accepts: [{ ...ACCEPT, asset: 'MATICX' }] })
    );
    await expect(
      createTask({ title: 'T', description: 'D', reward: 4500000 }, { signer: signerStub(), spendingLimitUsd: 10 })
    ).rejects.toMatchObject({ name: 'TaskMarketError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('withinSpendingLimit compares in base units', () => {
    expect(withinSpendingLimit({ amount: '5000000', asset: 'USDC' }, 5)).toBe(true);
    expect(withinSpendingLimit({ amount: '5000001', asset: 'USDC' }, 5)).toBe(false);
    expect(withinSpendingLimit({ amount: '1000000000000000000', asset: 'ETH' }, 1)).toBe(true);
    expect(withinSpendingLimit(undefined, undefined)).toBe(true);
  });

  it('createTask errors clearly when the 402 carries no payment methods', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(402, { resource: 'r', accepts: [] }));
    await expect(
      createTask({ title: 'T', description: 'D', reward: 4500000 }, { signer: signerStub() })
    ).rejects.toMatchObject({ name: 'TaskMarketError', status: 402 });
  });

  it('createTask never auto-retries after an unknown payment settlement', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(402, REQUIREMENTS))
      .mockResolvedValueOnce(jsonResponse(500, { error: 'timeout' }));
    await expect(
      createTask({ title: 'T', description: 'D', reward: 4500000 }, { signer: signerStub(), authorize: async () => true })
    ).rejects.toMatchObject({ name: 'TaskMarketError', status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(2); // exactly one payment attempt
  });
});
