import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryBankStore } from './store';
import { StubBankProvider } from './stub';
import {
  DEFAULT_HOLD_DAYS,
  holdDays,
  linkBankAccount,
  originateTransfer,
  sweepBankTransfers,
  transitionFor,
  BankTransferError,
  ORPHAN_AFTER_MS,
} from './service';
import type { BankTransfer, BankTransferProvider } from './types';

const originalEnv = process.env;
const MERCHANT = 'merchant-a';
const OTHER = 'merchant-b';

/** 021000021 is JPMorgan Chase's routing number and passes the ABA checksum. */
const account = {
  merchantId: MERCHANT,
  holderName: 'Ada Lovelace',
  routingNumber: '021000021',
  accountNumber: '000123456789',
  accountType: 'checking' as const,
};

let store: MemoryBankStore;
let provider: StubBankProvider;
let clock: Date;

function deps() {
  return { store, provider, now: () => clock };
}

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.BANK_TRANSFER_HOLD_DAYS;
  store = new MemoryBankStore();
  provider = new StubBankProvider();
  clock = new Date('2026-09-17T12:00:00.000Z');
  store.now = () => clock;
});

afterEach(() => {
  process.env = originalEnv;
});

async function linked() {
  return linkBankAccount(account, deps());
}

async function originate(overrides: Partial<Parameters<typeof originateTransfer>[0]> = {}) {
  const cp = await linked();
  return originateTransfer(
    {
      merchantId: MERCHANT,
      bankCounterpartyId: cp.id,
      direction: 'debit',
      amountMinor: 12_345,
      currency: 'USD',
      idempotencyKey: 'key-1',
      description: 'Funding',
      ...overrides,
    },
    deps(),
  );
}

describe('holdDays', () => {
  it('defaults to five days and falls back on garbage', () => {
    expect(holdDays()).toBe(DEFAULT_HOLD_DAYS);
    process.env.BANK_TRANSFER_HOLD_DAYS = '10';
    expect(holdDays()).toBe(10);
    process.env.BANK_TRANSFER_HOLD_DAYS = '0';
    expect(holdDays()).toBe(0);
    for (const bad of ['soon', '-1', '']) {
      process.env.BANK_TRANSFER_HOLD_DAYS = bad;
      expect(holdDays()).toBe(DEFAULT_HOLD_DAYS);
    }
  });
});

describe('linkBankAccount', () => {
  it('stores the provider reference and the last four, never the account number', async () => {
    const row = await linked();
    expect(row.provider).toBe('stub');
    expect(row.provider_counterparty_id).toMatch(/^stub_cpty_/);
    expect(row.account_last4).toBe('6789');
    expect(JSON.stringify(row)).not.toContain('000123456789');
  });

  it('rejects a routing number that fails the ABA checksum before calling the provider', async () => {
    const spy = vi.spyOn(provider, 'createCounterparty');
    await expect(
      linkBankAccount({ ...account, routingNumber: '021000022' }, deps()),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('checksum') });
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses when no originator is configured', async () => {
    await expect(linkBankAccount(account, { store, provider: null })).rejects.toMatchObject({ status: 404 });
  });
});

