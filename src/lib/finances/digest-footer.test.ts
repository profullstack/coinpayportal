import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'crypto';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));

const { digestFooter } = await import('./schedules');
const { verifyUnsubscribe } = await import('./unsubscribe-token');

// Generated per run: no key material in the repo.
const SECRET = randomBytes(32).toString('hex');

describe('weekly digest footer', () => {
  it('carries a settings link and a signed one-click off link for that recipient, with RFC 8058 headers', () => {
    const footer = digestFooter('https://coinpayportal.com/', 'merchant-aaa', 'Alice@Example.com', SECRET);
    expect(footer.html).toContain('href="https://coinpayportal.com/finances/books#weekly-digest"');
    expect(footer.html).toContain('Turn off weekly digest');
    const url = footer.headers['List-Unsubscribe'].replace(/^<|>$/g, '');
    expect(url.startsWith('https://coinpayportal.com/api/finances/unsubscribe?t=')).toBe(true);
    expect(footer.html).toContain(url);
    expect(footer.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const token = new URL(url).searchParams.get('t');
    expect(verifyUnsubscribe(token, SECRET)).toEqual({ merchantId: 'merchant-aaa', kind: 'weekly_digest', email: 'alice@example.com' });
  });
});

describe('weekly payments footer', () => {
  it('points at the account settings and signs a weekly_payments token', () => {
    const footer = digestFooter('https://coinpayportal.com', 'merchant-ddd', 'dan@example.com', SECRET, 'weekly_payments');
    expect(footer.html).toContain('href="https://coinpayportal.com/settings#weekly-payments"');
    expect(footer.html).toContain('Turn off weekly payments report');
    const url = footer.headers['List-Unsubscribe'].replace(/^<|>$/g, '');
    expect(verifyUnsubscribe(new URL(url).searchParams.get('t'), SECRET)).toEqual({ merchantId: 'merchant-ddd', kind: 'weekly_payments', email: 'dan@example.com' });
  });
});
