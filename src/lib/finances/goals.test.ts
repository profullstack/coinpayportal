import { describe, expect, it } from 'vitest';
import {
  GoalError,
  buildReport,
  goalBreakdown,
  nextCadenceRun,
  normalizeContribution,
  normalizeGoal,
  periodWindow,
  progressAt,
  renderReportHtml,
  renderReportText,
  snapshotGoal,
  type Goal,
  type GoalInputs,
} from './goals';

const NOW = new Date('2026-10-28T18:00:00Z');
const TODAY = '2026-10-28';

function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    name: 'House down payment',
    kind: 'house',
    targetAmount: 60000,
    currency: 'USD',
    startDate: '2026-01-01',
    deadline: '2031-01-01',
    startingAmount: null,
    startProgress: 0,
    linkedAccountIds: [],
    linkedWalletIds: [],
    notes: null,
    archivedAt: null,
    achievedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const empty: GoalInputs = { accounts: [], walletsUsd: 0, walletsPriced: true, contributions: [] };
const contrib = (amount: number, occurredOn: string) => ({ id: `c${occurredOn}${amount}`, goalId: 'g1', amount, occurredOn, note: null, createdAt: '' });

describe('normalizeGoal', () => {
  it('requires a deadline after the start and a positive target', () => {
    expect(() => normalizeGoal({ name: 'x', kind: 'car', targetAmount: 100 }, undefined, TODAY)).toThrow(GoalError);
    expect(() => normalizeGoal({ name: 'x', kind: 'car', targetAmount: 100, deadline: '2026-01-01' }, undefined, TODAY)).toThrow(/after the start/);
    expect(() => normalizeGoal({ name: 'x', kind: 'car', targetAmount: -5, deadline: '2030-01-01' }, undefined, TODAY)).toThrow(/negative/);
    expect(() => normalizeGoal({ name: 'x', kind: 'boat', targetAmount: 5, deadline: '2030-01-01' }, undefined, TODAY)).toThrow(/kind/);
  });

  it('parses "$12,500.50" and defaults currency and start', () => {
    const g = normalizeGoal({ name: 'Car', kind: 'car', targetAmount: '$12,500.50', deadline: '2028-06-30' }, undefined, TODAY);
    expect(g).toMatchObject({ targetAmount: 12500.5, currency: 'USD', startDate: TODAY });
  });

  it('a payoff goal takes its target from the starting debt', () => {
    const g = normalizeGoal({ name: 'Visa', kind: 'debt_payoff', startingAmount: 8000, deadline: '2027-12-31' }, undefined, TODAY);
    expect(g.targetAmount).toBe(8000);
  });

  it('refuses wallets on a payoff goal and junk ids', () => {
    expect(() => normalizeGoal({ name: 'x', kind: 'debt_payoff', targetAmount: 5, deadline: '2030-01-01', linkedWalletIds: ['00000000-0000-0000-0000-000000000001'] }, undefined, TODAY)).toThrow(/wallets/);
    expect(() => normalizeGoal({ name: 'x', kind: 'car', targetAmount: 5, deadline: '2030-01-01', linkedAccountIds: ['nope'] }, undefined, TODAY)).toThrow(/not an id/);
  });

  it('patches over an existing goal', () => {
    const base = normalizeGoal({ name: 'Car', kind: 'car', targetAmount: 100, deadline: '2030-01-01' }, undefined, TODAY);
    expect(normalizeGoal({ targetAmount: 200 }, base)).toMatchObject({ name: 'Car', targetAmount: 200, deadline: '2030-01-01' });
  });
});

describe('normalizeContribution', () => {
  it('defaults the date to today and refuses the future and zero', () => {
    expect(normalizeContribution({ amount: 50 }, TODAY)).toEqual({ amount: 50, occurredOn: TODAY, note: null });
    expect(normalizeContribution({ amount: -20, occurredOn: '2026-10-01' }, TODAY).amount).toBe(-20);
    expect(() => normalizeContribution({ amount: 5, occurredOn: '2026-11-01' }, TODAY)).toThrow(/future/);
    expect(() => normalizeContribution({ amount: 0 }, TODAY)).toThrow(/zero/);
  });

  it('refuses a date before the goal started', () => {
    expect(() => normalizeContribution({ amount: 5, occurredOn: '2026-10-20' }, TODAY, '2026-10-28')).toThrow(/before the goal started/);
  });
});

