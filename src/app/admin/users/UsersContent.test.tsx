import { describe, expect, it } from 'vitest';

import { toCsv } from './UsersContent';

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'person@example.com',
    name: 'Person',
    isAdmin: false,
    authProvider: 'email',
    subscriptionPlanId: null,
    subscriptionStatus: null,
    createdAt: '2026-08-12T00:00:00Z',
    lastLoginAt: null,
    lastActivityAt: null,
    businessesCount: 0,
    activeBusinessesCount: 0,
    paymentsTotal: 0,
    paymentsSettled: 0,
    settledVolumeUsd: 0,
    invoicesTotal: 0,
    invoicesPaid: 0,
    invoicesPaidUsd: 0,
    invoiceFeesUsd: 0,
    escrowsTotal: 0,
    escrowsSettled: 0,
    escrowVolumeUsd: 0,
    stripeTotal: 0,
    stripeCompleted: 0,
    stripeVolumeUsd: 0,
    totalVolumeUsd: 0,
    ...overrides,
  };
}

describe('toCsv', () => {
  it('neutralizes formula prefixes in user-controlled cells', () => {
    const csv = toCsv([
      user({ email: '+SUM(1)@example.com', name: '=1+1' }),
      user({ email: 'safe@example.com', name: '\t@SUM(1)' }),
    ] as never);

    expect(csv).toContain("'+SUM(1)@example.com,'=1+1");
    expect(csv).toContain("safe@example.com,'\t@SUM(1)");
    expect(csv).not.toContain('\n+SUM(1)@example.com,=1+1');
  });

  it('still quotes commas and doubles embedded quotes', () => {
    const csv = toCsv([user({ name: 'Doe, "Jane"' })] as never);

    expect(csv).toContain('"Doe, ""Jane"""');
  });
});
