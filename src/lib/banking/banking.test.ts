import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BankTransferRequest,
  TERMINAL_STATUSES,
  canStillBeReturned,
  validateTransferRequest,
} from './types';
import { StubBankProvider } from './stub';
import {
  normalizeColumnStatus,
  toColumnType,
  fromColumnType,
  entryClassCode,
} from './column';
import {
  getActiveBankProvider,
  bankTransfersEnabled,
  resetBankProviderRegistry,
} from './providers';

const originalEnv = process.env;

const request: BankTransferRequest = {
  direction: 'debit',
  amountMinor: 5_000,
  currency: 'USD',
  counterpartyId: 'cpty_1',
  idempotencyKey: 'key-1',
};

beforeEach(() => {
  process.env = { ...originalEnv };
  resetBankProviderRegistry();
});

afterEach(() => {
  process.env = originalEnv;
});

describe('validateTransferRequest', () => {
  it('accepts a well-formed request', () => {
    expect(validateTransferRequest(request)).toBeNull();
  });

  it('refuses an amount that is not whole minor units', () => {
    // Money never travels through a float here: a rounding error is a wrong
    // amount taken from somebody's bank account.
    expect(validateTransferRequest({ ...request, amountMinor: 12.5 })).toMatch(/integer/);
  });

  it('refuses a zero or negative amount', () => {
    expect(validateTransferRequest({ ...request, amountMinor: 0 })).toMatch(/greater than zero/);
    expect(validateTransferRequest({ ...request, amountMinor: -100 })).toMatch(/greater than zero/);
  });

  it('refuses a currency that is not ISO 4217', () => {
    for (const currency of ['usd', 'US', 'DOLLAR', '']) {
      expect(validateTransferRequest({ ...request, currency })).toMatch(/ISO 4217/);
    }
  });

  it('requires an idempotency key rather than inventing one', () => {
    // A generated key would differ on the retry, which is the exact case it
    // exists to prevent.
    expect(validateTransferRequest({ ...request, idempotencyKey: '' })).toMatch(/idempotencyKey/);
  });

  it('requires a counterparty', () => {
    expect(validateTransferRequest({ ...request, counterpartyId: '' })).toMatch(/counterpartyId/);
  });
});

describe('return exposure', () => {
  it('treats completed as still returnable', () => {
    // An administrative return can arrive up to 60 days out, long after any
    // hold. "Completed" is a decision to stop waiting, not a guarantee.
    expect(canStillBeReturned('completed')).toBe(true);
    expect(canStillBeReturned('settled')).toBe(true);
  });

  it('does not expose statuses that never moved money', () => {
    expect(canStillBeReturned('initiated')).toBe(false);
    expect(canStillBeReturned('pending')).toBe(false);
    expect(canStillBeReturned('failed')).toBe(false);
    expect(canStillBeReturned('canceled')).toBe(false);
    expect(canStillBeReturned('returned')).toBe(false);
  });

  it('counts returned among the terminal statuses', () => {
    expect(TERMINAL_STATUSES).toContain('returned');
    expect(TERMINAL_STATUSES).not.toContain('settled');
  });
});

