import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ColumnProvider,
  fitNachaField,
  receiverIdFor,
  WEB_RECEIVER_NAME_MAX,
  WEB_RECEIVER_ID_MAX,
} from './column-provider';
import type { BankTransferRequest } from './types';

global.fetch = vi.fn();

const originalEnv = process.env;

const request: BankTransferRequest = {
  direction: 'credit',
  amountMinor: 1_000,
  currency: 'USD',
  counterpartyId: 'cpty_3IymUwe3bJJQYPKmarcSX4RCDNN',
  idempotencyKey: 'key-1',
  description: 'Test Payee',
};

/** A real transfer response, trimmed from a live sandbox call. */
const created = {
  id: 'acht_3IyqxJ2YSkNeQYvKPvkKSgqqDD0',
  status: 'INITIATED',
  type: 'DEBIT',
  is_incoming: false,
  amount: 50_000,
  currency_code: 'USD',
  created_at: '2026-09-07T12:00:00Z',
  settled_at: null,
  return_details: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnv, COLUMN_API_KEY: 'test_key', COLUMN_BANK_ACCOUNT_ID: 'bacc_1' };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('NACHA field limits', () => {
  // Confirmed by the live API rejecting anything longer, with
  // {"maximum_length": "22 characters"}. These are not advisory.
  it('caps a receiver name at the WEB limit', () => {
    expect(WEB_RECEIVER_NAME_MAX).toBe(22);
    expect(fitNachaField('A Very Long Business Name Indeed', 22)).toHaveLength(22);
  });

  it('leaves a short name alone, and trims surrounding space', () => {
    expect(fitNachaField('  Test Payee  ', 22)).toBe('Test Payee');
  });

  it('derives a receiver id that fits, without truncating the counterparty id', () => {
    // Truncating two different counterparty ids to 15 chars can collide, and a
    // collision puts one payee's identifier on another's ACH entry.
    const a = receiverIdFor('cpty_aaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const b = receiverIdFor('cpty_aaaaaaaaaaaaaaaaaaaaaaaaaaab');

    expect(a).toHaveLength(WEB_RECEIVER_ID_MAX);
    expect(b).toHaveLength(WEB_RECEIVER_ID_MAX);
    expect(a).not.toBe(b);
  });

  it('is stable for the same counterparty', () => {
    expect(receiverIdFor('cpty_1')).toBe(receiverIdFor('cpty_1'));
  });
});

describe('ColumnProvider configuration', () => {
  it('needs the originating account as well as the key', () => {
    const provider = new ColumnProvider();
    expect(provider.isConfigured()).toBe(true);

    // A key alone authenticates and then fails every transfer with "Either
    // bank_account_id or account_number_id must be provided".
    delete process.env.COLUMN_BANK_ACCOUNT_ID;
    expect(provider.isConfigured()).toBe(false);
  });
});

describe('ColumnProvider.createTransfer', () => {
  function mockOk(body: unknown) {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    } as Response);
  }

  it('authenticates with Basic and an EMPTY username', async () => {
    mockOk(created);
    await new ColumnProvider().createTransfer(request);

    const headers = vi.mocked(fetch).mock.calls[0][1]!.headers as Record<string, string>;
    // `curl -u ":$KEY"` — not a bearer token, and not the key as username.
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(':test_key').toString('base64')}`);
    expect(headers.Authorization).not.toContain('Bearer');
  });

  it('sends the transfer type in UPPERCASE', async () => {
    mockOk(created);
    await new ColumnProvider().createTransfer(request);

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    // Lowercase is rejected with "invalid ACH transfer type" — note this is the
    // opposite convention to account_type, which must be lowercase.
    expect(body.type).toBe('CREDIT');
    expect(body.entry_class_code).toBe('WEB');
  });

  it('passes the idempotency key as a header', async () => {
    mockOk(created);
    await new ColumnProvider().createTransfer(request);

    const headers = vi.mocked(fetch).mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('key-1');
  });

  it('truncates the receiver name rather than letting Column reject it', async () => {
    mockOk(created);
    await new ColumnProvider().createTransfer({
      ...request,
      description: 'An Extremely Long Payee Name That Will Not Fit',
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.receiver_name.length).toBeLessThanOrEqual(WEB_RECEIVER_NAME_MAX);
    expect(body.receiver_id.length).toBeLessThanOrEqual(WEB_RECEIVER_ID_MAX);
  });

  it('reads direction from type AND is_incoming', async () => {
    mockOk(created);
    const transfer = await new ColumnProvider().createTransfer(request);

    // A DEBIT we originate pulls money in — 'debit' in our vocabulary.
    expect(transfer.direction).toBe('debit');
    expect(transfer.providerStatus).toBe('INITIATED');
    expect(transfer.status).toBe('initiated');
  });

  it('validates before calling out', async () => {
    await expect(
      new ColumnProvider().createTransfer({ ...request, amountMinor: -1 })
    ).rejects.toThrow(/greater than zero/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces Column errors with the field they name', async () => {
    // Their errors identify the offending field, which is the most useful part
    // of the message — losing it makes a schema mistake much harder to find.
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        code: 'transfer_non_sufficient_fund',
        message: 'There is not enough funds in this account to perform this transfer.',
        details: { bank_account_id: 'bacc_1' },
      }),
    } as Response);

    await expect(new ColumnProvider().createTransfer(request)).rejects.toThrow(
      /transfer_non_sufficient_fund.*bacc_1/s
    );
  });
});

describe('ColumnProvider.getTransfer', () => {
  it('returns null for a transfer that does not exist', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response);

    expect(await new ColumnProvider().getTransfer('acht_missing')).toBeNull();
  });

  it('maps a returned transfer, keeping the return code', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...created, status: 'RETURNED', return_details: { return_code: 'R01' } }),
    } as Response);

    const transfer = await new ColumnProvider().getTransfer('acht_1');

    expect(transfer!.status).toBe('returned');
    expect(transfer!.returnCode).toBe('R01');
  });
});