describe('pace', () => {
  it('a day with nothing on a payoff goal that needed something is short, not on pace', () => {
    const g = goal({ kind: 'debt_payoff', targetAmount: 8000, startingAmount: 8000, startDate: '2026-07-01', deadline: '2027-12-31' });
    const line = buildReport([{ goal: g, inputs: { ...empty, contributions: [contrib(900, '2026-09-15')] } }], 'daily', NOW, TODAY).goals[0];
    expect(line.neededThisPeriod).toBeGreaterThan(0);
    expect(line.pace).toBe('short');
  });
});

describe('progressAt', () => {
  it('unlinked save: starting amount plus contributions up to that day', () => {
    const g = goal({ startingAmount: 1000 });
    const inputs = { ...empty, contributions: [contrib(500, '2026-03-01'), contrib(250, '2026-10-01')] };
    expect(progressAt(g, inputs, new Date('2026-05-01T00:00:00Z')).progress).toBe(1500);
    expect(progressAt(g, inputs, NOW).progress).toBe(1750);
  });

  it('linked save: the account balance at the time, from snapshots', () => {
    const g = goal({ linkedAccountIds: ['a1'] });
    const inputs: GoalInputs = {
      ...empty,
      accounts: [{ id: 'a1', name: 'Savings', currency: 'USD', liability: false, current: 9000, history: [{ at: '2026-08-01T00:00:00Z', value: 5000 }, { at: '2026-10-01T00:00:00Z', value: 8000 }] }],
    };
    expect(progressAt(g, inputs, new Date('2026-09-15T00:00:00Z')).progress).toBe(5000);
    expect(progressAt(g, inputs, NOW, { now: true }).progress).toBe(9000);
    // Before any snapshot: the earliest stands in and the point is flagged.
    expect(progressAt(g, inputs, new Date('2026-07-01T00:00:00Z'))).toMatchObject({ progress: 5000, exact: false });
  });

  it('linked payoff: starting debt minus what is owed now', () => {
    const g = goal({ kind: 'debt_payoff', targetAmount: 8000, startingAmount: 8000, linkedAccountIds: ['card'] });
    const inputs: GoalInputs = { ...empty, accounts: [{ id: 'card', name: 'Visa', currency: 'USD', liability: true, current: 5000, history: [] }] };
    expect(progressAt(g, inputs, NOW, { now: true }).progress).toBe(3000);
  });

  it('ignores accounts in another currency; adds wallets only to USD goals', () => {
    const g = goal({ linkedAccountIds: ['eur'], linkedWalletIds: ['w'] });
    const inputs: GoalInputs = { ...empty, walletsUsd: 400, accounts: [{ id: 'eur', name: 'EUR', currency: 'EUR', liability: false, current: 999, history: [] }] };
    expect(progressAt(g, inputs, NOW, { now: true }).progress).toBe(400);
  });
});

