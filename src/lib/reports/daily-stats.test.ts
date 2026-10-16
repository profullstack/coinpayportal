import { describe, expect, it } from 'vitest';
import { businessAdminUrl, businessSiteUrl, renderDailyStats, type DailyStats } from './daily-stats';

function stats(recentBusinesses: DailyStats['recentBusinesses']): DailyStats {
  const n = { total: 1, new24h: 0, new7d: 0, new30d: 0 };
  return {
    date: '2026-10-16',
    merchants: n,
    recentMerchants: [],
    wallets: { total: 1, addresses: 1, transactions: 1, new24h: 0, newTxs24h: 0 },
    payments: { total: 1, confirmed: 0, forwarded: 0, pending: 0, expired: 0, new24h: 0, settledUsd: 0, lastPaymentAt: null },
    escrows: { total: 0, funded: 0, new24h: 0 },
    businesses: n,
    recentBusinesses,
    integrations: { withApiKey: 0, newApiKeys24h: 0, stripeAccounts: 0, newStripeAccounts24h: 0, oauthClients: 0, newOauthClients24h: 0, withWebhook: 0 },
    subscriptions: { total: 0, active: 0, new24h: 0 },
    invoices: { total: 0, paid: 0, new24h: 0 },
    reputation: { receipts: 0, new24h: 0 },
    spam: { total: 0, suspicious: 0, wouldBlock: 0 },
  };
}

describe('businessSiteUrl', () => {
  it('returns the origin of an http(s) webhook', () => {
    expect(businessSiteUrl('https://shop.example.com/api/coinpay/webhook?x=1')).toBe('https://shop.example.com');
    expect(businessSiteUrl('http://example.org:8080/hook')).toBe('http://example.org:8080');
  });

  it('returns null for missing, malformed or non-http values', () => {
    expect(businessSiteUrl(null)).toBeNull();
    expect(businessSiteUrl(undefined)).toBeNull();
    expect(businessSiteUrl('')).toBeNull();
    expect(businessSiteUrl('not a url')).toBeNull();
    expect(businessSiteUrl('javascript:alert(1)')).toBeNull();
  });

  it('ignores our own and private hosts, which say nothing about the merchant', () => {
    expect(businessSiteUrl('https://supabase.coinpayportal.com/functions/v1/hook')).toBeNull();
    expect(businessSiteUrl('https://coinpayportal.com/api/webhooks/x')).toBeNull();
    expect(businessSiteUrl('http://localhost:3000/hook')).toBeNull();
    expect(businessSiteUrl('http://203.0.113.9/hook')).toBeNull();
    expect(businessSiteUrl('http://[::1]:8080/hook')).toBeNull();
  });
});

describe('businessAdminUrl', () => {
  it('deep-links the admin business search', () => {
    expect(businessAdminUrl('Bitway ')).toBe('https://coinpayportal.com/admin/businesses?search=Bitway%20');
    expect(businessAdminUrl(null)).toBe('https://coinpayportal.com/admin/businesses');
  });
});

describe('renderDailyStats recent businesses', () => {
  it('links each business to its site, and leaves the rest unlinked', () => {
    const { html, text } = renderDailyStats(
      stats([
        { name: 'Walker Labs', created_at: '2026-10-13T00:00:00Z', webhook_url: 'https://walkerlabs.io/hooks/coinpay' },
        { name: 'bardr', created_at: '2026-10-13T00:00:00Z', webhook_url: null },
      ])
    );
    expect(html).toContain('<a href="https://walkerlabs.io" style="color: #7c3aed;">walkerlabs.io</a>');
    expect(html).toContain('<a href="https://coinpayportal.com/admin/businesses?search=bardr" style="color: #1a1a2e;"><strong>bardr</strong></a> <span');
    expect(text).toContain('- Walker Labs - https://walkerlabs.io (2026-10-13) https://coinpayportal.com/admin/businesses?search=Walker%20Labs');
    expect(text).toContain('- bardr (2026-10-13) https://coinpayportal.com/admin/businesses?search=bardr');
  });
});
