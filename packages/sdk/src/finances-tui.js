/**
 * `coinpay finances` — a live terminal dashboard for the merchant's money.
 *
 * Built on @profullstack/hqtui. Six screens: Overview, Bank & Cards, Ledger,
 * Crypto, Cards, Invoices & Escrow. Data comes from `collectFinanceSnapshot`
 * on a timer, plus the payments server-sent-event stream for instant crypto
 * payment notices in the Live panel. Bank syncs are a keypress (`s`), never
 * automatic — the bank bridge allows about 24 pulls a day.
 *
 * hqtui is imported lazily so the rest of the CLI keeps working on a Node
 * that cannot load it (it needs Node 22.6+); `coinpay finances summary` is
 * the plain-text fallback.
 */

import { collectFinanceSnapshot, subscribeToPayments, syncFinances } from './finances.js';

const TABS = ['Overview', 'Bank & Cards', 'Ledger', 'Crypto', 'Cards', 'Invoices & Escrow'];
const WINDOWS = [7, 30, 90, 365];
const LIVE_MAX = 200;

// ── Formatting ──

const fmtCache = new Map();
export function money(value, currency = 'USD', { compact = false } = {}) {
  const n = Number(value) || 0;
  const key = `${currency}:${compact}`;
  let fmt = fmtCache.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: compact ? 0 : 2,
        minimumFractionDigits: compact ? 0 : 2,
        notation: compact ? 'compact' : 'standard',
      });
    } catch {
      fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    }
    fmtCache.set(key, fmt);
  }
  return fmt.format(n);
}

