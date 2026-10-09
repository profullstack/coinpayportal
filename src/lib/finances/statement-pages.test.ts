import { describe, it, expect } from 'vitest';
import { statementPage } from './statement-pages';
// @ts-expect-error plain JS engine shared with the CLI
import { institutionKey, TAX_SOURCES, BROKERAGE_SOURCES, DRIVERS } from '../../../packages/sdk/src/statements-fetch.js';

describe('statementPage', () => {
  it('knows every bank linked in production, by the key the fetcher derives from its domain', () => {
    const domains = [
      'www.alliantcreditunion.org', 'www.americanexpress.com', 'card.apple.com', 'www.bayfedonline.com', 'www.capitalone.com',
      'www.chase.com', 'www.citi.com', 'app.dcu.org', 'us.etrade.com', 'itrustcapital.com', 'www.sofi.com', 'www.stash.com',
      'www.troweprice.com', 'www.techcu.com', 'www.towerfcu.org',
    ];
    for (const domain of domains) {
      const page = statementPage({ key: institutionKey(domain, ''), url: `https://${domain}` });
      expect(page.url, domain).toMatch(/^https:\/\//);
      expect(page.steps, domain).not.toMatch(/look for Statements/);
    }
  });

  it('covers the tax and brokerage sources and the drivers with a statements page', () => {
    for (const source of [...TAX_SOURCES, ...BROKERAGE_SOURCES]) expect(statementPage({ key: source.key }).url).toMatch(/^https:\/\//);
    for (const driver of DRIVERS.filter((d: { statements?: string }) => d.statements)) expect(statementPage({ key: driver.key }).direct).toBe(true);
  });

  it('resolves a bank SimpleFIN gave no domain for by its name key', () => {
    expect(statementPage({ key: institutionKey('', 'Digital Federal Credit Union') }).url).toBe('https://app.dcu.org/login');
  });

  it('falls back to the bank site, and only over https', () => {
    expect(statementPage({ key: 'somebank', url: 'https://www.somebank.com' })).toMatchObject({ url: 'https://www.somebank.com', direct: false, label: 'Sign in' });
    expect(statementPage({ key: 'somebank', url: 'javascript:alert(1)' }).url).toBeNull();
    expect(statementPage({ key: 'chase' }).label).toBe('Statements');
  });
});
