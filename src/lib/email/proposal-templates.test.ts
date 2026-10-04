import { describe, it, expect } from 'vitest';
import { proposalDecidedTemplate } from './proposal-templates';

const base = {
  proposalNumber: 'PROP-001',
  title: 'Agentic coding',
  counterpartyName: 'Acme Ltd',
  amount: 2500,
  currency: 'USD',
  link: 'https://coinpayportal.com/proposals/abc',
} as const;

describe('proposalDecidedTemplate', () => {
  it('offers the merchant the invoice they can actually create', () => {
    const { html } = proposalDecidedTemplate({
      ...base,
      decision: 'accepted',
      recipient: 'merchant',
    });

    expect(html).toContain('Create Invoice');
  });

  it('never offers a client an invoice they cannot create', () => {
    // When the merchant accepts a client's counter-offer the *client* gets this
    // mail. Creating an invoice is a merchant action, so a "Create Invoice"
    // button here sends them to a page that cannot do what it promised.
    const { html } = proposalDecidedTemplate({
      ...base,
      decision: 'accepted',
      recipient: 'client',
    });

    expect(html).not.toContain('Create Invoice');
    expect(html).toContain('View Proposal');
  });

  it('offers no invoice on a rejection, whoever is reading', () => {
    for (const recipient of ['merchant', 'client'] as const) {
      const { html } = proposalDecidedTemplate({ ...base, decision: 'rejected', recipient });
      expect(html).not.toContain('Create Invoice');
      expect(html).toContain('View Proposal');
    }
  });

  it('carries the link through unchanged', () => {
    const { html } = proposalDecidedTemplate({
      ...base,
      decision: 'accepted',
      recipient: 'merchant',
    });

    expect(html).toContain(base.link);
  });
});
