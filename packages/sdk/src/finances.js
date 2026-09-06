/**
 * Finances — the merchant's money in one place.
 *
 * Read-side wrappers over the CoinPay API for everything that has a dollar
 * sign on it: linked bank and card accounts (SimpleFIN / Plaid), the ledger,
 * crypto payments, card payments, escrows, invoices and payouts. Plus
 * `buildFinanceSnapshot`, a pure function that turns those responses into the
 * headline numbers a dashboard wants (earnings, commission paid, refunds,
 * cashflow, outstanding invoices, escrow held).
 *
 * Every call needs the merchant session token (`coinpay login`), not a
 * business API key: the bank-data routes deliberately refuse API keys.
 */

const CRYPTO_SUCCESS = new Set(['confirmed', 'completed', 'forwarded', 'forwarding']);
const CRYPTO_FAILED = new Set(['failed', 'expired', 'forwarding_failed', 'settle_failed', 'settlement_failed']);
const CRYPTO_PENDING = new Set(['pending', 'detected', 'confirming']);
const CARD_SUCCESS = new Set(['completed', 'succeeded']);
const CARD_FAILED = new Set(['failed', 'canceled', 'cancelled', 'requires_payment_method']);
const CARD_REFUNDED = new Set(['refunded', 'partially_refunded']);

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

/** Map a day window onto the analytics `period` values the API understands. */
export function periodForDays(days) {
  if (!Number.isFinite(days) || days <= 0) return 'all';
  if (days <= 7) return '7d';
  if (days <= 30) return '30d';
  if (days <= 90) return '90d';
  if (days <= 365) return '1y';
  return 'all';
}

// ── Bank & card accounts (SimpleFIN / Plaid) ──

/** Balance sheet + cashflow headline. `days` sets the cashflow window. */
export async function getFinanceSummary(client, { days = 30, includeHidden = false } = {}) {
  const data = await client.request(`/finances/summary${query({ days, hidden: includeHidden ? 1 : undefined })}`);
  return data.summary;
}

/** Every linked account with its current balance. */
export async function listFinanceAccounts(client, { includeHidden = false } = {}) {
  const data = await client.request(`/finances/accounts${query({ hidden: includeHidden ? 1 : undefined })}`);
  return data.accounts || [];
}

/** The ledger, newest first. Returns `{ rows, total, limit, offset }`. */
export async function listFinanceTransactions(client, filters = {}) {
  return client.request(
    `/finances/transactions${query({
      account: filters.accountId,
      search: filters.search,
      category: filters.category,
      start: filters.startDate,
      end: filters.endDate,
      pending: filters.includePending === false ? 0 : undefined,
      limit: filters.limit,
      offset: filters.offset,
    })}`,
  );
}

/** Linked institutions and their last sync outcome. */
export async function listFinanceConnections(client) {
  return client.request('/finances/connections');
}

/**
 * Pull fresh balances and transactions from the bank bridge. This spends
 * request budget (SimpleFIN allows ~24/day per connection), so it is a
 * deliberate action, never something a screen does on its own.
 */
export async function syncFinances(client, { days, connectionId } = {}) {
  return client.request('/finances/sync', {
    method: 'POST',
    body: JSON.stringify({ days, connectionId }),
  });
}

// ── Payments, cards, payouts ──

/** Merchant dashboard headline (plan, commission rate, recent payments). */
export async function getDashboardStats(client, { businessId } = {}) {
  return client.request(`/dashboard/stats${query({ business_id: businessId })}`);
}

/** Crypto + card analytics for a period (`7d`, `30d`, `90d`, `1y`, `all`). */
export async function getFinanceAnalytics(client, { period = '30d', businessId } = {}) {
  const data = await client.request(`/stripe/analytics${query({ period, business_id: businessId })}`);
  return data.analytics;
}

