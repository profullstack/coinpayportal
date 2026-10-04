import { describe, it, expect, beforeEach } from 'vitest';
import { askAllowance, recordAsk, resetAskLimits } from './limits';

beforeEach(() => resetAskLimits());

describe('ask limits', () => {
  it('counts per merchant and caps at the daily limit', () => {
    const day = new Date('2026-10-04T12:00:00Z');
    const start = askAllowance('m1', false, day);
    expect(start.used).toBe(0);
    for (let i = 0; i < start.limit; i++) recordAsk('m1', day);
    expect(askAllowance('m1', false, day).remaining).toBe(0);
    expect(askAllowance('m2', false, day).remaining).toBe(start.limit);
  });

  it('gives admins a higher cap', () => {
    const day = new Date('2026-10-04T12:00:00Z');
    expect(askAllowance('a', true, day).limit).toBeGreaterThan(askAllowance('m', false, day).limit);
  });

  it('resets at the next UTC day', () => {
    recordAsk('m1', new Date('2026-10-04T23:59:00Z'));
    expect(askAllowance('m1', false, new Date('2026-10-04T23:59:30Z')).used).toBe(1);
    expect(askAllowance('m1', false, new Date('2026-10-05T00:00:01Z')).used).toBe(0);
  });
});
