import { describe, it, expect } from 'vitest';
import {
  BUSINESS_CATEGORIES,
  CATEGORY_GROUPS,
  classifyBusiness,
  isValidCategory,
  normalizeTags,
  suggestCategories,
  suggestTags,
  maxRisk,
  MAX_TAGS,
  MAX_TAG_LENGTH,
} from './taxonomy';

describe('taxonomy integrity', () => {
  it('has unique slugs', () => {
    const slugs = BUSINESS_CATEGORIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('only uses declared groups', () => {
    for (const category of BUSINESS_CATEGORIES) {
      expect(CATEGORY_GROUPS).toContain(category.group as (typeof CATEGORY_GROUPS)[number]);
    }
  });

  it('validates slugs', () => {
    expect(isValidCategory('streaming-iptv')).toBe(true);
    expect(isValidCategory('not-a-category')).toBe(false);
    expect(isValidCategory(undefined)).toBe(false);
  });
});

describe('normalizeTags', () => {
  it('lowercases, strips hashes and dedupes', () => {
    expect(normalizeTags(['#IPTV', 'iptv', '  Streaming  '])).toEqual(['iptv', 'streaming']);
  });

  it('drops non-strings and empties', () => {
    expect(normalizeTags(['ok', 42, '', '   ', null])).toEqual(['ok']);
  });

  it('caps count and length', () => {
    const many = Array.from({ length: 50 }, (_, i) => `tag${i}`);
    expect(normalizeTags(many)).toHaveLength(MAX_TAGS);
    const long = 'a'.repeat(100);
    expect(normalizeTags([long])[0]).toHaveLength(MAX_TAG_LENGTH);
  });

  it('returns empty for non-arrays', () => {
    expect(normalizeTags('iptv')).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
  });
});

describe('maxRisk', () => {
  it('picks the more severe level', () => {
    expect(maxRisk('low', 'high')).toBe('high');
    expect(maxRisk('prohibited', 'high')).toBe('prohibited');
    expect(maxRisk('medium', 'medium')).toBe('medium');
  });
});

describe('classifyBusiness', () => {
  it('leaves a plain low-risk business alone', () => {
    const result = classifyBusiness({
      name: 'Bean There Coffee',
      description: 'Neighborhood cafe and bakery',
      category: 'food-beverage',
      tags: ['coffee'],
    });
    expect(result.riskLevel).toBe('low');
    expect(result.reviewRequired).toBe(false);
    expect(result.flags).toEqual([]);
  });

  it('flags the IPTV category as high risk', () => {
    const result = classifyBusiness({
      name: 'StreamBox',
      category: 'streaming-iptv',
      tags: ['streaming', 'iptv'],
    });
    expect(result.riskLevel).toBe('high');
    expect(result.reviewRequired).toBe(true);
    expect(result.flags.map((f) => f.code)).toContain('piracy');
  });

  it('catches IPTV keywords even when the merchant self-declares as SaaS', () => {
    const result = classifyBusiness({
      name: 'CloudPanel',
      description: 'Subscription platform',
      category: 'saas',
      tags: ['iptv', 'restream'],
    });
    expect(result.riskLevel).toBe('high');
    const piracy = result.flags.find((f) => f.code === 'piracy');
    expect(piracy?.matched).toEqual(expect.arrayContaining(['iptv', 'restream']));
  });

  it('marks prohibited categories prohibited', () => {
    const result = classifyBusiness({ name: 'Lucky Spin', category: 'gambling' });
    expect(result.riskLevel).toBe('prohibited');
    expect(result.reviewRequired).toBe(true);
  });

  it('escalates on prohibited keywords regardless of category', () => {
    const result = classifyBusiness({
      name: 'Fast Coins',
      description: 'We offer a coin mixer for privacy',
      category: 'ecommerce-retail',
    });
    expect(result.riskLevel).toBe('prohibited');
    expect(result.flags.map((f) => f.code)).toContain('money-laundering');
  });

  it('treats a missing or invalid category as medium and reviewable-adjacent', () => {
    const result = classifyBusiness({ name: 'Unknown Co' });
    expect(result.riskLevel).toBe('medium');
    expect(result.reviewRequired).toBe(false);
    expect(result.flags.map((f) => f.code)).toContain('category:missing');

    const bogus = classifyBusiness({ name: 'Unknown Co', category: 'not-real' });
    expect(bogus.category).toBeNull();
    expect(bogus.flags.map((f) => f.code)).toContain('category:missing');
  });

  it('normalizes tags into the result', () => {
    const result = classifyBusiness({
      name: 'Shop',
      category: 'ecommerce-retail',
      tags: ['#Apparel', 'apparel', 'MERCH'],
    });
    expect(result.tags).toEqual(['apparel', 'merch']);
  });

  it('matches plurals and punctuation variants', () => {
    const result = classifyBusiness({
      name: 'Casinos-Online!',
      category: 'ecommerce-retail',
    });
    expect(result.flags.map((f) => f.code)).toContain('gambling');
  });

  it('does not match keywords embedded inside other words', () => {
    const result = classifyBusiness({
      name: 'Gunther Woodworks',
      description: 'Handmade furniture',
      category: 'ecommerce-retail',
    });
    expect(result.flags.map((f) => f.code)).not.toContain('firearms');
    expect(result.riskLevel).toBe('low');
  });

  it('sorts the worst flag first', () => {
    const result = classifyBusiness({
      name: 'Mixed Bag',
      description: 'iptv and a coin mixer',
      category: 'saas',
    });
    expect(result.flags[0].severity).toBe('prohibited');
  });
});

describe('suggestCategories', () => {
  it('suggests IPTV for streaming copy', () => {
    const suggestions = suggestCategories('We sell IPTV streaming subscriptions with VOD');
    expect(suggestions[0].slug).toBe('streaming-iptv');
  });

  it('returns nothing for empty input', () => {
    expect(suggestCategories('')).toEqual([]);
    expect(suggestCategories('zzzz qqqq')).toEqual([]);
  });

  it('respects the limit', () => {
    expect(suggestCategories('shop store hosting vpn course ticket', 2)).toHaveLength(2);
  });
});

describe('suggestTags', () => {
  it('puts the selected category keywords first', () => {
    const tags = suggestTags('', 'streaming-iptv', 3);
    expect(tags).toContain('streaming');
  });

  it('filters by what is being typed', () => {
    const tags = suggestTags('vp', null, 5);
    expect(tags).toContain('vpn');
    expect(tags.every((t) => t.includes('vp'))).toBe(true);
  });
});
