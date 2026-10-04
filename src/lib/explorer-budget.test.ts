import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExplorerBudget, reserveExplorerAccountRead } from './explorer-budget';

const dirs: string[] = [];
const file = () => {
  const dir = mkdtempSync(join(tmpdir(), 'explorer-budget-'));
  dirs.push(dir);
  return join(dir, 'budget.json');
};
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe('shared explorer free budget', () => {
  it('survives recreation and replenishes only at UTC midnight', () => {
    const path = file();
    let now = Date.UTC(2026, 8, 16, 12);
    const options = { file: path, dailyLimit: 2, now: () => now };
    expect(createExplorerBudget(options)()).toBe('allowed');
    const reserve = createExplorerBudget(options);
    expect(reserve()).toBe('allowed');
    expect(reserve()).toBe('daily');
    expect(createExplorerBudget(options)()).toBe('daily');
    now = Date.UTC(2026, 8, 17);
    expect(reserve()).toBe('allowed');
  });

  it('does not charge daily allowance for refused bursts', () => {
    let now = Date.UTC(2026, 8, 16);
    const reserve = createExplorerBudget({ dailyLimit: 3, minuteLimit: 2, now: () => now });
    expect(reserve()).toBe('allowed');
    expect(reserve()).toBe('allowed');
    for (let i = 0; i < 100; i++) expect(reserve()).toBe('burst');
    now += 60_000;
    expect(reserve()).toBe('allowed');
    expect(reserve()).toBe('daily');
  });

  it('fails closed on corrupt or unwritable storage', () => {
    const path = file();
    writeFileSync(path, 'broken');
    expect(createExplorerBudget({ file: path, dailyLimit: 2000 })()).toBe('unavailable');
    expect(createExplorerBudget({ file: join(path, 'child'), dailyLimit: 2000 })()).toBe('unavailable');
  });

  it('supports requiring payment immediately', () => {
    expect(createExplorerBudget({ dailyLimit: 0 })()).toBe('daily');
  });
});

it('gives each account exactly 2,000 reads independent of token and IP rotation', () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 8, 16));
  try {
    for (let i = 0; i < 2000; i++) {
      expect(reserveExplorerAccountRead('account-quota-test')).toBe('allowed');
      vi.advanceTimersByTime(2100);
    }
    expect(reserveExplorerAccountRead('account-quota-test')).toBe('daily');
    expect(reserveExplorerAccountRead('another-account')).toBe('allowed');
  } finally { vi.useRealTimers(); }
});

it('keeps separate budget instances on the same file in sync during deployment overlap', () => {
  const options = { file: file(), dailyLimit: 2 };
  const first = createExplorerBudget(options);
  const second = createExplorerBudget(options);
  expect(first()).toBe('allowed');
  expect(second()).toBe('allowed');
  expect(first()).toBe('daily');
});
