import { describe, it, expect } from 'vitest';
import { AGE_RANGES, AGE_RANGE_LABELS, ageClaims, isAgeRange } from './age-range';

describe('DID age range', () => {
  it('accepts only the listed bands', () => {
    for (const r of AGE_RANGES) expect(isAgeRange(r)).toBe(true);
    expect(isAgeRange('25')).toBe(false);
    expect(isAgeRange('20_30')).toBe(false);
    expect(isAgeRange(null)).toBe(false);
  });

  it('labels every band', () => {
    for (const r of AGE_RANGES) expect(AGE_RANGE_LABELS[r]).toBeTruthy();
  });

  it('derives the 18+ and 21+ gates from the band floor', () => {
    expect(ageClaims('under_18')).toMatchObject({ age_over_18: false, age_over_21: false });
    expect(ageClaims('18_20')).toMatchObject({ age_over_18: true, age_over_21: false });
    expect(ageClaims('21_30')).toMatchObject({ age_over_18: true, age_over_21: true });
    expect(ageClaims('61_plus')).toMatchObject({ age_over_18: true, age_over_21: true });
  });

  it('marks every claim as self-attested', () => {
    expect(ageClaims('31_40')?.age_verification).toBe('self_attested');
  });

  it('returns null when no band is set', () => {
    expect(ageClaims(null)).toBeNull();
    expect(ageClaims(undefined)).toBeNull();
    expect(ageClaims('bogus')).toBeNull();
  });
});
