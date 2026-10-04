import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseAdmin: () => {
    throw new Error('summarise* must not touch the database');
  },
}));

import { summariseCommission, summariseTotals } from './admin-platform-series';

describe('summariseCommission', () => {
  it('separates commission that was swept on-chain from commission merely recorded', () => {
    // Two settled SOL payments of $100 each, 1% fee recorded on both, but only
    // one has an address with a sweep transaction behind it.
    const payments = [
      { id: 'p1', amount: 100, crypto_amount: 10, fee_amount: 0.1, status: 'forwarded' },
      { id: 'p2', amount: 100, crypto_amount: 10, fee_amount: 0.1, status: 'confirmed' },
    ];
    const sweptAddresses = [
      { id: 'a1', payment_id: 'p1', amount_expected: 10, commission_amount: 0.1 },
    ];

    const result = summariseCommission({
      payments,
      cardTransactions: [],
      sweptAddresses,
      paidInvoices: [],
      settledEscrows: [],
    });

    expect(result.cryptoAccruedUsd).toBe(2); // 1% of $200 across both
    expect(result.cryptoCollectedUsd).toBe(1); // only p1 actually moved
    expect(result.cryptoSweepCount).toBe(1);
    expect(result.totalCollectedUsd).toBe(1);
  });

  it('counts completed card charges that recorded no platform fee', () => {
    const cardTransactions = [
      { id: 's1', amount: 10_000, platform_fee_amount: 100, status: 'completed' },
      { id: 's2', amount: 5_000, platform_fee_amount: 0, status: 'completed' },
      { id: 's3', amount: 2_500, platform_fee_amount: 0, status: 'completed' },
      // Not completed — must not be counted at all.
      { id: 's4', amount: 9_900, platform_fee_amount: 0, status: 'failed' },
    ];

    const result = summariseCommission({
      payments: [],
      cardTransactions,
      sweptAddresses: [],
      paidInvoices: [],
      settledEscrows: [],
    });

    expect(result.cardCommissionUsd).toBe(1); // 100 minor units
    expect(result.cardCompletedCount).toBe(3);
    expect(result.cardZeroFeeCount).toBe(2);
    expect(result.cardZeroFeeVolumeUsd).toBe(75); // $50 + $25
  });

  it('converts escrow fees from chain units using the row\'s own USD amount', () => {
    const settledEscrows = [
      // 2 SOL worth $200, fee of 0.02 SOL => $2.00
      { id: 'e1', amount: 2, amount_usd: 200, fee_amount: 0.02, fee_tx_hash: '0xabc' },
    ];

    const result = summariseCommission({
      payments: [],
      cardTransactions: [],
      sweptAddresses: [],
      paidInvoices: [],
      settledEscrows,
    });

    expect(result.escrowCollectedUsd).toBe(2);
  });

  it('sums invoice fees, which are already USD', () => {
    const result = summariseCommission({
      payments: [],
      cardTransactions: [],
      sweptAddresses: [],
      paidInvoices: [{ id: 'i1', fee_amount: 1.5 }, { id: 'i2', fee_amount: 2.25 }],
      settledEscrows: [],
    });

    expect(result.invoiceFeesUsd).toBe(3.75);
    expect(result.totalCollectedUsd).toBe(3.75);
  });

  it('ignores the implausible test rows that would otherwise dominate every total', () => {
    const payments = [
      // A junk row: ~$1e9 of "volume" on a single payment.
      { id: 'junk', amount: 1_000_000_000, crypto_amount: 1, fee_amount: 0.01, status: 'confirmed' },
      { id: 'real', amount: 100, crypto_amount: 10, fee_amount: 0.1, status: 'confirmed' },
    ];

    const result = summariseCommission({
      payments,
      cardTransactions: [],
      sweptAddresses: [],
      paidInvoices: [],
      settledEscrows: [],
    });

    // Only the real $100 payment contributes its $1 of fee.
    expect(result.cryptoAccruedUsd).toBe(1);
  });

  it('does not credit a sweep whose payment row is missing', () => {
    const result = summariseCommission({
      payments: [],
      cardTransactions: [],
      sweptAddresses: [{ id: 'a1', payment_id: 'gone', amount_expected: 10, commission_amount: 0.1 }],
      paidInvoices: [],
      settledEscrows: [],
    });

    expect(result.cryptoCollectedUsd).toBe(0);
  });
});

describe('summariseTotals', () => {
  it('splits volume by rail and buckets rows by outcome', () => {
    const payments = [
      { id: 'p1', amount: 100, status: 'confirmed' },
      { id: 'p2', amount: 50, status: 'expired' },
      { id: 'p3', amount: 25, status: 'pending' },
    ];
    const cards = [
      { id: 's1', amount: 20_000, status: 'completed' },
      { id: 's2', amount: 1_000, status: 'failed' },
    ];

    const { methodSplit, statusBreakdown } = summariseTotals(payments, cards);

    expect(methodSplit.cryptoVolume).toBe(100);
    expect(methodSplit.cardVolume).toBe(200);
    expect(statusBreakdown).toEqual({ succeeded: 2, failed: 2, pending: 1 });
  });
});
