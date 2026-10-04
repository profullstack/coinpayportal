import { describe, it, expect } from 'vitest';
import { CORRIDORS, SUPPORTED_CORRIDORS, corridorFor } from './types';
import { getRemittanceProviders } from './providers';

/**
 * The corridor map is hand-written data, and at 43 entries the realistic bug is
 * a copy-paste one: a key that disagrees with the record inside it, two
 * corridors claiming the same country, a method with no named rail. None of
 * those are type errors, and each would surface as a quote in the wrong
 * currency rather than as a crash.
 */
describe('CORRIDORS', () => {
  it('keys every entry with the corridor it declares', () => {
    for (const [key, spec] of Object.entries(CORRIDORS)) {
      expect(spec.corridor).toBe(key);
    }
  });

  it('derives the destination country from the corridor name', () => {
    for (const spec of Object.values(CORRIDORS)) {
      expect(spec.corridor.endsWith(`-${spec.destinationCountry}`)).toBe(true);
    }
  });

  it('routes each destination country to exactly one corridor', () => {
    const countries = Object.values(CORRIDORS).map((spec) => spec.destinationCountry);

    expect(new Set(countries).size).toBe(countries.length);
  });

  it('names a real rail for every method it offers', () => {
    for (const spec of Object.values(CORRIDORS)) {
      for (const method of spec.methods) {
        // A method with no named network leaves the UI offering a rail the
        // recipient cannot actually be paid over.
        expect(spec.networks[method]?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('uses a three-letter payout currency everywhere', () => {
    for (const spec of Object.values(CORRIDORS)) {
      expect(spec.payoutCurrency).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('looks a corridor up case-insensitively, and misses cleanly', () => {
    expect(corridorFor('ng')?.corridor).toBe('US-NG');
    expect(corridorFor('BR')?.payoutCurrency).toBe('BRL');
    expect(corridorFor('JP')).toBeNull();
  });

  it('flags the currencies whose official rate is not the traded one', () => {
    // Naira, Egyptian pound, hryvnia and Argentine peso all trade away from
    // their official reference, which makes a computed FX margin meaningless.
    // Losing a flag here would publish a confident wrong number.
    const contested = Object.values(CORRIDORS)
      .filter((spec) => spec.fxReferenceContested)
      .map((spec) => spec.destinationCountry)
      .sort();

    expect(contested).toEqual(['AR', 'EG', 'NG', 'UA']);
  });

  it('lists every corridor in SUPPORTED_CORRIDORS', () => {
    expect(SUPPORTED_CORRIDORS.sort()).toEqual(Object.keys(CORRIDORS).sort());
  });
});

describe('partner coverage', () => {
  it('claims no corridor that does not exist', () => {
    for (const provider of getRemittanceProviders()) {
      for (const corridor of provider.corridors) {
        expect(CORRIDORS[corridor]).toBeDefined();
      }
    }
  });

  it('leaves no corridor without a partner that could serve it', () => {
    // Availability still depends on credentials at runtime. This asserts the
    // weaker but important thing: we never publish a corridor no adapter has
    // even been written for, which would be permanently unavailable.
    const claimed = new Set(
      getRemittanceProviders()
        .filter((provider) => provider.id !== 'stub')
        .flatMap((provider) => provider.corridors)
    );

    const orphans = Object.keys(CORRIDORS).filter((corridor) => !claimed.has(corridor as never));
    expect(orphans).toEqual([]);
  });
});
