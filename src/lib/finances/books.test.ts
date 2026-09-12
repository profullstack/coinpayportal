import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));

import { matchRule, suggestFor, normalizeText, renderBooksCsv, type CategoryRule, type BooksSummary } from './books';
import { defaultTaxCategory, isTaxCategory, EXCLUDED_TAX_CATEGORIES } from './tax';

function rule(over: Partial<CategoryRule>): CategoryRule {
  return {
    id: 'r1', merchant_id: 'm', match_field: 'payee', match_type: 'exact', pattern: 'porkbun.com', category: 'software',
    tax_category: 'software_subscriptions', scope: 'business', hits: 0, active: true, created_at: '2026-09-12T00:00:00Z', ...over,
  };
}

describe('normalizeText', () => {
  it('lower-cases and collapses whitespace', () => {
    expect(normalizeText('  Porkbun.COM   Inc ')).toBe('porkbun.com inc');
    expect(normalizeText(null)).toBe('');
  });
});

describe('matchRule', () => {
  it('prefers exact payee over contains, and payee over description', () => {
    const rules = [
      rule({ id: 'contains', match_type: 'contains', pattern: 'pork', category: 'shopping' }),
      rule({ id: 'exact', pattern: 'porkbun.com', category: 'software' }),
      rule({ id: 'desc', match_field: 'description', match_type: 'contains', pattern: 'domain', category: 'other' }),
    ];
    expect(matchRule(rules, { payee: 'Porkbun.com', description: 'DOMAIN RENEWAL' })?.id).toBe('exact');
    expect(matchRule(rules, { payee: 'Porkbun Registrar', description: 'x' })?.id).toBe('contains');
    expect(matchRule(rules, { payee: null, description: 'domain renewal' })?.id).toBe('desc');
    expect(matchRule(rules, { payee: 'Cafe', description: 'coffee' })).toBeNull();
  });

  it('ignores inactive rules', () => {
    expect(matchRule([rule({ active: false })], { payee: 'porkbun.com', description: null })).toBeNull();
  });
});

describe('suggestFor', () => {
  it('a rule wins with high confidence and carries its scope and tax category', () => {
    const s = suggestFor({ payee: 'Porkbun.com', description: null, memo: null, mcc: null, amount: '-12.99' }, 'personal', [rule({})]);
    expect(s).toMatchObject({ category: 'software', taxCategory: 'software_subscriptions', scope: 'business', source: 'rule', confidence: 0.95 });
  });

  it('falls back to heuristics with a lower confidence, and maps a business debit to a tax bucket', () => {
    const s = suggestFor({ payee: 'Google Ads', description: null, memo: null, mcc: null, amount: '-500' }, 'business', []);
    expect(s.source).toBe('auto');
    expect(s.category).toBe('advertising');
    expect(s.taxCategory).toBe('advertising');
    expect(s.confidence).toBeGreaterThanOrEqual(0.6);
    expect(s.confidence).toBeLessThan(0.9);
  });

  it('marks personal-scope spending as personal whatever it bought', () => {
    const s = suggestFor({ payee: 'Google Ads', description: null, memo: null, mcc: null, amount: '-500' }, 'personal', []);
    expect(s.taxCategory).toBe('personal');
  });

  it('gives zero confidence when nothing matches', () => {
    const s = suggestFor({ payee: null, description: 'XYZ 4471', memo: null, mcc: null, amount: '-3' }, 'business', []);
    expect(s.category).toBeNull();
    expect(s.confidence).toBe(0);
    expect(s.taxCategory).toBe('uncategorized');
  });
});

describe('defaultTaxCategory', () => {
  it('excludes transfers and payments in either scope', () => {
    expect(defaultTaxCategory('transfer', 'business', false)).toBe('transfer');
    expect(defaultTaxCategory('payment', 'personal', false)).toBe('transfer');
    expect(EXCLUDED_TAX_CATEGORIES.has('transfer')).toBe(true);
  });

  it('treats business credits as receipts and business debits by category', () => {
    expect(defaultTaxCategory('income', 'business', true)).toBe('income_gross_receipts');
    expect(defaultTaxCategory('dining', 'business', false)).toBe('meals');
    expect(defaultTaxCategory('fuel', 'business', false)).toBe('car_truck');
    expect(defaultTaxCategory('groceries', 'business', false)).toBe('uncategorized');
  });

  it('only accepts known tax categories', () => {
    expect(isTaxCategory('meals')).toBe(true);
    expect(isTaxCategory('yachts')).toBe(false);
  });
});

describe('renderBooksCsv', () => {
  it('writes the summary and the ledger with formula-safe text', () => {
    const summary: BooksSummary = {
      start: '2026-01-01T08:00:00.000Z', end: '2027-01-01T08:00:00.000Z', scope: 'business',
      lines: [{ taxCategory: 'advertising', label: 'Advertising', currency: 'USD', total: '500', rows: 1, excluded: false, income: false }],
      totals: [{ currency: 'USD', income: '0', expenses: '500', net: '-500', excluded: '0' }],
      rows: 1, unreviewed: 1, uncategorized: 0, notice: 'n',
      transactions: [{
        id: 't1', account_id: 'a', posted: '2026-03-01T00:00:00Z', transacted_at: null, amount: '-500', description: '=CMD()', payee: 'Google Ads', memo: null, mcc: null, pending: false,
        category: 'advertising', category_source: 'auto', category_confidence: 0.6, tax_category: 'advertising', scope_override: null, reviewed_at: null, review_note: null,
        suggested_category: null, suggested_tax_category: null, suggested_confidence: null, suggested_by: null, account_name: 'Biz', org_name: 'Bank', currency: 'USD', account_scope: 'business', effective_scope: 'business',
      }],
    };
    const csv = renderBooksCsv(summary);
    expect(csv).toContain('summary,advertising,Advertising,USD,500,1,false,false');
    // The formula prefix is neutralised; no delimiter inside, so no quoting.
    expect(csv).toContain(`,'=CMD(),`);
    expect(csv).toContain(',-500,');
  });
});
