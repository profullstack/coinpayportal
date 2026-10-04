import { describe, it, expect } from 'vitest';
import { markdownText } from '@profullstack/hqtui';
import { renderToScreen } from '@profullstack/hqtui/testing';
import { buildFinanceSnapshot } from '../src/finances.js';
import { createState, financeMarkdownContext, renderFinancesTui } from '../src/finances-tui.js';

function state() {
  const state = createState(30);
  state.snapshot = buildFinanceSnapshot({
    errors: { payouts: 'Failed to fetch payouts' },
    connections: { connections: [{ label: 'Bank connection', provider: 'simplefin', is_active: true, last_synced_at: '2026-09-12T12:00:00Z', last_sync_status: 'partial', last_sync_error: 'One institution unavailable' }] },
    payments: { payments: [{ id: 'row-private', amount_usd: 12, amount_crypto: 12, currency: 'USDC', status: 'confirmed', created_at: '2026-09-12T12:00:00Z' }] },
    cardTransactions: { transactions: [], pagination: { has_more: true } },
  }, { days: 30, now: new Date('2026-09-13T12:00:00Z') });
  state.liveStatus = 'stream connected';
  state.live = [{ level: 'PAY', message: 'private-customer@example.test', time: '12:00' }];
  return state;
}

function draw(state, width = 160, height = 48) {
  return renderToScreen(({ ui, theme }) => renderFinancesTui(ui, state, theme, { height, markdownText }), {
    width, height, copyMarkdown: true, markdownContext: financeMarkdownContext(state),
  });
}

describe('CoinPay Markdown copy', () => {
  it('copies status with connection details, snapshot and exact source errors', () => {
    const s = state();
    s.days = 90;
    s.loading = true;
    const screen = draw(s);
    const icon = screen.find('⧉ MD');
    expect(icon).not.toBeNull();
    screen.click(icon.x, icon.y);
    expect(screen.copied).toHaveLength(1);
    expect(screen.copied[0]).toContain('## CoinPay status');
    expect(screen.copied[0]).toContain('Displayed window: 30 days');
    expect(screen.copied[0]).toContain('Requested window: 90 days (refresh pending)');
    expect(screen.copied[0]).toContain('2026-09-13T12:00:00.000Z');
    expect(screen.copied[0]).toContain('payouts: Failed to fetch payouts');
    expect(screen.copied[0]).toContain('One institution unavailable');
    expect(screen.copied[0]).not.toContain('private-customer');
  });

  it('exports earnings as labeled Markdown without live or transaction rows', () => {
    const screen = draw(state());
    for (const region of screen.regions) screen.click(region.rect.x, region.rect.y);
    const earnings = screen.copied.find((text) => text.startsWith('## Earnings'));
    expect(earnings).toContain('**Gross volume:** $12.00');
    expect(earnings).toContain('**Net earnings:** $12.00');
    expect(earnings).toContain('Card details, processor fees and refunds cover a partial page.');
    expect(earnings).toContain('payouts: Failed to fetch payouts');
    expect(screen.copied.join('\n')).not.toContain('private-customer');
    expect(screen.copied.join('\n')).not.toContain('row-private');
    expect(screen.copied.some((text) => text.startsWith('## Live'))).toBe(false);
  });

  it('all seven screens and loading/error states have usable summary exports', () => {
    for (let tab = 0; tab < 7; tab++) {
      const s = state();
      s.tab = tab;
      for (const width of [80, 160]) {
        const screen = draw(s, width);
        expect(screen.contains('⧉ MD')).toBe(true);
        const icon = screen.find('⧉ MD');
        expect(icon.x + 4).toBeLessThanOrEqual(width);
        screen.click(icon.x, icon.y);
        expect(screen.copied[0]).toContain('## CoinPay status');
      }
    }
    const s = createState(30);
    s.error = 'Refresh failed <retry>';
    const screen = draw(s);
    const icon = screen.find('⧉ MD');
    screen.click(icon.x, icon.y);
    expect(screen.copied[0]).toContain('Snapshot: not loaded');
    expect(screen.copied[0]).toContain('Refresh failed \\<retry\\>');
  });

  it('copies help without dismissing it, then Close still dismisses', () => {
    const s = state();
    s.showHelp = true;
    const screen = draw(s);
    const copy = screen.regions.at(-1);
    screen.click(copy.rect.x, copy.rect.y);
    expect(s.showHelp).toBe(true);
    expect(screen.copied[0]).toContain('## CoinPay Finances — Help');
    expect(screen.copied[0]).toContain('Tab focuses, Enter copies');
    const button = screen.regions.at(-2);
    expect(button).toBeDefined();
    screen.click(button.rect.x, button.rect.y);
    expect(s.showHelp).toBe(false);
  });
});