describe('Column mapping', () => {
  it('maps settlement to settled, never to completed', () => {
    // Column means the funds moved, not that they cannot come back. Treating
    // settlement as final is what pays out against a debit that later returns.
    expect(normalizeColumnStatus('SETTLED')).toBe('settled');
    expect(normalizeColumnStatus('COMPLETED')).toBe('completed');
  });

  it('maps the whole documented lifecycle', () => {
    expect(normalizeColumnStatus('INITIATED')).toBe('initiated');
    expect(normalizeColumnStatus('SCHEDULED')).toBe('initiated');
    expect(normalizeColumnStatus('PENDING_SUBMISSION')).toBe('pending');
    expect(normalizeColumnStatus('SUBMITTED')).toBe('pending');
    expect(normalizeColumnStatus('RETURNED')).toBe('returned');
    expect(normalizeColumnStatus('CANCELED')).toBe('canceled');
  });

  it('treats a risk hold and a manual review as still moving', () => {
    // Neither is a failure. Calling one would tell a user their transfer had
    // died while Column was still deciding.
    expect(normalizeColumnStatus('HOLD')).toBe('pending');
    expect(normalizeColumnStatus('MANUAL_REVIEW')).toBe('pending');
  });

  it('maps an unknown status to pending, never to a terminal state', () => {
    // Column can add statuses without asking us. Guessing `completed` would
    // release funds on a transfer whose state we cannot read.
    expect(normalizeColumnStatus('SOME_NEW_STATUS')).toBe('pending');
    expect(normalizeColumnStatus(null)).toBe('pending');
    expect(normalizeColumnStatus('')).toBe('pending');
  });

  it('round-trips a direction we originated', () => {
    expect(toColumnType('debit')).toBe('DEBIT');
    expect(toColumnType('credit')).toBe('CREDIT');
    expect(fromColumnType('DEBIT', false)).toBe('debit');
    expect(fromColumnType('CREDIT', false)).toBe('credit');
  });

  it('reads an incoming transfer with the opposite sign', () => {
    // A DEBIT we originate pulls money in; a DEBIT originated against us pushes
    // money out. Dropping is_incoming books returns with the wrong sign.
    expect(fromColumnType('DEBIT', true)).toBe('credit');
    expect(fromColumnType('CREDIT', true)).toBe('debit');
  });

  it('derives the SEC code rather than trusting a caller', () => {
    // Sending the wrong code is a NACHA rules violation, not a preference.
    expect(entryClassCode(false)).toBe('WEB');
    expect(entryClassCode(true)).toBe('CCD');
  });
});

describe('StubBankProvider', () => {
  let provider: StubBankProvider;

  beforeEach(() => {
    provider = new StubBankProvider();
    provider.reset();
  });

  it('stays off unless explicitly enabled', () => {
    expect(provider.isConfigured()).toBe(false);

    process.env.BANKING_ENABLE_STUB = '1';
    expect(provider.isConfigured()).toBe(true);
  });

  it('is never configured in production', () => {
    // A missing key must not silently fall back to synthetic transfers on a
    // live deployment.
    process.env.BANKING_ENABLE_STUB = '1';
    process.env.NODE_ENV = 'production';
    expect(provider.isConfigured()).toBe(false);
  });

  it('validates exactly as the domain does', async () => {
    await expect(provider.createTransfer({ ...request, amountMinor: -1 })).rejects.toThrow(
      /greater than zero/
    );
  });

  it('returns the first transfer when an idempotency key is replayed', async () => {
    const first = await provider.createTransfer(request);
    const replay = await provider.createTransfer({ ...request, amountMinor: 999_999 });

    // Same key, so the same transfer — and emphatically not a second debit at
    // the new amount.
    expect(replay.id).toBe(first.id);
    expect(replay.amountMinor).toBe(5_000);
  });

  it('makes a distinct transfer for a distinct key', async () => {
    const first = await provider.createTransfer(request);
    const second = await provider.createTransfer({ ...request, idempotencyKey: 'key-2' });

    expect(second.id).not.toBe(first.id);
  });

  it('can be driven through settlement and then a return', async () => {
    // The path most integrations never exercise before launch, and the one that
    // loses money.
    const created = await provider.createTransfer(request);
    expect(created.status).toBe('initiated');

    const settled = provider.advance(created.id, 'settled');
    expect(settled.status).toBe('settled');
    expect(settled.settledAt).not.toBeNull();

    const returned = provider.advance(created.id, 'returned', 'R01');
    expect(returned.status).toBe('returned');
    expect(returned.returnCode).toBe('R01');
    // The settlement timestamp survives the return: it did settle, and then it
    // came back. Clearing it would erase that it ever moved.
    expect(returned.settledAt).toBe(settled.settledAt);
  });

  it('reads back a transfer, and misses cleanly', async () => {
    const created = await provider.createTransfer(request);

    expect((await provider.getTransfer(created.id))!.id).toBe(created.id);
    expect(await provider.getTransfer('nope')).toBeNull();
  });
});

describe('provider registry', () => {
  it('reports no originator when none is configured', () => {
    // Bank transfers are off until one is onboarded, and callers must handle
    // that rather than assume a rail exists.
    expect(getActiveBankProvider()).toBeNull();
    expect(bankTransfersEnabled()).toBe(false);
  });

  it('picks up the stub when it is enabled', () => {
    process.env.BANKING_ENABLE_STUB = '1';
    process.env.NODE_ENV = 'test';

    expect(getActiveBankProvider()?.id).toBe('stub');
    expect(bankTransfersEnabled()).toBe(true);
  });
});
