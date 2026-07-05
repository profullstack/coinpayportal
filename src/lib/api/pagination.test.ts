import { describe, expect, it } from 'vitest';
import { parsePaginationParam } from './pagination';

describe('parsePaginationParam', () => {
  it('uses the default for missing or invalid values', () => {
    expect(parsePaginationParam(null, 50, { min: 1, max: 100 })).toBe(50);
    expect(parsePaginationParam('abc', 50, { min: 1, max: 100 })).toBe(50);
  });

  it('clamps values to the configured range', () => {
    expect(parsePaginationParam('-10', 50, { min: 0 })).toBe(0);
    expect(parsePaginationParam('0', 50, { min: 1, max: 100 })).toBe(1);
    expect(parsePaginationParam('500', 50, { min: 1, max: 100 })).toBe(100);
  });
});

