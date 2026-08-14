import { describe, expect, it } from 'vitest';

import { toCsv } from './EscrowsContent';

function escrow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'escrow-1',
    chain: 'SOL',
    status: 'settled',
    escrowModel: 'custodial',
    amount: '1.500000000000000000',
    amountUsd: 42.5,
    depositedAmount: null,
    feeAmount: null,
    escrowAddress: 'Esc111',
    depositorAddress: 'Dep111',
    beneficiaryAddress: 'Ben111',
    arbiterAddress: null,
    depositorEmail: null,
    beneficiaryEmail: null,
    depositTxHash: null,
    settlementTxHash: null,
    disputeStatus: null,
    disputeReason: null,
    inSeries: false,
    allowAutoRelease: false,
    settleAttempts: 0,
    businessId: null,
    businessName: null,
    merchantEmail: null,
    createdAt: '2026-08-12T00:00:00Z',
    fundedAt: null,
    releasedAt: null,
    settledAt: null,
    disputedAt: null,
    refundedAt: null,
    expiresAt: null,
    hoursToFund: null,
    hoursToSettle: null,
    isHeld: false,
    isStranded: false,
    ...overrides,
  };
}

describe('toCsv', () => {
  it('neutralizes formula prefixes in counterparty-controlled cells', () => {
    // Addresses, emails and dispute text all come from whoever created the
    // escrow, so any of them can carry a spreadsheet formula.
    const csv = toCsv([
      escrow({ depositorAddress: '=cmd|/c calc', beneficiaryEmail: '+SUM(1)@example.com' }),
      escrow({ depositorAddress: '\t@SUM(1)' }),
    ] as never);

    expect(csv).toContain("'=cmd|/c calc");
    expect(csv).toContain("'+SUM(1)@example.com");
    expect(csv).toContain("'\t@SUM(1)");
    expect(csv).not.toContain(',=cmd|/c calc');
  });

  it('still quotes commas and doubles embedded quotes', () => {
    const csv = toCsv([escrow({ businessName: 'Acme, "Inc"' })] as never);

    expect(csv).toContain('"Acme, ""Inc"""');
  });

  it('keeps the full precision of a chain amount rather than a rounded number', () => {
    // numeric(30,18) does not survive a round trip through a JS double, so the
    // export has to carry the string it was given.
    const csv = toCsv([escrow({ amount: '9859113112.123456789012345678' })] as never);

    expect(csv).toContain('9859113112.123456789012345678');
  });

  it('emits a header row followed by one line per escrow', () => {
    const csv = toCsv([escrow(), escrow({ id: 'escrow-2' })] as never);
    const lines = csv.split('\n');

    expect(lines[0]).toContain('id,chain,status');
    expect(lines).toHaveLength(3);
  });
});