/** Crypto payments across every business the merchant can see. */
export async function listCryptoPayments(client, { limit = 100, offset = 0, status, businessId, dateFrom, dateTo } = {}) {
  return client.request(`/payments${query({ limit, offset, status, business_id: businessId, date_from: dateFrom, date_to: dateTo })}`);
}

/** Card (Stripe) charges across every business the merchant can see. */
export async function listCardTransactions(client, { limit = 100, offset = 0, status, businessId, dateFrom, dateTo } = {}) {
  return client.request(`/stripe/transactions${query({ limit, offset, status, business_id: businessId, date_from: dateFrom, date_to: dateTo })}`);
}

/** Card payouts to the merchant's bank. */
export async function listCardPayouts(client, { limit = 50, offset = 0, status } = {}) {
  return client.request(`/stripe/payouts${query({ limit, offset, status })}`);
}

// ── Snapshot ──

function num(value) {
  const n = typeof value === 'number' ? value : parseFloat(value ?? '');
  return Number.isFinite(n) ? n : 0;
}

function within(dateLike, since) {
  if (!since) return true;
  const t = new Date(dateLike || 0).getTime();
  return Number.isFinite(t) && t >= since.getTime();
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** USD value of a crypto payment's fee, pro-rated from the crypto amounts. */
export function cryptoFeeUsd(payment) {
  const fee = num(payment.fee_amount);
  const crypto = num(payment.amount_crypto ?? payment.crypto_amount);
  const usd = num(payment.amount_usd ?? payment.amount);
  if (fee > 0 && crypto > 0 && usd > 0) return (fee / crypto) * usd;
  return 0;
}

/**
 * Turn raw API responses into the numbers a dashboard shows.
 *
 * Pure: no I/O, so it is unit-testable and the TUI can re-run it on every
 * refresh without touching the network. Any input may be missing (a route
 * that failed) and the corresponding section is then empty rather than the
 * whole snapshot failing.
 */
export function buildFinanceSnapshot(raw = {}, { days = 30, now = new Date() } = {}) {
  const since = Number.isFinite(days) && days > 0 ? new Date(now.getTime() - days * 86400000) : null;
  const errors = { ...(raw.errors || {}) };

  // ── Crypto payments ──
  const payments = raw.payments?.payments || [];
  const windowPayments = payments.filter((p) => within(p.created_at, since));
  const cryptoOk = windowPayments.filter((p) => CRYPTO_SUCCESS.has(String(p.status).toLowerCase()));
  const cryptoFailed = windowPayments.filter((p) => CRYPTO_FAILED.has(String(p.status).toLowerCase()));
  const cryptoPending = windowPayments.filter((p) => CRYPTO_PENDING.has(String(p.status).toLowerCase()));
  const crypto = {
    volumeUsd: round2(cryptoOk.reduce((s, p) => s + num(p.amount_usd), 0)),
    feesUsd: round2(cryptoOk.reduce((s, p) => s + cryptoFeeUsd(p), 0)),
    successful: cryptoOk.length,
    failed: cryptoFailed.length,
    pending: cryptoPending.length,
    total: windowPayments.length,
    byChain: {},
    // The list is a page; the server-side analytics below cover the full window.
    partial: Boolean(raw.payments?.pagination?.has_more),
  };
  for (const p of cryptoOk) {
    const chain = p.currency || 'unknown';
    crypto.byChain[chain] = round2((crypto.byChain[chain] || 0) + num(p.amount_usd));
  }

  // ── Card payments ──
  const cardTx = raw.cardTransactions?.transactions || [];
  const windowCards = cardTx.filter((t) => within(t.created_at, since));
  const cardOk = windowCards.filter((t) => CARD_SUCCESS.has(String(t.status).toLowerCase()));
  const cardFailed = windowCards.filter((t) => CARD_FAILED.has(String(t.status).toLowerCase()));
  const cardRefunded = windowCards.filter((t) => CARD_REFUNDED.has(String(t.status).toLowerCase()));
  const cents = (t, key) => num(t[key]) / 100;
  const card = {
    volumeUsd: round2(cardOk.reduce((s, t) => s + cents(t, 'amount_cents'), 0)),
    platformFeesUsd: round2(cardOk.reduce((s, t) => s + cents(t, 'platform_fee_amount'), 0)),
    stripeFeesUsd: round2(cardOk.reduce((s, t) => s + cents(t, 'stripe_fee_amount'), 0)),
    netUsd: round2(cardOk.reduce((s, t) => s + cents(t, 'net_to_merchant'), 0)),
    refundedUsd: round2(cardRefunded.reduce((s, t) => s + cents(t, 'amount_cents'), 0)),
    successful: cardOk.length,
    failed: cardFailed.length,
    refunded: cardRefunded.length,
    total: windowCards.length,
    partial: Boolean(raw.cardTransactions?.pagination?.has_more),
  };

  // ── Server-side analytics (complete over the window, unlike the pages above) ──
  const analytics = raw.analytics || null;
  const series = (analytics?.series?.points || []).map((pt) => ({
    label: pt.label,
    volumeUsd: num(pt.total_volume_usd),
    cryptoUsd: num(pt.crypto_volume_usd),
    cardUsd: num(pt.card_volume_usd),
    commissionUsd: num(pt.total_commission_usd),
    count: num(pt.total_count),
  }));

  const grossVolumeUsd = analytics
    ? num(analytics.combined?.total_volume_usd)
    : round2(crypto.volumeUsd + card.volumeUsd);
  const commissionUsd = analytics
    ? num(analytics.combined?.total_fees_usd)
    : round2(crypto.feesUsd + card.platformFeesUsd);

  // ── Escrow ──
  const escrows = raw.escrows?.escrows || raw.escrows?.data || (Array.isArray(raw.escrows) ? raw.escrows : []);
  const escrowStatus = (e) => String(e.status || '').toLowerCase();
  const escrowRefunded = escrows.filter((e) => escrowStatus(e) === 'refunded' && within(e.settled_at || e.refunded_at || e.updated_at, since));
  const escrowHeld = escrows.filter((e) => ['funded', 'disputed', 'pending_release'].includes(escrowStatus(e)));
  const escrowReleased = escrows.filter((e) => ['released', 'settled', 'completed'].includes(escrowStatus(e)) && within(e.settled_at || e.released_at || e.updated_at, since));
  const escrowFeeUsd = (e) => {
    if (!e.fee_tx_hash) return 0;
    const fee = num(e.fee_amount);
    const amount = num(e.amount);
    return fee > 0 && amount > 0 ? (fee / amount) * num(e.amount_usd) : 0;
  };
  const escrow = {
    heldUsd: round2(escrowHeld.reduce((s, e) => s + num(e.amount_usd), 0)),
    held: escrowHeld.length,
    releasedUsd: round2(escrowReleased.reduce((s, e) => s + num(e.amount_usd), 0)),
    released: escrowReleased.length,
    refundedUsd: round2(escrowRefunded.reduce((s, e) => s + num(e.amount_usd), 0)),
    refunded: escrowRefunded.length,
    feesUsd: round2(escrowReleased.reduce((s, e) => s + escrowFeeUsd(e), 0)),
    total: escrows.length,
  };

  // ── Invoices ──
  const invoices = raw.invoices?.invoices || raw.invoices?.data || (Array.isArray(raw.invoices) ? raw.invoices : []);
  const invStatus = (i) => String(i.status || '').toLowerCase();
  const isOverdue = (i) => ['sent', 'overdue'].includes(invStatus(i)) && i.due_date && new Date(i.due_date).getTime() < now.getTime();
  const invoiceTotals = { draft: 0, outstanding: 0, overdue: 0, paid: 0, cancelled: 0 };
  const invoiceCounts = { draft: 0, outstanding: 0, overdue: 0, paid: 0, cancelled: 0 };
  for (const inv of invoices) {
    const amount = num(inv.amount);
    const status = invStatus(inv);
    let bucket;
    if (status === 'draft') bucket = 'draft';
    else if (status === 'paid') {
      if (!within(inv.paid_at || inv.updated_at, since)) continue;
      bucket = 'paid';
    } else if (status === 'cancelled' || status === 'canceled') bucket = 'cancelled';
    else if (isOverdue(inv)) bucket = 'overdue';
    else bucket = 'outstanding';
    invoiceTotals[bucket] = round2(invoiceTotals[bucket] + amount);
    invoiceCounts[bucket] += 1;
  }

  // ── Payouts (card rail → bank) ──
  const payouts = raw.payouts?.payouts || [];
  const windowPayouts = payouts.filter((p) => within(p.created_at, since));
  const payout = {
    paidUsd: round2(windowPayouts.filter((p) => String(p.status).toLowerCase() === 'paid').reduce((s, p) => s + num(p.amount_cents) / 100, 0)),
    pendingUsd: round2(windowPayouts.filter((p) => ['pending', 'in_transit'].includes(String(p.status).toLowerCase())).reduce((s, p) => s + num(p.amount_cents) / 100, 0)),
    count: windowPayouts.length,
  };

  // ── Bank & cards ──
  const summary = raw.summary || null;
  const accounts = (raw.accounts || []).slice().sort((a, b) => Math.abs(num(b.display_balance ?? b.balance)) - Math.abs(num(a.display_balance ?? a.balance)));
  const primary = summary?.totals?.find((t) => t.currency === summary.primaryCurrency) || summary?.totals?.[0] || null;
  const bank = {
    currency: summary?.primaryCurrency || primary?.currency || 'USD',
    assets: round2(num(primary?.assets)),
    liabilities: round2(num(primary?.liabilities)),
    net: round2(num(primary?.net)),
    accountCount: summary?.accountCount ?? accounts.length,
    hiddenCount: summary?.hiddenCount ?? 0,
    transactionCount: summary?.transactionCount ?? 0,
    cashflow: {
      moneyIn: round2(num(summary?.cashflow?.moneyIn)),
      moneyOut: round2(num(summary?.cashflow?.moneyOut)),
      net: round2(num(summary?.cashflow?.net)),
      transactions: summary?.cashflow?.transactions ?? 0,
    },
    byKind: summary?.byKind || [],
    byInstitution: (summary?.byInstitution || []).slice().sort((a, b) => (b.assets + b.liabilities) - (a.assets + a.liabilities)),
    topCategories: summary?.topCategories || [],
    newestTransaction: summary?.newestTransaction || null,
    accounts,
    creditCards: accounts.filter((a) => (a.effective_kind || a.kind) === 'credit'),
    connections: raw.connections?.connections || [],
    plaidEnabled: Boolean(raw.connections?.plaidEnabled),
    ledger: raw.transactions?.rows || [],
    ledgerTotal: raw.transactions?.total ?? 0,
  };

  const refundsUsd = round2(card.refundedUsd + escrow.refundedUsd);
  const stats = raw.stats || null;

  return {
    generatedAt: now.toISOString(),
    windowDays: days,
    plan: stats?.plan || null,
    businesses: stats?.businesses || [],
    earnings: {
      grossVolumeUsd: round2(grossVolumeUsd),
      cryptoVolumeUsd: analytics ? num(analytics.crypto?.total_volume_usd) : crypto.volumeUsd,
      cardVolumeUsd: analytics ? num(analytics.card?.total_volume_usd) : card.volumeUsd,
      commissionUsd: round2(commissionUsd),
      stripeFeesUsd: card.stripeFeesUsd,
      refundsUsd,
      netUsd: round2(grossVolumeUsd - commissionUsd - card.stripeFeesUsd - refundsUsd),
      transactions: analytics ? num(analytics.combined?.successful_transactions) : crypto.successful + card.successful,
      failed: analytics ? num(analytics.combined?.failed_transactions) : crypto.failed + card.failed,
      failureRate: analytics ? num(analytics.combined?.failure_rate) : 0,
    },
    series,
    crypto,
    card,
    escrow,
    invoices: { totals: invoiceTotals, counts: invoiceCounts, rows: invoices },
    payout,
    bank,
    recent: {
      payments: payments.slice(0, 50),
      cards: cardTx.slice(0, 50),
      escrows: escrows.slice(0, 50),
    },
    errors,
  };
}

/**
 * Fetch everything and build a snapshot. Routes fail independently: a 500
 * from one of them lands in `snapshot.errors[name]` and its section is empty.
 */
export async function collectFinanceSnapshot(client, { days = 30, limit = 100, businessId } = {}) {
  const since = Number.isFinite(days) && days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : undefined;
  const sources = {
    summary: () => getFinanceSummary(client, { days }),
    accounts: () => listFinanceAccounts(client),
    transactions: () => listFinanceTransactions(client, { limit, startDate: since }),
    connections: () => listFinanceConnections(client),
    stats: () => getDashboardStats(client, { businessId }),
    analytics: () => getFinanceAnalytics(client, { period: periodForDays(days), businessId }),
    payments: () => listCryptoPayments(client, { limit, businessId, dateFrom: since }),
    cardTransactions: () => listCardTransactions(client, { limit, businessId, dateFrom: since }),
    // Raw route on purpose: the SDK's listEscrows camel-cases fields and the
    // snapshot reads the API's snake_case shape like every other source.
    escrows: () => client.request(`/escrow${query({ limit })}`),
    invoices: () => client.request('/invoices'),
    payouts: () => listCardPayouts(client, { limit }),
  };

  const names = Object.keys(sources);
  const settled = await Promise.allSettled(names.map((name) => sources[name]()));
  const raw = { errors: {} };
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') raw[names[i]] = result.value;
    else raw.errors[names[i]] = result.reason?.message || String(result.reason);
  });

  // One failing source is a hole in the picture; every source failing means
  // the API or the session is gone, and a page of zeros would be a lie.
  if (Object.keys(raw.errors).length === names.length) {
    const first = raw.errors[names[0]];
    throw new Error(`Could not load finances: ${first}`);
  }

  return buildFinanceSnapshot(raw, { days });
}

