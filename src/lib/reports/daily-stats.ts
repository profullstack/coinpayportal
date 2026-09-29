/**
 * CoinPayPortal daily stats report: the counts, and the email built from them.
 *
 * Used by the cron route (POST /api/cron/daily-stats, which runs inside the app
 * so it always reads the production database with the production keys) and by
 * scripts/daily-stats-email.ts for a manual run.
 *
 * Every query failure THROWS, and nothing is sent. The old script turned a
 * failed query into 0 and carried on, so a report pointed at the wrong
 * database, or a column that no longer exists (`payments.amount_usd` was never
 * a column, so "Volume" was always $0), mailed confident-looking zeros. A
 * report with a hole in it is worse than no report.
 *
 * Imports are relative, not `@/`, so the manual script can load this with tsx.
 */

import { checkSpamSignup } from '../auth/spam-detection';
import { escapeHtml } from '../email/escape';
import { sendEmail } from '../email';

type Client = { from: (table: string) => any };

export const DAILY_STATS_TO = 'anthony@profullstack.com';
export const DAILY_STATS_FROM =
  process.env.STATS_FROM_EMAIL || 'CoinPay Stats <stats@coinpayportal.com>';

/** Same meaning as the nightly merchant summary: money that actually arrived. */
const SETTLED_STATUSES = ['confirmed', 'forwarded', 'completed'];

/** PostgREST caps a response at 1000 rows; page under that. */
const PAGE = 1000;

export class DailyStatsQueryError extends Error {
  constructor(what: string, message: string) {
    super(`daily stats: ${what} failed: ${message}`);
    this.name = 'DailyStatsQueryError';
  }
}

export interface DailyStats {
  date: string;
  merchants: { total: number; new24h: number; new7d: number; new30d: number };
  recentMerchants: { name: string | null; email: string | null; created_at: string | null }[];
  wallets: { total: number; addresses: number; transactions: number; new24h: number; newTxs24h: number };
  payments: {
    total: number;
    confirmed: number;
    forwarded: number;
    pending: number;
    expired: number;
    new24h: number;
    /** Sum of `amount` over settled USD payments. */
    settledUsd: number;
    lastPaymentAt: string | null;
  };
  escrows: { total: number; funded: number; new24h: number };
  businesses: { total: number; new24h: number; new7d: number; new30d: number };
  recentBusinesses: { name: string | null; created_at: string | null }[];
  integrations: {
    withApiKey: number;
    newApiKeys24h: number;
    stripeAccounts: number;
    newStripeAccounts24h: number;
    oauthClients: number;
    newOauthClients24h: number;
    withWebhook: number;
  };
  subscriptions: { total: number; active: number; new24h: number };
  invoices: { total: number; paid: number; new24h: number };
  reputation: { receipts: number; new24h: number };
  spam: { total: number; suspicious: number; wouldBlock: number };
}

function errMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function sinceIso(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 3600_000).toISOString();
}

async function readCount(what: string, query: PromiseLike<{ count: number | null; error: unknown }>) {
  const { count, error } = await query;
  if (error) throw new DailyStatsQueryError(what, errMessage(error));
  if (typeof count !== 'number') throw new DailyStatsQueryError(what, 'no count returned');
  return count;
}

function count(supabase: Client, table: string, filter?: Record<string, string>) {
  let q = supabase.from(table).select('*', { count: 'exact', head: true });
  for (const [col, val] of Object.entries(filter ?? {})) q = q.eq(col, val);
  return readCount(`count(${table}${filter ? ` ${JSON.stringify(filter)}` : ''})`, q);
}

function countSince(supabase: Client, table: string, col: string, since: string, label: string) {
  const q = supabase.from(table).select('*', { count: 'exact', head: true }).gte(col, since);
  return readCount(`countSince(${table}, ${label})`, q);
}

function countNotNull(supabase: Client, table: string, col: string) {
  const q = supabase.from(table).select('*', { count: 'exact', head: true }).not(col, 'is', null);
  return readCount(`countNotNull(${table}.${col})`, q);
}

function countSinceNotNull(supabase: Client, table: string, tsCol: string, col: string, since: string) {
  const q = supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .gte(tsCol, since)
    .not(col, 'is', null);
  return readCount(`countSinceNotNull(${table}.${col}, 24h)`, q);
}