describe('snapshotGoal', () => {
  it('is on track when progress meets the straight line', () => {
    // 300 of 1826 days elapsed -> expected 60000 * 300/1826 ~ 9857.6
    const g = goal({ startingAmount: 10000 });
    const s = snapshotGoal(g, empty, NOW, TODAY);
    expect(s.status).toBe('on_track');
    expect(s.remaining).toBe(50000);
    expect(s.required.perMonth).toBeGreaterThan(0);
    expect(s.daysLeft).toBe(1526);
  });

  it('is behind below the line, achieved at the target, overdue past the deadline', () => {
    expect(snapshotGoal(goal({ startingAmount: 1000 }), empty, NOW, TODAY).status).toBe('behind');
    expect(snapshotGoal(goal({ startingAmount: 60000 }), empty, NOW, TODAY).status).toBe('achieved');
    expect(snapshotGoal(goal({ startDate: '2024-01-01', deadline: '2026-01-01', startingAmount: 10 }), empty, NOW, TODAY).status).toBe('overdue');
  });

  it('required per month spreads what is left over the time left', () => {
    const g = goal({ targetAmount: 12000, startDate: '2026-10-28', deadline: '2027-10-28', startingAmount: 0 });
    const s = snapshotGoal(g, empty, NOW, TODAY);
    expect(s.required.perMonth).toBeCloseTo(1000, -1);
    expect(s.required.perQuarter).toBeCloseTo(3000, -1);
  });

  it('projects a landing date from the recent pace', () => {
    const g = goal({ targetAmount: 12000, startDate: '2026-07-30', startProgress: 0 });
    const inputs = { ...empty, contributions: [contrib(3000, '2026-08-15')] };
    const s = snapshotGoal(g, inputs, NOW, TODAY);
    expect(s.recentPerMonth).toBeGreaterThan(900);
    expect(s.projectedDate! > TODAY).toBe(true);
  });
});

describe('periods and reports', () => {
  it('trailing windows', () => {
    expect(periodWindow('daily', TODAY)).toMatchObject({ from: '2026-10-27', days: 1 });
    expect(periodWindow('weekly', TODAY)).toMatchObject({ from: '2026-10-21', days: 7 });
    expect(periodWindow('monthly', TODAY).from).toBe('2026-09-28');
    expect(periodWindow('quarterly', TODAY).from).toBe('2026-07-28');
    expect(periodWindow('monthly', '2026-03-31').from).toBe('2026-02-28');
  });

  it('a period report says what changed and whether it kept pace', () => {
    const g = goal({ targetAmount: 12000, startDate: '2026-01-01', deadline: '2027-01-01', startingAmount: 0 });
    const inputs = { ...empty, contributions: [contrib(9000, '2026-06-01'), contrib(1500, '2026-10-10')] };
    const report = buildReport([{ goal: g, inputs }], 'monthly', NOW, TODAY);
    expect(report.goals[0]).toMatchObject({ periodStart: 9000, periodEnd: 10500, change: 1500 });
    expect(report.goals[0].pace).toBe('ahead');
    expect(report.counts.on_track).toBe(1);
    for (const period of ['daily', 'weekly', 'monthly', 'quarterly'] as const) {
      const r = buildReport([{ goal: g, inputs }], period, NOW, TODAY);
      expect(renderReportText(r)).toContain('Not financial advice');
      expect(renderReportHtml(r, { appUrl: 'https://coinpayportal.com', unsubscribeUrl: 'https://x/u' })).toContain('Turn off goals report');
    }
  });

  it('an empty report still renders', () => {
    const r = buildReport([], 'weekly', NOW, TODAY);
    expect(renderReportText(r)).toContain('No goals yet');
  });
});