describe('originateTransfer', () => {
  it('writes the row before calling the originator, then records the provider id', async () => {
    const order: string[] = [];
    const insert = store.insertTransfer.bind(store);
    store.insertTransfer = async (row) => {
      order.push('insert');
      return insert(row);
    };
    const create = provider.createTransfer.bind(provider);
    provider.createTransfer = async (req) => {
      order.push('provider');
      return create(req);
    };

    const row = await originate();
    expect(order).toEqual(['insert', 'provider']);
    expect(row.status).toBe('initiated');
    expect(row.provider_transfer_id).toMatch(/^stub_txf_/);
    expect(row.hold_until).toBeNull();
  });

  it('replays an idempotency key without a second origination', async () => {
    const first = await originate();
    const spy = vi.spyOn(provider, 'createTransfer');
    const cp = first.bank_counterparty_id!;
    const second = await originateTransfer(
      {
        merchantId: MERCHANT,
        bankCounterpartyId: cp,
        direction: 'debit',
        amountMinor: 99_999, // different amount, same key: the first wins
        currency: 'USD',
        idempotencyKey: 'key-1',
      },
      deps(),
    );
    expect(second.id).toBe(first.id);
    expect(second.amount_minor).toBe(12_345);
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a key that belongs to another merchant rather than replaying it', async () => {
    const first = await originate();
    await expect(
      originateTransfer(
        {
          merchantId: OTHER,
          bankCounterpartyId: first.bank_counterparty_id!,
          direction: 'debit',
          amountMinor: 1,
          currency: 'USD',
          idempotencyKey: 'key-1',
        },
        deps(),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('cannot use another merchant\'s bank account', async () => {
    const cp = await linked();
    await expect(
      originateTransfer(
        {
          merchantId: OTHER,
          bankCounterpartyId: cp.id,
          direction: 'debit',
          amountMinor: 1,
          currency: 'USD',
          idempotencyKey: 'key-x',
        },
        deps(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('marks the row failed with the reason when the originator rejects it', async () => {
    provider.createTransfer = async () => {
      throw new Error('Column transfer_error: insufficient funds');
    };
    const row = await originate();
    expect(row.status).toBe('failed');
    expect(row.last_error).toContain('insufficient funds');
    expect(row.provider_transfer_id).toBeNull();
  });

  it('validates amount, currency and originator support', async () => {
    await expect(originate({ amountMinor: 0 })).rejects.toBeInstanceOf(BankTransferError);
    await expect(originate({ amountMinor: 1.5, idempotencyKey: 'k2' })).rejects.toMatchObject({ status: 400 });
    await expect(originate({ currency: 'EUR', idempotencyKey: 'k3' })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('EUR'),
    });
  });

  it('lets a concurrent loser return the winner\'s row', async () => {
    const cp = await linked();
    const input = {
      merchantId: MERCHANT,
      bankCounterpartyId: cp.id,
      direction: 'debit' as const,
      amountMinor: 500,
      currency: 'USD',
      idempotencyKey: 'race',
    };
    // Both pass the pre-check before either inserts.
    const find = store.findTransferByIdempotencyKey.bind(store);
    let calls = 0;
    store.findTransferByIdempotencyKey = async (key) => (calls++ < 2 ? null : find(key));

    const [a, b] = await Promise.all([originateTransfer(input, deps()), originateTransfer(input, deps())]);
    expect(a.id).toBe(b.id);
    expect(store.transfers.size).toBe(1);
  });
});

describe('transitionFor', () => {
  const base = {
    id: 'btx_1',
    merchant_id: MERCHANT,
    business_id: null,
    provider: 'stub',
    provider_transfer_id: 'stub_txf_1',
    direction: 'debit' as const,
    amount_minor: 100,
    currency: 'USD',
    status: 'pending' as const,
    provider_status: 'SUBMITTED',
    return_code: null,
    counterparty_id: 'stub_cpty_1',
    bank_counterparty_id: 'bcp_1',
    description: null,
    idempotency_key: 'k',
    created_at: '2026-09-10T00:00:00.000Z',
    settled_at: null,
    hold_until: null,
    completed_at: null,
    returned_at: null,
    last_polled_at: null,
    last_error: null,
    updated_at: '2026-09-10T00:00:00.000Z',
  };
  const remote = (status: BankTransfer['status'], extra: Partial<BankTransfer> = {}): BankTransfer => ({
    id: 'stub_txf_1',
    provider: 'stub',
    direction: 'debit',
    amountMinor: 100,
    currency: 'USD',
    status,
    providerStatus: status.toUpperCase(),
    returnCode: null,
    createdAt: base.created_at,
    settledAt: null,
    ...extra,
  });
  const now = new Date('2026-09-17T12:00:00.000Z');

  it('starts the hold at settlement and does not complete early', () => {
    const patch = transitionFor(base, remote('settled', { settledAt: '2026-09-15T00:00:00.000Z' }), now);
    expect(patch.status).toBe('settled');
    expect(patch.settled_at).toBe('2026-09-15T00:00:00.000Z');
    expect(patch.hold_until).toBe('2026-09-20T00:00:00.000Z');
    expect(patch.completed_at).toBeUndefined();
  });

  it('completes once the hold has passed, and treats the provider\'s completed as settled', () => {
    const settled = { ...base, status: 'settled' as const, settled_at: '2026-09-10T00:00:00.000Z', hold_until: '2026-09-15T00:00:00.000Z' };
    const patch = transitionFor(settled, remote('completed'), now);
    expect(patch.status).toBe('completed');
    expect(patch.completed_at).toBe(now.toISOString());
    // The hold set at settlement is kept, not recomputed.
    expect(patch.hold_until).toBe('2026-09-15T00:00:00.000Z');
  });

  it('records a return after completion, with the code', () => {
    const completed = { ...base, status: 'completed' as const, settled_at: '2026-08-01T00:00:00.000Z', completed_at: '2026-08-06T00:00:00.000Z' };
    const patch = transitionFor(completed, remote('returned', { returnCode: 'R10' }), now);
    expect(patch.status).toBe('returned');
    expect(patch.return_code).toBe('R10');
    expect(patch.returned_at).toBe(now.toISOString());
  });

  it('does not un-settle on a failed or canceled word from the provider', () => {
    const settled = { ...base, status: 'settled' as const, settled_at: '2026-09-10T00:00:00.000Z' };
    expect(transitionFor(settled, remote('failed'), now).status).toBeUndefined();
    expect(transitionFor(settled, remote('canceled'), now).status).toBeUndefined();
    expect(transitionFor(base, remote('failed'), now).status).toBe('failed');
  });

  it('never moves a returned transfer back to settled', () => {
    const returned = { ...base, status: 'returned' as const, return_code: 'R01' };
    expect(transitionFor(returned, remote('settled'), now).status).toBeUndefined();
  });
});

describe('sweepBankTransfers', () => {
  it('drives a transfer through settled, the hold, and completed', async () => {
    const row = await originate();
    provider.advance(row.provider_transfer_id!, 'pending');
    let stats = await sweepBankTransfers(deps(), clock);
    expect(stats).toMatchObject({ checked: 1, errors: 0 });
    expect(store.transfers.get(row.id)!.status).toBe('pending');

    provider.advance(row.provider_transfer_id!, 'settled');
    stats = await sweepBankTransfers(deps(), clock);
    expect(stats.settled).toBe(1);
    const settled = store.transfers.get(row.id)!;
    expect(settled.status).toBe('settled');
    expect(settled.hold_until).not.toBeNull();

    // Still inside the hold: nothing changes.
    clock = new Date(clock.getTime() + 24 * 60 * 60 * 1000);
    stats = await sweepBankTransfers(deps(), clock);
    expect(stats.completed).toBe(0);

    clock = new Date(new Date(settled.hold_until!).getTime() + 1000);
    const transitions: string[] = [];
    stats = await sweepBankTransfers(deps(), clock, {
      onTransition: (before, after) => {
        transitions.push(`${before.status}->${after.status}`);
      },
    });
    expect(stats.completed).toBe(1);
    expect(transitions).toEqual(['settled->completed']);
  });

  it('keeps checking completed transfers and records a late return', async () => {
    const row = await originate();
    provider.advance(row.provider_transfer_id!, 'settled');
    await sweepBankTransfers(deps(), clock);
    clock = new Date(clock.getTime() + 6 * 24 * 60 * 60 * 1000);
    await sweepBankTransfers(deps(), clock);
    expect(store.transfers.get(row.id)!.status).toBe('completed');

    // Polled today already: not re-checked until tomorrow.
    provider.advance(row.provider_transfer_id!, 'returned', 'R10');
    let stats = await sweepBankTransfers(deps(), clock);
    expect(stats.checked).toBe(0);

    clock = new Date(clock.getTime() + 25 * 60 * 60 * 1000);
    stats = await sweepBankTransfers(deps(), clock);
    expect(stats.returned).toBe(1);
    const returned = store.transfers.get(row.id)!;
    expect(returned.status).toBe('returned');
    expect(returned.return_code).toBe('R10');
    expect(returned.completed_at).not.toBeNull();
  });

  it('stops re-checking after the sixty-day return window', async () => {
    const row = await originate();
    provider.advance(row.provider_transfer_id!, 'settled');
    await sweepBankTransfers(deps(), clock);
    clock = new Date(clock.getTime() + 61 * 24 * 60 * 60 * 1000);
    await sweepBankTransfers(deps(), clock); // completes
    clock = new Date(clock.getTime() + 2 * 24 * 60 * 60 * 1000);
    const stats = await sweepBankTransfers(deps(), clock);
    expect(stats.checked).toBe(0);
    expect(store.transfers.get(row.id)!.status).toBe('completed');
  });

  it('re-submits an interrupted origination under the same key, and gets the original back', async () => {
    const cp = await linked();
    // Simulate a crash between insert and the provider call.
    const orphan = await store.insertTransfer({
      merchant_id: MERCHANT,
      business_id: null,
      provider: 'stub',
      direction: 'debit',
      amount_minor: 777,
      currency: 'USD',
      counterparty_id: cp.provider_counterparty_id,
      bank_counterparty_id: cp.id,
      description: null,
      idempotency_key: 'orphan',
    });
    // The provider did receive the first attempt.
    const original = await provider.createTransfer({
      direction: 'debit',
      amountMinor: 777,
      currency: 'USD',
      counterpartyId: cp.provider_counterparty_id,
      idempotencyKey: 'orphan',
    });

    // Too young: left alone, its own request may still be running.
    let stats = await sweepBankTransfers(deps(), clock);
    expect(stats.resubmitted).toBe(0);
    expect(store.transfers.get(orphan.id)!.provider_transfer_id).toBeNull();

    clock = new Date(clock.getTime() + ORPHAN_AFTER_MS + 1);
    stats = await sweepBankTransfers(deps(), clock);
    expect(stats.resubmitted).toBe(1);
    const fixed = store.transfers.get(orphan.id)!;
    expect(fixed.provider_transfer_id).toBe(original.id);
    // One transfer at the provider, not two.
    expect((await provider.getTransfer(original.id))?.amountMinor).toBe(777);
  });

  it('counts a provider outage per row and carries on', async () => {
    const a = await originate({ idempotencyKey: 'a' });
    const b = await originate({ idempotencyKey: 'b' });
    const failing: BankTransferProvider = {
      ...provider,
      id: 'stub',
      label: 'stub',
      currencies: ['USD'],
      isConfigured: () => true,
      createCounterparty: provider.createCounterparty.bind(provider),
      createTransfer: provider.createTransfer.bind(provider),
      getTransfer: async (id) => {
        if (id === a.provider_transfer_id) throw new Error('503 from Column');
        return provider.getTransfer(id);
      },
    };
    const stats = await sweepBankTransfers({ store, provider: failing, now: () => clock }, clock);
    expect(stats.errors).toBe(1);
    expect(stats.checked).toBe(2);
    expect(store.transfers.get(a.id)!.last_error).toContain('503');
    expect(store.transfers.get(b.id)!.last_error).toBeNull();
  });
});