/**
 * Subscribe to the merchant's live payment stream (server-sent events).
 *
 * Takes the API base URL and the merchant session token explicitly (the
 * client keeps its key private). `onEvent` receives parsed events (`connected`, `heartbeat`, `payment_*`).
 * Returns a function that closes the stream. Reconnects itself with backoff
 * until closed, so a dropped connection is a gap, not the end.
 */
export function subscribeToPayments({ baseUrl, token, onEvent, onStatus, businessId } = {}) {
  if (!baseUrl || !token) throw new Error('subscribeToPayments needs baseUrl and token');
  baseUrl = baseUrl.replace(/\/$/, '');
  let closed = false;
  let controller = null;
  let attempt = 0;

  const status = (s, detail) => { try { onStatus?.(s, detail); } catch { /* listener error */ } };

  async function connect() {
    while (!closed) {
      controller = new AbortController();
      try {
        status('connecting');
        const res = await fetch(`${baseUrl}/realtime/payments${query({ businessId })}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        attempt = 0;
        status('connected');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
            if (!data) continue;
            try { onEvent?.(JSON.parse(data)); } catch { /* not JSON */ }
          }
        }
        if (!closed) status('disconnected');
      } catch (err) {
        if (closed) return;
        status('error', err?.message || String(err));
      }
      if (closed) return;
      attempt += 1;
      const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  void connect();

  return () => {
    closed = true;
    try { controller?.abort(); } catch { /* already gone */ }
    status('closed');
  };
}