describe('goalBreakdown', () => {
  const acct = (id: string, current: number, over: Partial<GoalInputs['accounts'][number]> = {}) => ({ id, name: id, currency: 'USD', liability: false, current, history: [], institution: 'Bank', kind: 'investment', asOf: '2026-10-28T11:00:00Z', ...over });

  it('lists every linked account, largest first, and the counted amounts add up to progress', () => {
    const g = goal({ kind: 'custom', targetAmount: 5000, linkedAccountIds: ['robo', 'brokerage', 'etrade', 'zero'], linkedWalletIds: ['w'] });
    const inputs: GoalInputs = {
      ...empty,
      walletsUsd: 12.5,
      contributions: [contrib(100, '2026-10-01')],
      accounts: [acct('robo', 5514.76), acct('brokerage', 6722.73), acct('etrade', 3738.35, { asOf: '2026-09-12T20:29:41Z' }), acct('zero', 0)],
    };
    const sources = goalBreakdown(g, inputs, NOW);
    expect(sources.map((s) => s.id ?? s.type)).toEqual(['brokerage', 'robo', 'etrade', 'contributions', 'wallets', 'zero']);
    expect(sources.find((s) => s.id === 'etrade')).toMatchObject({ stale: true, asOf: '2026-09-12T20:29:41Z' });
    expect(sources.find((s) => s.id === 'robo')!.stale).toBe(false);
    const sum = Math.round(sources.reduce((t, s) => t + s.amount, 0) * 100) / 100;
    expect(sum).toBe(progressAt(g, inputs, NOW, { now: true }).progress);
  });

  it('a card on a save goal subtracts; a payoff goal starts from the debt', () => {
    const save = goal({ linkedAccountIds: ['sav', 'card'] });
    const inputs: GoalInputs = { ...empty, accounts: [acct('sav', 1000), acct('card', 300, { liability: true, kind: 'credit' })] };
    expect(progressAt(save, inputs, NOW, { now: true }).progress).toBe(700);
    expect(goalBreakdown(save, inputs, NOW).find((s) => s.id === 'card')!.amount).toBe(-300);

    const payoff = goal({ kind: 'debt_payoff', targetAmount: 8000, startingAmount: 8000, linkedAccountIds: ['card'] });
    const debt: GoalInputs = { ...empty, accounts: [acct('card', 5000, { liability: true })] };
    const b = goalBreakdown(payoff, debt, NOW);
    expect(b.map((s) => [s.type, s.amount])).toEqual([['starting', 8000], ['account', -5000]]);
    expect(b.reduce((t, s) => t + s.amount, 0)).toBe(progressAt(payoff, debt, NOW, { now: true }).progress);
  });

  it('marks another-currency accounts as not counted', () => {
    const g = goal({ linkedAccountIds: ['eur'] });
    const s = goalBreakdown(g, { ...empty, accounts: [acct('eur', 999, { currency: 'EUR' })] }, NOW);
    expect(s[0]).toMatchObject({ counted: false, amount: 0 });
  });

  it('the report text and email say what each goal is made of', () => {
    const g = goal({ kind: 'custom', name: 'overall', targetAmount: 5000, startDate: '2026-10-28', deadline: '2026-11-20', linkedAccountIds: ['b', 'e', 'z1', 'z2'] });
    const inputs: GoalInputs = { ...empty, accounts: [acct('b', 6722.73, { name: 'Brokerage (6151)', institution: 'SoFi' }), acct('e', 3738.35, { name: 'Individual Brokerage', institution: 'E*Trade', asOf: '2026-09-12T20:29:41Z' }), acct('z1', 0), acct('z2', 0)] };
    const r = buildReport([{ goal: g, inputs }], 'daily', NOW, TODAY);
    const text = renderReportText(r);
    expect(text).toMatch(/Made of:\n\s+\$6,722\.73\s+SoFi · Brokerage \(6151\)/);
    expect(text).toMatch(/E\*Trade · Individual Brokerage \(balance from 2026-09-12\)/);
    expect(text).toMatch(/\+ 2 linked accounts at \$0\.00/);
    const html = renderReportHtml(r, { appUrl: 'https://coinpayportal.com' });
    expect(html).toContain('Made of:');
    expect(html).toContain('SoFi · Brokerage (6151)');
    expect(html).toContain('E*Trade · Individual Brokerage');
  });
});

describe('nextCadenceRun', () => {
  const at = (date: string, hour: number) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
  it('daily, weekly on the weekday, monthly on the 1st, quarterly on Jan/Apr/Jul/Oct 1st', () => {
    expect(nextCadenceRun('daily', 8, 1, NOW, TODAY, at).toISOString()).toBe('2026-10-29T08:00:00.000Z');
    expect(nextCadenceRun('weekly', 8, 1, NOW, TODAY, at).toISOString()).toBe('2026-11-02T08:00:00.000Z');
    expect(nextCadenceRun('monthly', 8, 1, NOW, TODAY, at).toISOString()).toBe('2026-11-01T08:00:00.000Z');
    expect(nextCadenceRun('quarterly', 8, 1, NOW, TODAY, at).toISOString()).toBe('2027-01-01T08:00:00.000Z');
    expect(nextCadenceRun('daily', 20, 1, NOW, TODAY, at).toISOString()).toBe('2026-10-28T20:00:00.000Z');
  });
});
