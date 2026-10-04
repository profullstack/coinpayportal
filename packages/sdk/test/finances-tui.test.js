import { describe, expect, it } from 'vitest';
import { renderToScreen } from '@profullstack/hqtui/testing';
import { buildFinanceSnapshot } from '../src/finances.js';
import { FINANCE_SCREENS } from '../src/finances-tui.js';

const NOW = new Date('2026-09-15T00:00:00Z');

function fixture(tab, count = 40) {
  const snapshot = buildFinanceSnapshot({}, { days: 90, now: NOW });
  const rows = Array.from({ length: count }, (_, i) => {
    const name = `Row${String(i).padStart(2, '0')}`;
    return {
      id: `record-${i}`, name, org: 'Example Bank', org_name: 'Example Bank',
      account_name: 'Checking', payee: name, description: name,
      currency: 'USD', balance: i, display_balance: i, amount: i,
      effective_kind: 'checking', effective_scope: 'personal', kind: 'credit', scope: 'personal',
      amount_usd: i, amount_crypto: '1', amount_cents: i * 100, net_to_merchant: i * 90,
      business_name: name, customer_name: name, status: 'paid',
      created_at: '2026-07-01T12:30:00Z', posted: '2026-07-02T12:00:00Z',
      due_date: '2026-08-03', sent_at: '2026-07-04T13:14:00Z', paid_at: '2026-07-05T14:15:00Z',
      invoice_number: name, clients: { name, email: `client${i}@example.com` },
      businesses: { name: 'Example business' }, notes: `Invoice notes ${i}`,
      chain: 'SOL', metadata: { description: name },
      owed: i + 100, paid: i, share: 0.1, payoffMonths: 12,
    };
  });
  snapshot.bank.connections = [{ id: 'connection', provider: 'simplefin', is_active: true }];
  snapshot.bank.accounts = rows;
  snapshot.bank.ledger = rows;
  snapshot.bank.ledgerTotal = count;
  snapshot.recent.payments = rows;
  snapshot.recent.cards = rows;
  snapshot.recent.escrows = rows;
  snapshot.invoices.rows = rows;
  snapshot.position = {
    currency: 'USD', observedDays: 90, monthsObserved: 3,
    income: { total: 100, perMonth: 33, grossCredits: 100 },
    spending: { total: 50, perMonth: 16, grossDebits: 50, refunds: 0 },
    net: { total: 50, perMonth: 16, savingsRate: 0.5 },
    debt: { accounts: rows, total: 500, revolving: 500, instalment: 0, servicePerMonth: 20, payoffMonths: 25 },
    ratios: { debtToIncome: 1, debtServiceRatio: 0.2, monthsOfCover: 3, creditUtilisation: 0.1 },
    recurring: { charges: [{ payee: 'Recurring bill', monthlyEquivalent: 12 }], monthlyTotal: 12 },
    scopes: [], confidence: { noLiabilityAccounts: false, uncategorisedShare: 0 }, months: [],
  };
  return { tab, days: 90, snapshot, panes: {}, live: [], liveStatus: 'polling' };
}

function draw(state, options = {}) {
  return renderToScreen(({ ui, theme }) => FINANCE_SCREENS[state.tab](ui, state, theme), {
    width: 160, height: 48, ...options,
  });
}

const cases = [
  { tab: 1, pane: 'accounts', title: 'Selected account', field: 'Account' },
  { tab: 2, pane: 'ledger', title: 'Selected transaction', field: 'Payee' },
  { tab: 3, pane: 'payments', title: 'Selected crypto payment', field: 'Business' },
  { tab: 4, pane: 'cards', title: 'Selected card payment', field: 'Customer' },
  { tab: 5, pane: 'invoices', title: 'Selected invoice', field: 'Invoice' },
  { tab: 5, pane: 'escrows', title: 'Selected escrow', field: 'Description', region: 1 },
  { tab: 6, pane: 'debts', title: 'Selected debt', field: 'Account' },
];

