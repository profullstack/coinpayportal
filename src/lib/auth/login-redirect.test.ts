import { describe, expect, it } from 'vitest';
import { getSafeLoginRedirect } from './login-redirect';

describe('getSafeLoginRedirect', () => {
  it('keeps internal application paths', () => {
    expect(getSafeLoginRedirect('/invoices?tab=sent#latest')).toBe(
      '/invoices?tab=sent#latest'
    );
  });

  it.each([
    'https://example.com/phishing',
    '//example.com/phishing',
    '/\\example.com/phishing',
    'javascript:alert(1)',
    'dashboard',
  ])('rejects external or ambiguous redirect %s', (value) => {
    expect(getSafeLoginRedirect(value)).toBeNull();
  });
});
