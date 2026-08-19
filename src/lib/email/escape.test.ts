import { describe, expect, it } from 'vitest';
import { escapeHtml, escapeUrl } from './escape';
import { invoiceSentTemplate } from './invoice-templates';

/**
 * Regression tests for NEW-24 and G-1.2-09 (2026-08-19 audit).
 *
 * `proposal-templates.ts` escaped every interpolated field. Its siblings —
 * `invoice-templates.ts`, the team invitation email, and the daily internal
 * report — interpolated merchant-supplied strings raw. A merchant account is
 * free and unverified to create, so those strings are attacker-controlled and
 * the recipients are the merchant's own customers.
 */

describe('escapeHtml', () => {
  it('neutralises tags', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('escapes both quote styles', () => {
    // A value can land inside a single-quoted attribute as easily as a
    // double-quoted one.
    expect(escapeHtml(`" onmouseover='x'`)).toBe('&quot; onmouseover=&#39;x&#39;');
  });

  it('escapes ampersands first, so entities are not double-decoded', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('renders null and undefined as empty rather than the literal words', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('escapeUrl', () => {
  it('passes an ordinary https link through', () => {
    expect(escapeUrl('https://coinpayportal.com/pay/abc')).toBe(
      'https://coinpayportal.com/pay/abc'
    );
  });

  it('drops a javascript: URL', () => {
    // HTML-escaping alone leaves this intact, and it still executes on click.
    expect(escapeUrl('javascript:alert(1)')).toBe('#');
  });

  it('drops a data: URL', () => {
    expect(escapeUrl('data:text/html,<script>alert(1)</script>')).toBe('#');
  });
});

describe('invoiceSentTemplate', () => {
  it('does not emit a merchant-supplied tag into the body', () => {
    const { html } = invoiceSentTemplate({
      invoiceNumber: 'INV-1',
      businessName: '<img src=x onerror=alert(1)>',
      amount: 10,
      currency: 'USD',
      cryptoAmount: '0.001',
      cryptoCurrency: 'BTC',
      paymentLink: 'https://coinpayportal.com/pay/1',
      notes: '<script>steal()</script>',
    } as never);

    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>steal()');
    expect(html).toContain('&lt;img src=x');
  });

  it('refuses a javascript: payment link', () => {
    const { html } = invoiceSentTemplate({
      invoiceNumber: 'INV-1',
      businessName: 'Shop',
      amount: 10,
      currency: 'USD',
      cryptoAmount: '0.001',
      cryptoCurrency: 'BTC',
      paymentLink: 'javascript:alert(1)',
    } as never);

    expect(html).not.toContain('javascript:alert(1)');
  });

  it('leaves the subject line as readable plain text', () => {
    // The subject is not HTML; escaping it would show literal entities to the
    // recipient.
    const { subject } = invoiceSentTemplate({
      invoiceNumber: 'INV-1',
      businessName: 'Bob & Sons',
      amount: 10,
      currency: 'USD',
      cryptoAmount: '0.001',
      cryptoCurrency: 'BTC',
      paymentLink: 'https://coinpayportal.com/pay/1',
    } as never);

    expect(subject).toContain('Bob & Sons');
    expect(subject).not.toContain('&amp;');
  });
});
