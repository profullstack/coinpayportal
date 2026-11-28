/**
 * Optional, self-declared age range on a human DID.
 *
 * We never ask for a birth date or an exact age: the user picks a band (or
 * nothing). The bands break at 18 and 21 so a relying party can age-gate
 * from the band alone (`age_over_18`, `age_over_21`) without learning more.
 *
 * This is SELF-ATTESTED. Nobody checked an ID. Every claim derived from it
 * carries `age_verification: 'self_attested'` so a relying party can decide
 * whether that is enough for its use (it is for a "you must be 18+" click-
 * through gate; it is not for anything a regulator wants documentary proof of).
 */

export const AGE_RANGES = [
  'under_18',
  '18_20',
  '21_30',
  '31_40',
  '41_50',
  '51_60',
  '61_plus',
] as const;

export type AgeRange = (typeof AGE_RANGES)[number];

export const AGE_RANGE_LABELS: Record<AgeRange, string> = {
  under_18: 'Under 18',
  '18_20': '18–20',
  '21_30': '21–30',
  '31_40': '31–40',
  '41_50': '41–50',
  '51_60': '51–60',
  '61_plus': '61+',
};

/** Lowest age in each band, used for the `age_over_N` booleans. */
const AGE_RANGE_MIN: Record<AgeRange, number> = {
  under_18: 0,
  '18_20': 18,
  '21_30': 21,
  '31_40': 31,
  '41_50': 41,
  '51_60': 51,
  '61_plus': 61,
};

export function isAgeRange(value: unknown): value is AgeRange {
  return typeof value === 'string' && (AGE_RANGES as readonly string[]).includes(value);
}

export type AgeClaims = {
  age_range: AgeRange;
  age_over_18: boolean;
  age_over_21: boolean;
  age_verification: 'self_attested';
};

/** Claims for the OAuth `age` scope, or null when the user has not set a range. */
export function ageClaims(range: unknown): AgeClaims | null {
  if (!isAgeRange(range)) return null;
  const min = AGE_RANGE_MIN[range];
  return {
    age_range: range,
    age_over_18: min >= 18,
    age_over_21: min >= 21,
    age_verification: 'self_attested',
  };
}