export function shortDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function shortDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ago(value) {
  if (!value) return 'never';
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function clock() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function shortId(value, n = 8) {
  const s = String(value || '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v ?? '');
  return Number.isFinite(n) ? n : 0;
}

// ── State ──

function createState(days) {
  return {
    tab: 0,
    days,
    snapshot: null,
    loading: false,
    lastRefresh: null,
    error: null,
    live: [],
    liveStatus: 'connecting',
    syncing: false,
    notice: null,
    paused: false,
    showHelp: false,
    panes: {},
    seen: { payments: new Set(), cards: new Set() },
    primed: false,
  };
}

function pane(state, name, total) {
  let p = state.panes[name];
  if (!p) {
    p = { selected: 0, offset: 0, total: 0 };
    state.panes[name] = p;
  }
  p.total = total;
  const max = Math.max(0, total - 1);
  p.selected = Math.min(p.selected, max);
  p.offset = Math.min(p.offset, max);
  return p;
}

function scrollPane(p, delta, rows = 3) {
  const max = Math.max(0, p.total - 1);
  p.offset = Math.max(0, Math.min(p.offset + delta * rows, max));
  p.selected = Math.max(p.offset, Math.min(p.selected, max));
}

function moveSelection(p, delta) {
  const max = Math.max(0, p.total - 1);
  p.selected = Math.max(0, Math.min(p.selected + delta, max));
  if (p.selected < p.offset) p.offset = p.selected;
}

// The table each screen scrolls with the keyboard.
const TAB_PANE = ['live', 'accounts', 'ledger', 'payments', 'cards', 'invoices'];

function pushLive(state, entry) {
  state.live.push({ time: clock(), ...entry });
  if (state.live.length > LIVE_MAX) state.live.splice(0, state.live.length - LIVE_MAX);
}

/** Record which rows we have already shown so the next refresh can announce only new ones. */
function noteNewRows(state, snapshot) {
  const payments = snapshot.recent.payments || [];
  const cards = snapshot.recent.cards || [];
  if (state.primed) {
    for (const p of payments) {
      if (state.seen.payments.has(p.id)) continue;
      pushLive(state, {
        level: 'PAY',
        message: `crypto ${p.status} ${money(p.amount_usd)} ${p.currency || ''} ${p.business_name ? `· ${p.business_name}` : ''}`.trim(),
        meta: shortId(p.id),
      });
    }
    for (const c of cards) {
      if (state.seen.cards.has(c.id)) continue;
      pushLive(state, {
        level: 'CARD',
        message: `card ${c.status} ${money(num(c.amount_cents) / 100, (c.currency || 'usd').toUpperCase())} ${c.business_name ? `· ${c.business_name}` : ''} ${c.customer_email ? `· ${c.customer_email}` : ''}`.trim(),
        meta: shortId(c.id),
      });
    }
  }
  for (const p of payments) state.seen.payments.add(p.id);
  for (const c of cards) state.seen.cards.add(c.id);
  state.primed = true;
}

// ── Screens ──

function statusColor(theme, status) {
  const s = String(status || '').toLowerCase();
  if (['completed', 'succeeded', 'forwarded', 'confirmed', 'paid', 'released', 'settled', 'ok', 'active'].includes(s)) return theme.success;
  if (['pending', 'detected', 'confirming', 'forwarding', 'sent', 'funded', 'draft', 'in_transit', 'partial'].includes(s)) return theme.warning;
  if (['failed', 'expired', 'refunded', 'partially_refunded', 'disputed', 'cancelled', 'canceled', 'overdue', 'error', 'forwarding_failed'].includes(s)) return theme.danger;
  return theme.muted;
}

function signed(theme, value) {
  return num(value) >= 0 ? theme.success : theme.danger;
}

function emptyPanel(ui, theme, title, message) {
  ui.panel({ title }, (p) => p.text(message, { fg: theme.muted }));
}

function overviewScreen(ui, state, theme) {
  const s = state.snapshot;
  const e = s.earnings;
  const b = s.bank;
  const cur = b.currency || 'USD';
  const win = `${state.days}d`;

  ui.grid({ columns: ['1fr', '1fr', '1fr'], rows: [11, '1fr', 12], gap: 1 }, (grid) => {
    grid.panel({ title: `Earnings · ${win}`, subtitle: s.plan ? `${s.plan.commission_percent} plan` : undefined }, (p) => {
      p.keyValues([
        { label: 'Gross volume', value: money(e.grossVolumeUsd), color: theme.primary },
        { label: '  crypto', value: money(e.cryptoVolumeUsd) },
        { label: '  cards', value: money(e.cardVolumeUsd) },
        { label: 'Commission paid', value: `-${money(e.commissionUsd)}`, color: theme.warning },
        { label: 'Card processor fees', value: `-${money(e.stripeFeesUsd)}`, color: theme.warning },
        { label: 'Refunds', value: `-${money(e.refundsUsd)}`, color: e.refundsUsd > 0 ? theme.danger : theme.muted },
        { label: 'Net earnings', value: money(e.netUsd), color: signed(theme, e.netUsd) },
        { label: 'Paid transactions', value: `${e.transactions}  (${e.failed} failed, ${e.failureRate}%)` },
      ], { labelWidth: 20 });
    });

    grid.panel({ title: 'Bank & cards', subtitle: b.connections.length ? `${b.accountCount} accounts` : 'nothing linked' }, (p) => {
      if (!b.connections.length) {
        p.text('Link a bank at coinpayportal.com/finances', { fg: theme.muted });
        return;
      }
      p.keyValues([
        { label: 'Cash & assets', value: money(b.assets, cur), color: theme.success },
        { label: 'Cards & loans owed', value: money(b.liabilities, cur), color: theme.danger },
        { label: 'Net position', value: money(b.net, cur), color: signed(theme, b.net) },
        { label: `Cash in · ${win}`, value: money(b.cashflow.moneyIn, cur), color: theme.success },
        { label: `Cash out · ${win}`, value: money(b.cashflow.moneyOut, cur), color: theme.danger },
        { label: 'Cashflow net', value: money(b.cashflow.net, cur), color: signed(theme, b.cashflow.net) },
        { label: 'Credit cards', value: `${b.creditCards.length}  owing ${money(b.creditCards.reduce((t, a) => t + Math.abs(num(a.display_balance ?? a.balance)), 0), cur)}` },
        { label: 'Last bank sync', value: ago(b.connections[0]?.last_synced_at), color: statusColor(theme, b.connections[0]?.last_sync_status) },
      ], { labelWidth: 20 });
    });

    grid.panel({ title: 'Pipeline' }, (p) => {
      const inv = s.invoices;
      const esc = s.escrow;
      p.keyValues([
        { label: 'Invoices outstanding', value: `${money(inv.totals.outstanding)}  (${inv.counts.outstanding})`, color: theme.warning },
        { label: 'Invoices overdue', value: `${money(inv.totals.overdue)}  (${inv.counts.overdue})`, color: inv.counts.overdue ? theme.danger : theme.muted },
        { label: `Invoices paid · ${win}`, value: `${money(inv.totals.paid)}  (${inv.counts.paid})`, color: theme.success },
        { label: 'Escrow held', value: `${money(esc.heldUsd)}  (${esc.held})`, color: theme.info },
        { label: `Escrow released · ${win}`, value: `${money(esc.releasedUsd)}  (${esc.released})` },
        { label: `Escrow refunded · ${win}`, value: `${money(esc.refundedUsd)}  (${esc.refunded})`, color: esc.refunded ? theme.danger : theme.muted },
        { label: 'Payouts pending', value: money(s.payout.pendingUsd) },
        { label: `Payouts paid · ${win}`, value: money(s.payout.paidUsd), color: theme.success },
      ], { labelWidth: 22 });
    });

    grid.panel({ title: `Volume by day · ${win}`, colSpan: 3, subtitle: 'volume vs commission' }, (p) => {
      const pts = s.series;
      if (!pts.length) {
        p.text('No volume in this window.', { fg: theme.muted });
        return;
      }
      const step = Math.max(1, Math.ceil(pts.length / 8));
      p.multiGraph(
        [
          { values: pts.map((x) => x.volumeUsd), color: theme.primary, label: 'volume', fill: true },
          { values: pts.map((x) => x.commissionUsd), color: theme.warning, label: 'commission' },
        ],
        {
          min: 0,
          axis: true,
          axisFormat: (v) => money(v, 'USD', { compact: true }),
          timeAxis: pts.map((x, i) => (i % step === 0 ? x.label.slice(5) : '')),
          legend: true,
        },
      );
    });

    grid.panel({ title: 'Live', colSpan: 2, subtitle: state.liveStatus, subtitleColor: state.liveStatus === 'connected' ? theme.success : theme.warning }, (p) => {
      const live = pane(state, 'live', state.live.length);
      p.log({
        entries: state.live.map((l) => ({ time: l.time, level: l.level, message: l.message, meta: l.meta })),
        fromEnd: live.offset,
        scrollbar: true,
        levelColors: { PAY: theme.success, CARD: theme.info, SYNC: theme.warning, ERR: theme.danger, INFO: theme.muted, SSE: theme.muted },
        onScroll: (delta) => scrollPane(live, -delta),
      });
    });

    grid.panel({ title: 'By rail' }, (p) => {
      const items = [{ label: 'cards', value: e.cardVolumeUsd, text: money(e.cardVolumeUsd, 'USD', { compact: true }) }];
      for (const [chain, usd] of Object.entries(s.crypto.byChain).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
        items.push({ label: chain, value: usd, text: money(usd, 'USD', { compact: true }) });
      }
      const max = Math.max(1, ...items.map((i) => i.value));
      p.meters(items.map((i) => ({ ...i, max })), { labelWidth: 9, valueWidth: 7 });
    });
  });
}

function bankScreen(ui, state, theme) {
  const b = state.snapshot.bank;
  const cur = b.currency || 'USD';
  if (!b.connections.length) {
    emptyPanel(ui, theme, 'Bank & cards', 'No bank linked yet. Connect one at coinpayportal.com/finances (SimpleFIN or Plaid), then press s to sync.');
    return;
  }
  ui.grid({ columns: ['3fr', '2fr'], gap: 1 }, (grid) => {
    grid.panel({ title: `Accounts (${b.accounts.length})`, footer: 'j/k scroll · s sync' }, (p) => {
      const accounts = pane(state, 'accounts', b.accounts.length);
      p.table({
        rows: b.accounts,
        selected: accounts.selected,
        offset: accounts.offset,
        followSelection: true,
        scrollbar: true,
        onScroll: (delta) => scrollPane(accounts, delta),
        onSelectRow: (row) => { accounts.selected = accounts.offset + row; },
        columns: [
          { key: 'org_name', title: 'Institution', width: 22, render: (r) => r.org_name || '—', color: theme.muted },
          { key: 'name', title: 'Account', min: 14, max: 36 },
          { key: 'effective_kind', title: 'Kind', width: 10, color: (r) => (r.is_liability ? theme.danger : theme.success) },
          { key: 'display_balance', title: 'Balance', width: 13, align: 'right', render: (r) => money(r.display_balance ?? r.balance ?? 0, r.currency || cur), color: (r) => (r.is_liability ? theme.danger : theme.success) },
          { key: 'available_balance', title: 'Available', width: 12, align: 'right', render: (r) => (r.available_balance == null ? '—' : money(r.available_balance, r.currency || cur)), color: theme.muted },
          { key: 'balance_date', title: 'As of', width: 10, render: (r) => shortDate(r.balance_date), color: theme.muted },
        ],
      });
    });

    grid.cell({ gap: 1 }, (col) => {
      col.panel({ title: 'Owed by institution', size: Math.min(14, b.byInstitution.length + 3) }, (p) => {
        const rows = b.byInstitution.filter((i) => i.liabilities > 0 || i.assets > 0);
        const max = Math.max(1, ...rows.map((i) => Math.max(i.liabilities, i.assets)));
        p.meters(
          rows.slice(0, 10).map((i) => ({
            label: i.org.slice(0, 14),
            value: i.liabilities > 0 ? i.liabilities : i.assets,
            max,
            color: i.liabilities > 0 ? theme.danger : theme.success,
            text: money(i.liabilities > 0 ? i.liabilities : i.assets, cur, { compact: true }),
          })),
          { labelWidth: 15, valueWidth: 7 },
        );
      });
      col.panel({ title: 'Position' }, (p) => {
        p.keyValues([
          { label: 'Assets', value: money(b.assets, cur), color: theme.success },
          { label: 'Liabilities', value: money(b.liabilities, cur), color: theme.danger },
          { label: 'Net', value: money(b.net, cur), color: signed(theme, b.net) },
          ...b.byKind.map((k) => ({ label: `  ${k.kind} (${k.accounts})`, value: money(k.total, k.currency || cur), color: theme.muted })),
        ], { labelWidth: 16 });
      });
      col.panel({ title: 'Connections' }, (p) => {
        p.keyValues(
          b.connections.flatMap((c) => [
            { label: c.provider, value: `${c.label || c.id.slice(0, 8)} · ${c.is_active ? 'active' : 'inactive'}`, color: c.is_active ? theme.foreground : theme.muted },
            { label: '  last sync', value: `${ago(c.last_synced_at)} · ${c.last_sync_status || '—'} · ${c.last_sync_accounts ?? 0} acct / ${c.last_sync_transactions ?? 0} tx`, color: statusColor(theme, c.last_sync_status) },
            ...(c.last_sync_error ? [{ label: '  note', value: String(c.last_sync_error).slice(0, 60), color: theme.warning }] : []),
          ]),
          { labelWidth: 12 },
        );
        if (state.syncing) p.text('Syncing with the bank bridge…', { fg: theme.warning });
        else if (state.notice) p.text(state.notice, { fg: theme.muted });
      });
    });
  });
}

function ledgerScreen(ui, state, theme) {
  const b = state.snapshot.bank;
  const cur = b.currency || 'USD';
  if (!b.ledger.length) {
    emptyPanel(ui, theme, 'Ledger', b.connections.length ? 'No transactions in this window. Press s to sync.' : 'No bank linked yet.');
    return;
  }
  ui.grid({ columns: ['3fr', '1fr'], gap: 1 }, (grid) => {
    grid.panel({ title: `Ledger · ${state.days}d`, subtitle: `${b.ledger.length} of ${b.ledgerTotal}`, footer: 'newest first' }, (p) => {
      const ledger = pane(state, 'ledger', b.ledger.length);
      p.table({
        rows: b.ledger,
        selected: ledger.selected,
        offset: ledger.offset,
        followSelection: true,
        scrollbar: true,
        zebra: true,
        onScroll: (delta) => scrollPane(ledger, delta),
        onSelectRow: (row) => { ledger.selected = ledger.offset + row; },
        columns: [
          { key: 'posted', title: 'Date', width: 10, render: (r) => shortDate(r.transacted_at || r.posted), color: theme.muted },
          { key: 'account_name', title: 'Account', width: 26, render: (r) => `${r.org_name ? r.org_name.split(' ')[0] + ' ' : ''}${r.account_name}` },
          { key: 'payee', title: 'Payee / description', min: 14, max: 40, render: (r) => r.payee || r.description || r.memo || '—' },
          { key: 'category', title: 'Category', width: 14, render: (r) => r.category || '—', color: theme.muted },
          { key: 'pending', title: '', width: 1, render: (r) => (r.pending ? '•' : ''), color: theme.warning },
          { key: 'amount', title: 'Amount', width: 12, align: 'right', render: (r) => money(r.amount, r.currency || cur), color: (r) => signed(theme, r.amount) },
        ],
      });
    });
    grid.cell({ gap: 1 }, (col) => {
      col.panel({ title: `Cashflow · ${state.days}d`, size: 7 }, (p) => {
        p.keyValues([
          { label: 'In', value: money(b.cashflow.moneyIn, cur), color: theme.success },
          { label: 'Out', value: money(b.cashflow.moneyOut, cur), color: theme.danger },
          { label: 'Net', value: money(b.cashflow.net, cur), color: signed(theme, b.cashflow.net) },
          { label: 'Transactions', value: String(b.cashflow.transactions) },
        ], { labelWidth: 13 });
      });
      col.panel({ title: 'Spend by category' }, (p) => {
        const cats = b.topCategories.filter((c) => c.spent > 0).slice(0, 14);
        const max = Math.max(1, ...cats.map((c) => c.spent));
        p.meters(
          cats.map((c) => ({ label: (c.category || 'uncategorised').slice(0, 14), value: c.spent, max, text: money(c.spent, cur, { compact: true }) })),
          { labelWidth: 15, valueWidth: 7, heat: true },
        );
      });
    });
  });
}

function cryptoScreen(ui, state, theme) {
  const s = state.snapshot;
  const rows = s.recent.payments;
  ui.grid({ columns: ['3fr', '1fr'], gap: 1 }, (grid) => {
    grid.panel({ title: `Crypto payments · ${state.days}d`, subtitle: s.crypto.partial ? 'latest page' : undefined }, (p) => {
      if (!rows.length) {
        p.text('No crypto payments in this window.', { fg: theme.muted });
        return;
      }
      const payments = pane(state, 'payments', rows.length);
      p.table({
        rows,
        selected: payments.selected,
        offset: payments.offset,
        followSelection: true,
        scrollbar: true,
        onScroll: (delta) => scrollPane(payments, delta),
        onSelectRow: (row) => { payments.selected = payments.offset + row; },
        columns: [
          { key: 'created_at', title: 'When', width: 11, render: (r) => shortDateTime(r.created_at), color: theme.muted },
          { key: 'business_name', title: 'Business', min: 10, max: 28, render: (r) => r.business_name || shortId(r.business_id) },
          { key: 'currency', title: 'Chain', width: 9 },
          { key: 'amount_usd', title: 'USD', width: 10, align: 'right', render: (r) => money(r.amount_usd) },
          { key: 'amount_crypto', title: 'Crypto', width: 13, align: 'right', render: (r) => String(num(r.amount_crypto).toFixed(6)), color: theme.muted },
          { key: 'fee_amount', title: 'Fee', width: 8, align: 'right', render: (r) => (r.fee_amount ? money((num(r.fee_amount) / Math.max(num(r.amount_crypto), 1e-12)) * num(r.amount_usd)) : '—'), color: theme.warning },
          { key: 'status', title: 'Status', width: 11, color: (r) => statusColor(theme, r.status) },
          { key: 'tx_hash', title: 'Tx', width: 10, render: (r) => shortId(r.forward_tx_hash || r.tx_hash || '', 9), color: theme.muted },
        ],
      });
    });
    grid.cell({ gap: 1 }, (col) => {
      col.panel({ title: 'Totals', size: 9 }, (p) => {
        p.keyValues([
          { label: 'Volume', value: money(s.earnings.cryptoVolumeUsd), color: theme.primary },
          { label: 'Commission', value: money(s.crypto.feesUsd), color: theme.warning },
          { label: 'Paid', value: String(s.crypto.successful), color: theme.success },
          { label: 'Pending', value: String(s.crypto.pending), color: theme.warning },
          { label: 'Failed/expired', value: String(s.crypto.failed), color: theme.danger },
          { label: 'Rate', value: s.plan ? s.plan.commission_percent : '—' },
        ], { labelWidth: 15 });
      });
      col.panel({ title: 'By chain' }, (p) => {
        const entries = Object.entries(s.crypto.byChain).sort((a, b) => b[1] - a[1]);
        if (!entries.length) { p.text('—', { fg: theme.muted }); return; }
        const max = Math.max(1, ...entries.map((e) => e[1]));
        p.meters(entries.map(([chain, usd]) => ({ label: chain, value: usd, max, text: money(usd, 'USD', { compact: true }) })), { labelWidth: 10, valueWidth: 7 });
      });
    });
  });
}

function cardsScreen(ui, state, theme) {
  const s = state.snapshot;
  const rows = s.recent.cards;
  ui.grid({ columns: ['3fr', '1fr'], gap: 1 }, (grid) => {
    grid.panel({ title: `Card payments · ${state.days}d`, subtitle: s.card.partial ? 'latest page' : undefined }, (p) => {
      if (!rows.length) {
        p.text('No card payments in this window.', { fg: theme.muted });
        return;
      }
      const cards = pane(state, 'cards', rows.length);
      p.table({
        rows,
        selected: cards.selected,
        offset: cards.offset,
        followSelection: true,
        scrollbar: true,
        onScroll: (delta) => scrollPane(cards, delta),
        onSelectRow: (row) => { cards.selected = cards.offset + row; },
        columns: [
          { key: 'created_at', title: 'When', width: 11, render: (r) => shortDateTime(r.created_at), color: theme.muted },
          { key: 'business_name', title: 'Business', min: 10, max: 26, render: (r) => r.business_name || shortId(r.business_id) },
          { key: 'customer_email', title: 'Customer', min: 10, max: 26, render: (r) => r.customer_name || r.customer_email || '—', color: theme.muted },
          { key: 'amount_cents', title: 'Amount', width: 10, align: 'right', render: (r) => money(num(r.amount_cents) / 100, (r.currency || 'usd').toUpperCase()) },
          { key: 'platform_fee_amount', title: 'Commission', width: 10, align: 'right', render: (r) => money(num(r.platform_fee_amount) / 100), color: theme.warning },
          { key: 'stripe_fee_amount', title: 'Proc fee', width: 9, align: 'right', render: (r) => money(num(r.stripe_fee_amount) / 100), color: theme.muted },
          { key: 'net_to_merchant', title: 'Net', width: 10, align: 'right', render: (r) => money(num(r.net_to_merchant) / 100), color: theme.success },
          { key: 'status', title: 'Status', width: 11, color: (r) => statusColor(theme, r.status) },
        ],
      });
    });
    grid.cell({ gap: 1 }, (col) => {
      col.panel({ title: 'Totals' }, (p) => {
        p.keyValues([
          { label: 'Volume', value: money(s.earnings.cardVolumeUsd), color: theme.primary },
          { label: 'Commission', value: money(s.card.platformFeesUsd), color: theme.warning },
          { label: 'Processor fees', value: money(s.card.stripeFeesUsd), color: theme.muted },
          { label: 'Net to merchant', value: money(s.card.netUsd), color: theme.success },
          { label: 'Refunded', value: `${money(s.card.refundedUsd)}  (${s.card.refunded})`, color: s.card.refunded ? theme.danger : theme.muted },
          { label: 'Succeeded', value: String(s.card.successful), color: theme.success },
          { label: 'Failed', value: String(s.card.failed), color: theme.danger },
          { label: 'Payouts paid', value: money(s.payout.paidUsd) },
          { label: 'Payouts pending', value: money(s.payout.pendingUsd) },
        ], { labelWidth: 16 });
        if (s.errors.payouts) p.text(`payouts: ${s.errors.payouts}`, { fg: theme.warning });
      });
    });
  });
}

function invoicesScreen(ui, state, theme) {
  const s = state.snapshot;
  const invoices = s.invoices.rows;
  const escrows = s.recent.escrows;
  ui.panel({
    title: `Invoices (${invoices.length})`,
    subtitle: `outstanding ${money(s.invoices.totals.outstanding)} · overdue ${money(s.invoices.totals.overdue)} · paid ${money(s.invoices.totals.paid)}`,
    size: '55%',
  }, (p) => {
    if (!invoices.length) { p.text('No invoices.', { fg: theme.muted }); return; }
    const inv = pane(state, 'invoices', invoices.length);
    p.table({
      rows: invoices,
      selected: inv.selected,
      offset: inv.offset,
      followSelection: true,
      scrollbar: true,
      onScroll: (delta) => scrollPane(inv, delta),
      onSelectRow: (row) => { inv.selected = inv.offset + row; },
      columns: [
        { key: 'invoice_number', title: 'No.', width: 9 },
        { key: 'clients', title: 'Client', min: 10, max: 28, render: (r) => r.clients?.name || r.clients?.email || '—' },
        { key: 'businesses', title: 'Business', min: 10, max: 26, render: (r) => r.businesses?.name || '—', color: theme.muted },
        { key: 'amount', title: 'Amount', width: 11, align: 'right', render: (r) => money(r.amount, r.currency || 'USD') },
        { key: 'status', title: 'Status', width: 10, color: (r) => statusColor(theme, r.status) },
        { key: 'due_date', title: 'Due', width: 10, render: (r) => shortDate(r.due_date), color: (r) => (r.due_date && r.status !== 'paid' && new Date(r.due_date) < new Date() ? theme.danger : theme.muted) },
        { key: 'paid_at', title: 'Paid', width: 10, render: (r) => shortDate(r.paid_at), color: theme.success },
        { key: 'crypto_currency', title: 'Settles in', width: 10, render: (r) => r.settlement_method || r.crypto_currency || '—', color: theme.muted },
      ],
    });
  });
  ui.spacer(1);
  ui.panel({
    title: `Escrow (${escrows.length})`,
    subtitle: `held ${money(s.escrow.heldUsd)} · released ${money(s.escrow.releasedUsd)} · refunded ${money(s.escrow.refundedUsd)}`,
  }, (p) => {
    if (!escrows.length) { p.text('No escrows.', { fg: theme.muted }); return; }
    const esc = pane(state, 'escrows', escrows.length);
    p.table({
      rows: escrows,
      selected: esc.selected,
      offset: esc.offset,
      followSelection: true,
      scrollbar: true,
      onScroll: (delta) => scrollPane(esc, delta),
      onSelectRow: (row) => { esc.selected = esc.offset + row; },
      columns: [
        { key: 'created_at', title: 'Created', width: 10, render: (r) => shortDate(r.created_at), color: theme.muted },
        { key: 'chain', title: 'Chain', width: 9 },
        { key: 'amount_usd', title: 'USD', width: 10, align: 'right', render: (r) => money(r.amount_usd) },
        { key: 'amount', title: 'Amount', width: 13, align: 'right', render: (r) => num(r.amount).toFixed(6), color: theme.muted },
        { key: 'fee_amount', title: 'Fee', width: 8, align: 'right', render: (r) => (r.fee_tx_hash ? money((num(r.fee_amount) / Math.max(num(r.amount), 1e-12)) * num(r.amount_usd)) : '—'), color: theme.warning },
        { key: 'status', title: 'Status', width: 10, color: (r) => statusColor(theme, r.status) },
        { key: 'metadata', title: 'Description', min: 10, max: 50, render: (r) => String(r.metadata?.description || r.beneficiary_email || '').slice(0, 60), color: theme.muted },
        { key: 'settled_at', title: 'Settled', width: 10, render: (r) => shortDate(r.settled_at || r.released_at || r.refunded_at), color: theme.muted },
      ],
    });
  });
}

const SCREENS = [overviewScreen, bankScreen, ledgerScreen, cryptoScreen, cardsScreen, invoicesScreen];

// ── App ──

async function loadHqtui() {
  try {
    return await import('@profullstack/hqtui');
  } catch (err) {
    const [major, minor] = process.versions.node.split('.').map(Number);
    const tooOld = major < 22 || (major === 22 && minor < 6);
    const hint = tooOld
      ? `The dashboard needs Node 22.6 or newer (you have ${process.versions.node}). Run \`coinpay update\` to install a current Node, or use \`coinpay finances summary\`.`
      : `Could not load @profullstack/hqtui: ${err?.message || err}. Run \`coinpay update\`, or use \`coinpay finances summary\`.`;
    const error = new Error(hint);
    error.cause = err;
    throw error;
  }
}

/**
 * Run the dashboard until the user quits. Resolves when the terminal has been
 * restored.
 */
export async function runFinancesTui({ client, baseUrl, token, days = 30, interval = 30, businessId, limit = 100, theme } = {}) {
  const hqtui = await loadHqtui();
  const app = await hqtui.createApp({ fps: 30, theme: theme || 'dark', quitKeys: ['ctrl+c', 'q'] });
  const state = createState(days);

  let refreshing = false;
  let refreshTimer = null;

  async function refresh(reason = 'timer') {
    if (refreshing) return;
    refreshing = true;
    state.loading = true;
    app.invalidate();
    try {
      const snapshot = await collectFinanceSnapshot(client, { days: state.days, limit, businessId });
      noteNewRows(state, snapshot);
      state.snapshot = snapshot;
      state.error = null;
      state.lastRefresh = new Date();
      const failed = Object.keys(snapshot.errors);
      if (failed.length && reason === 'startup') {
        pushLive(state, { level: 'INFO', message: `some sources unavailable: ${failed.join(', ')}`, meta: '' });
      }
    } catch (err) {
      state.error = err?.message || String(err);
      pushLive(state, { level: 'ERR', message: state.error, meta: reason });
    } finally {
      state.loading = false;
      refreshing = false;
      app.invalidate();
    }
  }

  function scheduleRefresh(ms = 1500) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { refreshTimer = null; void refresh('event'); }, ms);
  }

  async function sync() {
    if (state.syncing) return;
    if (!state.snapshot?.bank?.connections?.length) {
      state.notice = 'No bank connection to sync. Link one at coinpayportal.com/finances.';
      app.invalidate();
      return;
    }
    state.syncing = true;
    state.notice = null;
    pushLive(state, { level: 'SYNC', message: 'bank sync started', meta: '' });
    app.invalidate();
    try {
      const result = await syncFinances(client, {});
      const t = result.totals || {};
      state.notice = `Synced ${t.accounts ?? 0} accounts, ${t.transactionsNew ?? 0} new of ${t.transactionsSeen ?? 0} transactions (${result.status}).`;
      pushLive(state, { level: 'SYNC', message: state.notice, meta: '' });
      await refresh('sync');
    } catch (err) {
      state.notice = `Sync failed: ${err?.message || err}`;
      pushLive(state, { level: 'ERR', message: state.notice, meta: 'sync' });
    } finally {
      state.syncing = false;
      app.invalidate();
    }
  }

  const poll = setInterval(() => {
    if (!state.paused) void refresh('timer');
  }, Math.max(5, interval) * 1000);
  poll.unref?.();

  const tick = setInterval(() => app.invalidate(), 1000);
  tick.unref?.();

  let closeStream = () => {};
  if (baseUrl && token) {
    closeStream = subscribeToPayments({
      baseUrl,
      token,
      businessId,
      onStatus: (status, detail) => {
        state.liveStatus = status === 'error' ? `stream error: ${detail}` : `stream ${status}`;
        app.invalidate();
      },
      onEvent: (event) => {
        if (!event || event.type === 'heartbeat') return;
        if (event.type === 'connected') {
          pushLive(state, { level: 'SSE', message: 'live payment stream connected', meta: '' });
        } else if (event.payment) {
          const p = event.payment;
          pushLive(state, {
            level: 'PAY',
            message: `${event.type.replace('payment_', '')} ${money(p.amount_usd)} ${p.currency || ''} · ${p.status}${p.confirmations != null ? ` · ${p.confirmations}/${p.required_confirmations ?? '?'} conf` : ''}`,
            meta: shortId(p.id),
          });
          scheduleRefresh();
        }
        app.invalidate();
      },
    });
  } else {
    state.liveStatus = 'polling only';
  }

  app.on('key', (event) => {
    if (state.showHelp) {
      state.showHelp = false;
      return;
    }
    const name = event.name;
    const digit = Number(name);
    if (Number.isInteger(digit) && name.length === 1 && digit >= 1 && digit <= TABS.length) {
      state.tab = digit - 1;
      return;
    }
    switch (name) {
      case 'tab':
      case 'right':
      case 'l':
        state.tab = event.shift ? (state.tab + TABS.length - 1) % TABS.length : (state.tab + 1) % TABS.length;
        break;
      case 'left':
      case 'h':
        state.tab = (state.tab + TABS.length - 1) % TABS.length;
        break;
      case 'r':
      case 'f5':
        void refresh('manual');
        break;
      case 's':
        void sync();
        break;
      case 'w':
        state.days = WINDOWS[(WINDOWS.indexOf(state.days) + 1) % WINDOWS.length] ?? 30;
        void refresh('window');
        break;
      case 'p':
      case 'space':
        state.paused = !state.paused;
        break;
      case '?':
      case 'f1':
        state.showHelp = true;
        break;
      case 'up':
      case 'k':
        moveSelection(pane(state, TAB_PANE[state.tab], state.panes[TAB_PANE[state.tab]]?.total ?? 0), state.tab === 0 ? 1 : -1);
        break;
      case 'down':
      case 'j':
        moveSelection(pane(state, TAB_PANE[state.tab], state.panes[TAB_PANE[state.tab]]?.total ?? 0), state.tab === 0 ? -1 : 1);
        break;
      case 'pageup':
        scrollPane(pane(state, TAB_PANE[state.tab], state.panes[TAB_PANE[state.tab]]?.total ?? 0), state.tab === 0 ? 1 : -1, 10);
        break;
      case 'pagedown':
        scrollPane(pane(state, TAB_PANE[state.tab], state.panes[TAB_PANE[state.tab]]?.total ?? 0), state.tab === 0 ? -1 : 1, 10);
        break;
      case 'home': {
        const p = pane(state, TAB_PANE[state.tab], state.panes[TAB_PANE[state.tab]]?.total ?? 0);
        p.selected = 0; p.offset = state.tab === 0 ? Math.max(0, p.total - 1) : 0;
        break;
      }
      case 'end': {
        const p = pane(state, TAB_PANE[state.tab], state.panes[TAB_PANE[state.tab]]?.total ?? 0);
        p.selected = Math.max(0, p.total - 1); p.offset = state.tab === 0 ? 0 : p.selected;
        break;
      }
      default:
        return;
    }
    app.invalidate();
  });

  app.render(({ ui, theme: t, height }) => {
    ui.row({ size: 1 }, (header) => {
      header.text(' CoinPay ', { fg: t.title, bold: true, size: 10 });
      header.tabs({
        tabs: TABS.map((name, i) => `${i + 1} ${name}`),
        active: state.tab,
        onSelect: (index) => { state.tab = index; },
      });
      const right = [
        state.paused ? 'paused' : state.loading ? 'loading…' : `${state.days}d`,
        state.lastRefresh ? `updated ${ago(state.lastRefresh)}` : 'starting',
        clock(),
      ].join('  ');
      header.text(`${right} `, { fg: state.paused ? t.warning : state.error ? t.danger : t.success, align: 'right' });
    });
    ui.spacer(1);

    ui.column({ size: height - 4 }, (body) => {
      if (!state.snapshot) {
        body.panel({ title: 'Finances' }, (p) => {
          p.text(state.error ? `Could not load: ${state.error}` : 'Loading your numbers…', { fg: state.error ? t.danger : t.muted });
          if (state.error) p.text('Press r to retry, q to quit.', { fg: t.muted });
        });
        return;
      }
      SCREENS[state.tab](body, state, t);
    });

    ui.spacer(1);
    const errorCount = state.snapshot ? Object.keys(state.snapshot.errors).length : 0;
    ui.statusBar({
      items: [
        { key: '1-6', label: 'Screen' },
        { key: 'r', label: 'Refresh' },
        { key: 's', label: state.syncing ? 'Syncing…' : 'Sync bank', active: state.syncing },
        { key: 'w', label: `Window ${state.days}d` },
        { key: 'p', label: state.paused ? 'Resume' : 'Pause', active: state.paused },
        { key: '?', label: 'Help' },
        { key: 'q', label: 'Quit' },
      ],
      right: [
        ...(errorCount ? [{ label: `${errorCount} source${errorCount > 1 ? 's' : ''} unavailable`, color: t.warning }] : []),
        { label: state.liveStatus, color: state.liveStatus === 'stream connected' ? t.success : t.muted },
      ],
    });

    if (state.showHelp) {
      ui.modal({
        title: 'CoinPay Finances — Help',
        width: 66,
        height: 20,
        message:
          '1-6, Tab, ←/→ switch screens.\n' +
          'r refreshes now; refresh also runs every ' + Math.max(5, interval) + 's.\n' +
          's pulls fresh bank balances and transactions (rate-limited\n' +
          '  by the bank bridge, so it is never automatic).\n' +
          'w cycles the window: 7 → 30 → 90 → 365 days.\n' +
          'p pauses the timer. ↑/↓ j/k, PgUp/PgDn, Home/End scroll.\n' +
          'Mouse: click tabs, scroll tables.\n\n' +
          'Commission paid = platform fees on crypto + card payments.\n' +
          'Net earnings = gross − commission − processor fees − refunds.\n\n' +
          'Press any key to close.',
        buttons: [{ label: 'Close', focused: true }],
      });
    }
  });

  app.on('exit', () => {
    clearInterval(poll);
    clearInterval(tick);
    if (refreshTimer) clearTimeout(refreshTimer);
    closeStream();
  });

  void refresh('startup');
  await app.start();
}

export { TABS as FINANCE_TABS, WINDOWS as FINANCE_WINDOWS };