describe.each(cases)('$pane table details', ({ tab, pane, title, field, region = 0 }) => {
  it('opens the clicked record to the right of its table', () => {
    const state = fixture(tab);
    const screen = draw(state);
    const { rect } = screen.regions[region];
    expect(screen.click(rect.x + 2, rect.y + 3)).toBe(true);
    expect(state.panes[pane].selected).toBe(2);
    const next = draw(state);
    expect(next.find(title).x).toBeGreaterThan(rect.x + rect.width);
    expect(next.text()).toContain(`${field}: Row02`);
  });

  it('selects the visible row after the last page is clamped', () => {
    const state = fixture(tab, 80);
    state.panes[pane] = { selected: 79, offset: 79, total: 80 };
    const screen = draw(state);
    const offset = state.panes[pane].offset;
    expect(offset).toBeLessThan(79);
    const { rect } = screen.regions[region];
    screen.click(rect.x + 2, rect.y + 1);
    expect(state.panes[pane].selected).toBe(offset);
    expect(draw(state).text()).toContain(`${field}: Row${String(offset).padStart(2, '0')}`);
  });

  it('tracks the viewport when keyboard selection scrolls and the terminal resizes', () => {
    const state = fixture(tab, 80);
    state.panes[pane] = { selected: 70, offset: 0, total: 80 };
    draw(state);
    const screen = draw(state, { height: 36 });
    const offset = state.panes[pane].offset;
    expect(offset).toBeGreaterThan(0);
    const { rect } = screen.regions[region];
    screen.click(rect.x + 2, rect.y + 2);
    expect(state.panes[pane].selected).toBe(offset + 1);
    expect(draw(state).text()).toContain(`${field}: Row${String(offset + 1).padStart(2, '0')}`);
  });

  it('ignores blank rows below the data', () => {
    const state = fixture(tab, 2);
    const screen = draw(state);
    const { rect } = screen.regions[region];
    expect(rect.height).toBeGreaterThan(4);
    screen.click(rect.x + 2, rect.y + 4);
    expect(state.panes[pane].selected).toBe(0);
  });
});

describe('invoice dates and shared detail panel', () => {
  it.each([80, 120, 200])('keeps Created and Due dates readable at %i columns', (width) => {
    const state = fixture(5, 2);
    const screen = draw(state, { width, height: 36 });
    const { rect } = screen.regions[0];
    const table = screen.line(rect.y + 1).slice(rect.x, rect.x + rect.width);
    expect(table).toContain('2026-07-01');
    expect(table).toContain('2026-08-03');
  });

  it('shows created, due, sent and paid dates for the clicked invoice', () => {
    const state = fixture(5, 2);
    const screen = draw(state, { width: 120, height: 36 });
    const { rect } = screen.regions[0];
    screen.click(rect.x + 1, rect.y + 2);
    const next = draw(state, { width: 120, height: 36 });
    expect(next.text()).toContain('Created: 2026-07-01 12:30 UTC');
    expect(next.text()).toContain('Due: 2026-08-03');
    expect(next.text()).toContain('Sent: 2026-07-04 13:14 UTC');
    expect(next.text()).toContain('Paid: 2026-07-05 14:15 UTC');
    expect(next.text()).toContain('Invoice notes 1');
  });

  it('changes the focused table when switching between escrow and invoice rows', () => {
    const state = fixture(5, 2);
    const screen = draw(state);
    const escrow = screen.regions[1].rect;
    screen.click(escrow.x + 1, escrow.y + 2);
    expect(state.invoicePane).toBe('escrows');
    expect(draw(state).text()).toContain('Selected escrow');
    const invoice = screen.regions[0].rect;
    screen.click(invoice.x + 1, invoice.y + 1);
    expect(state.invoicePane).toBe('invoices');
    expect(draw(state).text()).toContain('Invoice: Row00');
  });

  it('shows a placeholder when there is no selected record', () => {
    const state = fixture(5, 0);
    const screen = draw(state);
    expect(screen.text()).toContain('No invoices.');
    expect(screen.text()).toContain('No escrows.');
    expect(screen.text()).toContain('Click a row to inspect its details.');
  });
});
