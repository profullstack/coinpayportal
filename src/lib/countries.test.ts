import { describe, expect, it } from 'vitest';
import { COUNTRIES, countryName, isCountryCode, resolveCountry, searchCountries } from './countries';
import { STRIPE_CONNECT_COUNTRIES } from './stripe/connect-countries';

const codes = (q: string) => searchCountries(q).map((c) => c.code);

describe('COUNTRIES (iban.com ISO 3166-1 list)', () => {
  it('has all 249 entries with unique alpha-2 codes', () => {
    expect(COUNTRIES).toHaveLength(249);
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(249);
  });
});

describe('resolveCountry', () => {
  it.each([
    ['Nigeria', 'NG'],
    ['nigeria', 'NG'],
    ['  NIGERIA ', 'NG'],
    ['NG', 'NG'],
    ['ng', 'NG'],
    ['NGA', 'NG'],
    ['United States', 'US'],
    ['USA', 'US'],
    ['united states of america', 'US'],
    ['UK', 'GB'],
    ['Great Britain', 'GB'],
    ['Cote d\'Ivoire', 'CI'],
    ['Côte d’Ivoire', 'CI'],
    ['Ivory Coast', 'CI'],
    ['Turkey', 'TR'],
    ['Türkiye', 'TR'],
    ['Netherlands', 'NL'],
    ['Niger', 'NE'],
    ['South Korea', 'KR'],
  ])('%s -> %s', (text, code) => {
    expect(resolveCountry(text)?.code).toBe(code);
  });

  it('does not commit partial or unknown text', () => {
    expect(resolveCountry('nig')).toBeNull();
    expect(resolveCountry('Atlantis')).toBeNull();
    expect(resolveCountry('')).toBeNull();
    expect(resolveCountry('XX')).toBeNull();
  });

  it('only resolves inside a restricted list', () => {
    const stripe = STRIPE_CONNECT_COUNTRIES.map((c) => ({ ...c, alpha3: '', numeric: '' }));
    expect(resolveCountry('North Korea', stripe)).toBeNull();
    expect(resolveCountry('KP', stripe)).toBeNull();
    expect(resolveCountry('Nigeria', stripe)?.code).toBe('NG');
  });
});

describe('searchCountries', () => {
  it('ranks Nigeria first for "Nigeria" and lists both for "nig"', () => {
    expect(codes('Nigeria')[0]).toBe('NG');
    expect(codes('nig')).toEqual(expect.arrayContaining(['NE', 'NG']));
  });

  it('puts an exact code before name prefixes', () => {
    expect(codes('ng')[0]).toBe('NG');
    expect(codes('de')[0]).toBe('DE');
  });

  it('matches words inside long ISO names', () => {
    expect(codes('britain')).toContain('GB');
    expect(codes('congo')).toEqual(expect.arrayContaining(['CG', 'CD']));
  });

  it('returns the whole list for empty input', () => {
    expect(searchCountries('')).toHaveLength(249);
  });
});

describe('isCountryCode / countryName', () => {
  it('validates codes case-insensitively', () => {
    expect(isCountryCode('ng')).toBe(true);
    expect(isCountryCode('XX')).toBe(false);
    expect(isCountryCode(null)).toBe(false);
  });

  it('names codes without the ISO "(the)"', () => {
    expect(countryName('NG')).toBe('Nigeria');
    expect(countryName('US')).toBe('United States of America');
    expect(countryName('ZZ')).toBe('ZZ');
  });
});