async function recent<T>(supabase: Client, table: string, columns: string, limit: number): Promise<T[]> {
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new DailyStatsQueryError(`recent(${table})`, errMessage(error));
  return (data ?? []) as T[];
}

/** Every row of a select, paged by id so a table past 1000 rows is not truncated. */
async function allRows<T>(
  what: string,
  build: () => { order: (col: string, opts: object) => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: unknown }> } }
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new DailyStatsQueryError(what, errMessage(error));
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function settledUsd(supabase: Client): Promise<number> {
  const rows = await allRows<{ amount: string | number | null }>('sum(payments.amount settled USD)', () =>
    supabase.from('payments').select('id, amount').in('status', SETTLED_STATUSES).eq('currency', 'USD')
  );
  return rows.reduce((sum, r) => {
    const n = Number(r.amount);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

async function lastPaymentAt(supabase: Client): Promise<string | null> {
  const rows = await recent<{ created_at: string | null }>(supabase, 'payments', 'created_at', 1);
  return rows[0]?.created_at ?? null;
}

async function spamStats(supabase: Client): Promise<DailyStats['spam']> {
  const merchants = await allRows<{ name: string | null; email: string | null }>('spam scan(merchants)', () =>
    supabase.from('merchants').select('id, name, email')
  );
  let suspicious = 0;
  let wouldBlock = 0;
  for (const m of merchants) {
    const result = checkSpamSignup({ name: m.name || '', email: m.email || '' });
    if (result.blocked) wouldBlock++;
    else if (result.score > 0) suspicious++;
  }
  return { total: merchants.length, suspicious, wouldBlock };
}

export async function collectDailyStats(supabase: Client, now: Date = new Date()): Promise<DailyStats> {
  const d1 = sinceIso(now, 24);
  const d7 = sinceIso(now, 24 * 7);
  const d30 = sinceIso(now, 24 * 30);

  const [
    merchantsTotal, merchants24h, merchants7d, merchants30d, recentMerchants,
    walletsTotal, walletAddrs, walletTxs, wallets24h, walletTxs24h,
    payTotal, payConfirmed, payForwarded, payPending, payExpired, pay24h, paySettledUsd, payLast,
    escrowsTotal, escrowsFunded, escrows24h,
    bizTotal, biz24h, biz7d, biz30d, recentBusinesses,
    withApiKey, newApiKeys24h, stripeAccounts, stripe24h, oauthClients, oauth24h, withWebhook,
    subsTotal, subsActive, subs24h,
    invTotal, invPaid, inv24h,
    receipts, receipts24h,
    spam,
  ] = await Promise.all([
    count(supabase, 'merchants'),
    countSince(supabase, 'merchants', 'created_at', d1, '24h'),
    countSince(supabase, 'merchants', 'created_at', d7, '7d'),
    countSince(supabase, 'merchants', 'created_at', d30, '30d'),
    recent<DailyStats['recentMerchants'][number]>(supabase, 'merchants', 'name, email, created_at', 5),

    count(supabase, 'wallets'),
    count(supabase, 'wallet_addresses'),
    count(supabase, 'wallet_transactions'),
    countSince(supabase, 'wallets', 'created_at', d1, '24h'),
    countSince(supabase, 'wallet_transactions', 'created_at', d1, '24h'),

    // payments.status: pending | confirmed | forwarding | forwarded | forwarding_failed | expired
    count(supabase, 'payments'),
    count(supabase, 'payments', { status: 'confirmed' }),
    count(supabase, 'payments', { status: 'forwarded' }),
    count(supabase, 'payments', { status: 'pending' }),
    count(supabase, 'payments', { status: 'expired' }),
    countSince(supabase, 'payments', 'created_at', d1, '24h'),
    settledUsd(supabase),
    lastPaymentAt(supabase),

    count(supabase, 'escrows'),
    count(supabase, 'escrows', { status: 'funded' }),
    countSince(supabase, 'escrows', 'created_at', d1, '24h'),

    count(supabase, 'businesses'),
    countSince(supabase, 'businesses', 'created_at', d1, '24h'),
    countSince(supabase, 'businesses', 'created_at', d7, '7d'),
    countSince(supabase, 'businesses', 'created_at', d30, '30d'),
    recent<DailyStats['recentBusinesses'][number]>(supabase, 'businesses', 'name, created_at', 5),

    countNotNull(supabase, 'businesses', 'api_key'),
    countSinceNotNull(supabase, 'businesses', 'api_key_created_at', 'api_key', d1),
    count(supabase, 'stripe_accounts'),
    countSince(supabase, 'stripe_accounts', 'created_at', d1, '24h'),
    count(supabase, 'oauth_clients'),
    countSince(supabase, 'oauth_clients', 'created_at', d1, '24h'),
    countNotNull(supabase, 'businesses', 'webhook_url'),

    count(supabase, 'subscriptions'),
    count(supabase, 'subscriptions', { status: 'active' }),
    countSince(supabase, 'subscriptions', 'created_at', d1, '24h'),

    count(supabase, 'invoices'),
    count(supabase, 'invoices', { status: 'paid' }),
    countSince(supabase, 'invoices', 'created_at', d1, '24h'),

    count(supabase, 'reputation_receipts'),
    countSince(supabase, 'reputation_receipts', 'created_at', d1, '24h'),

    spamStats(supabase),
  ]);

  const stats: DailyStats = {
    date: now.toISOString().split('T')[0],
    merchants: { total: merchantsTotal, new24h: merchants24h, new7d: merchants7d, new30d: merchants30d },
    recentMerchants,
    wallets: {
      total: walletsTotal,
      addresses: walletAddrs,
      transactions: walletTxs,
      new24h: wallets24h,
      newTxs24h: walletTxs24h,
    },
    payments: {
      total: payTotal,
      confirmed: payConfirmed,
      forwarded: payForwarded,
      pending: payPending,
      expired: payExpired,
      new24h: pay24h,
      settledUsd: paySettledUsd,
      lastPaymentAt: payLast,
    },
    escrows: { total: escrowsTotal, funded: escrowsFunded, new24h: escrows24h },
    businesses: { total: bizTotal, new24h: biz24h, new7d: biz7d, new30d: biz30d },
    recentBusinesses,
    integrations: {
      withApiKey,
      newApiKeys24h,
      stripeAccounts,
      newStripeAccounts24h: stripe24h,
      oauthClients,
      newOauthClients24h: oauth24h,
      withWebhook,
    },
    subscriptions: { total: subsTotal, active: subsActive, new24h: subs24h },
    invoices: { total: invTotal, paid: invPaid, new24h: inv24h },
    reputation: { receipts, new24h: receipts24h },
    spam,
  };

  // CoinPay has had merchants, businesses and payments since launch. A zero in
  // any of them means the report is reading the wrong database (an empty one,
  // or one whose rows RLS hides), not a quiet day.
  const core: [string, number][] = [
    ['merchants', stats.merchants.total],
    ['businesses', stats.businesses.total],
    ['payments', stats.payments.total],
  ];
  for (const [table, n] of core) {
    if (n === 0) {
      throw new DailyStatsQueryError(
        `count(${table})`,
        'returned 0; the report is not reading the production database (check NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)'
      );
    }
  }

  return stats;
}

function usd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function day(ts: string | null | undefined): string {
  return ts ? String(ts).slice(0, 10) : '?';
}

export function renderDailyStats(s: DailyStats): { subject: string; html: string; text: string } {
  const { merchants: m, wallets: w, payments: p, escrows: e, businesses: b, integrations: i } = s;

  const text = `
CoinPayPortal Daily Report - ${s.date}
${'='.repeat(50)}

MERCHANTS
  Total: ${m.total}
  New (24h): ${m.new24h}
  New (7d): ${m.new7d}
  New (30d): ${m.new30d}

RECENT SIGNUPS
${s.recentMerchants.map((r) => `  - ${r.name || '(no name)'} <${r.email ?? ''}> (${day(r.created_at)})`).join('\n') || '  (none)'}

WALLETS
  Total: ${w.total}
  Addresses: ${w.addresses}
  Transactions: ${w.transactions}
  New wallets (24h): ${w.new24h}
  New txs (24h): ${w.newTxs24h}

PAYMENTS
  Total: ${p.total}
  Confirmed: ${p.confirmed}
  Forwarded: ${p.forwarded}
  Pending: ${p.pending}
  Expired: ${p.expired}
  New (24h): ${p.new24h}
  Settled volume (USD): ${usd(p.settledUsd)}
  Last payment created: ${p.lastPaymentAt ?? '(none)'}

ESCROWS
  Total: ${e.total}
  Funded: ${e.funded}
  New (24h): ${e.new24h}

BUSINESSES
  Total: ${b.total}
  New (24h): ${b.new24h}
  New (7d): ${b.new7d}
  New (30d): ${b.new30d}
${s.recentBusinesses.map((r) => `  - ${r.name || '(no name)'} (${day(r.created_at)})`).join('\n') || '  (none)'}

INTEGRATIONS
  Businesses with API key: ${i.withApiKey}
  New API keys (24h): ${i.newApiKeys24h}
  Stripe accounts connected: ${i.stripeAccounts}
  New Stripe (24h): ${i.newStripeAccounts24h}
  OAuth apps registered: ${i.oauthClients}
  New OAuth apps (24h): ${i.newOauthClients24h}
  Businesses with webhook: ${i.withWebhook}

SUBSCRIPTIONS
  Total: ${s.subscriptions.total}
  Active: ${s.subscriptions.active}
  New (24h): ${s.subscriptions.new24h}

INVOICES
  Total: ${s.invoices.total}
  Paid: ${s.invoices.paid}
  New (24h): ${s.invoices.new24h}

REPUTATION
  Receipts: ${s.reputation.receipts}
  New (24h): ${s.reputation.new24h}

SPAM DETECTION
  Current merchants: ${s.spam.total}
  Suspicious (score > 0): ${s.spam.suspicious}
  Would be blocked today: ${s.spam.wouldBlock}
`.trim();

  const row = (label: string, value: string | number, style = '') =>
    `<tr><td style="padding: 4px 0;">${label}</td><td style="text-align: right;${style}">${escapeHtml(value)}</td></tr>`;
  const green = (n: number) => ` color: ${n > 0 ? '#16a34a' : '#666'};`;
  const bold = ' font-weight: bold;';
  const h2 = (t: string) => `<h2 style="font-size: 16px; color: #7c3aed; margin: 0 0 12px;">${t}</h2>`;
  const table = (rows: string[], mb = 20) =>
    `<table style="width: 100%; font-size: 14px; margin-bottom: ${mb}px;">${rows.join('')}</table>`;

  const recentMerchantsHtml = s.recentMerchants.length
    ? `<h3 style="font-size: 14px; color: #666; margin: 0 0 8px;">Recent Signups</h3>
    <ul style="font-size: 13px; padding-left: 20px; margin: 0 0 20px;">
      ${s.recentMerchants
        .map(
          (r) =>
            `<li style="margin-bottom: 4px;"><strong>${escapeHtml(r.name || '(no name)')}</strong> - ${escapeHtml(r.email)} <span style="color: #999;">(${escapeHtml(day(r.created_at))})</span></li>`
        )
        .join('')}
    </ul>`
    : '';

  const recentBusinessesHtml = s.recentBusinesses.length
    ? `<ul style="font-size: 13px; padding-left: 20px; margin: 0 0 20px;">
      ${s.recentBusinesses
        .map(
          (r) =>
            `<li style="margin-bottom: 4px;"><strong>${escapeHtml(r.name || '(no name)')}</strong> <span style="color: #999;">(${escapeHtml(day(r.created_at))})</span></li>`
        )
        .join('')}
    </ul>`
    : '<div style="margin-bottom: 20px;"></div>';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a2e; background: #f8f9fa;">
  <div style="background: #1a1a2e; color: white; padding: 20px 24px; border-radius: 12px 12px 0 0;">
    <h1 style="margin: 0; font-size: 20px;">CoinPayPortal Daily Report</h1>
    <p style="margin: 4px 0 0; opacity: 0.7; font-size: 14px;">${escapeHtml(s.date)}</p>
  </div>
  <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #e0e0e0; border-top: none;">
    ${h2('Merchants')}
    ${table([
      row('Total', m.total, bold),
      row('New (24h)', m.new24h, bold + green(m.new24h)),
      row('New (7d)', m.new7d),
      row('New (30d)', m.new30d),
    ])}
    ${recentMerchantsHtml}
    ${h2('Wallets &amp; Transactions')}
    ${table([
      row('Wallets', w.total, bold),
      row('Addresses', w.addresses),
      row('Transactions', w.transactions, bold),
      row('New wallets (24h)', w.new24h, green(w.new24h)),
      row('New txs (24h)', w.newTxs24h, green(w.newTxs24h)),
    ])}
    ${h2('Payments')}
    ${table([
      row('Total', p.total, bold),
      row('Confirmed', p.confirmed),
      row('Forwarded', p.forwarded),
      row('Pending', p.pending),
      row('Expired', p.expired),
      row('New (24h)', p.new24h, green(p.new24h)),
      row('Settled volume (USD)', usd(p.settledUsd), bold + ' color: #16a34a;'),
      row('Last payment created', p.lastPaymentAt ? p.lastPaymentAt.slice(0, 16).replace('T', ' ') + ' UTC' : '(none)'),
    ])}
    ${h2('Escrows')}
    ${table([row('Total', e.total), row('Funded', e.funded), row('New (24h)', e.new24h)])}
    ${h2('Businesses')}
    ${table(
      [
        row('Total', b.total, bold),
        row('New (24h)', b.new24h, bold + green(b.new24h)),
        row('New (7d)', b.new7d),
        row('New (30d)', b.new30d),
      ],
      12
    )}
    ${recentBusinessesHtml}
    ${h2('Integrations')}
    ${table([
      row('Businesses with API key', i.withApiKey, bold),
      row('New API keys (24h)', i.newApiKeys24h, green(i.newApiKeys24h)),
      row('Stripe accounts connected', i.stripeAccounts),
      row('New Stripe accounts (24h)', i.newStripeAccounts24h, green(i.newStripeAccounts24h)),
      row('OAuth apps registered', i.oauthClients),
      row('New OAuth apps (24h)', i.newOauthClients24h, green(i.newOauthClients24h)),
      row('Businesses with webhook', i.withWebhook),
    ])}
    ${h2('Subscriptions')}
    ${table([
      row('Total', s.subscriptions.total, bold),
      row('Active', s.subscriptions.active, green(s.subscriptions.active)),
      row('New (24h)', s.subscriptions.new24h, green(s.subscriptions.new24h)),
    ])}
    ${h2('Invoices')}
    ${table([
      row('Total', s.invoices.total, bold),
      row('Paid', s.invoices.paid),
      row('New (24h)', s.invoices.new24h, green(s.invoices.new24h)),
    ])}
    ${h2('Reputation')}
    ${table([row('Total receipts', s.reputation.receipts), row('New (24h)', s.reputation.new24h, green(s.reputation.new24h))])}
    ${h2('Spam Detection')}
    ${table([
      row('Current merchants', s.spam.total),
      row('Suspicious (not blocked)', s.spam.suspicious, ` color: ${s.spam.suspicious > 0 ? '#d97706' : '#666'};`),
      row('Would be blocked today', s.spam.wouldBlock, ` color: ${s.spam.wouldBlock > 0 ? '#dc2626' : '#666'};`),
    ])}
  </div>
  <p style="text-align: center; font-size: 12px; color: #999; margin-top: 16px;">
    Sent by CoinPayPortal Stats · <a href="https://coinpayportal.com" style="color: #7c3aed;">coinpayportal.com</a>
  </p>
</body>
</html>
`.trim();

  return {
    subject: `CoinPayPortal Daily - ${s.date} | ${m.total} merchants, ${p.total} payments, ${usd(p.settledUsd)} settled`,
    html,
    text,
  };
}

/** Sends through the app's mailer (Resend when RESEND_API_KEY is set). Throws on failure. */
export async function sendDailyStatsEmail(
  report: { subject: string; html: string },
  to: string = DAILY_STATS_TO
): Promise<string | undefined> {
  const result = await sendEmail({ to, subject: report.subject, html: report.html, from: DAILY_STATS_FROM });
  if (!result.success) throw new Error(result.error || 'email send failed');
  return result.messageId;
}
