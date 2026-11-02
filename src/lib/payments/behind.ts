/**
 * Who's behind: every customer who owes a business money or whose payment
 * failed, grouped by what to do about it.
 *
 * The aging report answers "how much, how late". This answers "who, and what
 * now": it joins overdue invoices and failed card payments for the same person
 * (matched by email within a business), puts each person under the one action
 * that fits them, and says whether this is a habit or a first miss
 * ("paying since March, never missed before").
 *
 * Pure: rows in, report out. The route does the querying.
 */
import { explainDecline, type DeclineAction } from './decline-reasons';

export type BehindAction =
  | 'do_not_chase'
  | 'unreachable'
  | 'retry'
  | 'new_card'
  | 'unfinished'
  | 'call_bank'
  | 'chase'
  | 'remind';

/** Display order, and the one-line instruction for each group. */
export const BEHIND_GROUPS: Array<{ action: BehindAction; title: string; todo: string }> = [
  { action: 'unreachable', title: "Your invoice didn't reach them", todo: 'Check their email address and resend the invoice.' },
  { action: 'chase', title: 'More than 30 days late', todo: 'Contact them personally; reminders have not worked.' },
  { action: 'remind', title: 'Overdue invoices', todo: 'Send a reminder with the payment link.' },
  { action: 'retry', title: 'Likely to go through on a retry', todo: 'Send the payment link again in a few days.' },
  { action: 'new_card', title: 'Needs a different card', todo: 'Ask them to pay with another card or method.' },
  { action: 'unfinished', title: "Didn't finish paying", todo: 'Send the link again and ask if they still want it.' },
  { action: 'call_bank', title: 'Declined without a reason', todo: 'Ask them to call their bank or pay another way.' },
  { action: 'do_not_chase', title: "Don't retry: the bank flagged the card", todo: 'Do not charge this card again. Tell the customer only that it was declined.' },
];

export const PAID_CARD_STATUSES = new Set(['completed', 'succeeded', 'paid', 'confirmed', 'refunded']);
const DAY = 86_400_000;

export interface CardRow {
  id: string;
  business_id: string | null;
  amount: number | string | null; // minor units
  currency: string | null;
  status: string;
  customer_name?: string | null;
  customer_email?: string | null;
  failure_reason?: string | null;
  failure_code?: string | null;
  created_at: string;
  businesses?: { name: string | null } | null;
}

export interface InvoiceRow {
  id: string;
  business_id: string | null;
  invoice_number?: string | null;
  status: string;
  currency: string | null;
  amount: number | string | null; // major units
  due_date: string | null;
  paid_at?: string | null;
  created_at: string;
  email_status?: string | null;
  email_last_error?: string | null;
  client_id?: string | null;
  clients?: { name: string | null; company_name: string | null; email: string | null } | null;
  businesses?: { name: string | null } | null;
}

export interface BehindItem {
  kind: 'invoice' | 'card';
  id: string;
  amount: number; // major units
  currency: string;
  date: string;
  title: string;
  detail: string;
  href: string;
}

export interface BehindCustomer {
  key: string;
  name: string;
  email: string | null;
  business_id: string | null;
  business_name: string | null;
  action: BehindAction;
  /** Per currency, major units. */
  owed: Array<{ currency: string; amount: number }>;
  items: BehindItem[];
  history: {
    paid_count: number;
    first_paid_at: string | null;
    last_paid_at: string | null;
    missed_before: number;
    /** e.g. "Paying since Mar 2026 · never missed before" */
    line: string;
  };
}

export interface BehindReport {
  as_of: string;
  summary: string;
  totals: Array<{ currency: string; amount: number }>;
  counts: { customers: number; invoices: number; card_failures: number };
  groups: Array<{ action: BehindAction; title: string; todo: string; customers: BehindCustomer[] }>;
}

interface Acc {
  key: string;
  name: string;
  email: string | null;
  business_id: string | null;
  business_name: string | null;
  cards: CardRow[];
  invoices: InvoiceRow[];
}

const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase();
const cents = (major: number) => Math.round(major * 100);
const fmtMonth = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function customerKey(businessId: string | null, email: string, fallback: string): string {
  return `${businessId ?? 'none'}|${email ? `email:${email}` : fallback}`;
}

function isOpenInvoice(inv: InvoiceRow, now: Date): boolean {
  if (inv.status === 'overdue') return true;
  return inv.status === 'sent' && !!inv.due_date && new Date(inv.due_date).getTime() < now.getTime();
}

function daysLate(inv: InvoiceRow, now: Date): number {
  if (!inv.due_date) return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(inv.due_date).getTime()) / DAY));
}

export interface BuildOptions {
  now?: Date;
  /** Card failures older than this, with nothing paid since, are dropped as stale. */
  cardWindowDays?: number;
}

export function buildBehindReport(cards: CardRow[], invoices: InvoiceRow[], opts: BuildOptions = {}): BehindReport {
  const now = opts.now ?? new Date();
  const windowStart = now.getTime() - (opts.cardWindowDays ?? 90) * DAY;
  const people = new Map<string, Acc>();

  const touch = (key: string, init: Omit<Acc, 'cards' | 'invoices' | 'key'>): Acc => {
    let acc = people.get(key);
    if (!acc) {
      acc = { key, ...init, cards: [], invoices: [] };
      people.set(key, acc);
    } else {
      // Prefer a real name over an email, and fill gaps from later rows.
      if ((!acc.name || acc.name === acc.email) && init.name && init.name !== init.email) acc.name = init.name;
      if (!acc.business_name && init.business_name) acc.business_name = init.business_name;
    }
    return acc;
  };

  for (const c of cards) {
    const email = norm(c.customer_email);
    const name = (c.customer_name || '').trim();
    const key = customerKey(c.business_id, email, name ? `name:${norm(name)}` : `card:${c.id}`);
    touch(key, {
      name: name || c.customer_email || 'Unknown customer',
      email: c.customer_email ?? null,
      business_id: c.business_id,
      business_name: c.businesses?.name ?? null,
    }).cards.push(c);
  }

  for (const inv of invoices) {
    const email = norm(inv.clients?.email);
    const name = (inv.clients?.company_name || inv.clients?.name || '').trim();
    const key = customerKey(inv.business_id, email, inv.client_id ? `client:${inv.client_id}` : `invoice:${inv.id}`);
    touch(key, {
      name: name || inv.clients?.email || 'No client',
      email: inv.clients?.email ?? null,
      business_id: inv.business_id,
      business_name: inv.businesses?.name ?? null,
    }).invoices.push(inv);
  }

  const groups = new Map<BehindAction, BehindCustomer[]>();
  const totals = new Map<string, number>(); // cents
  let invoiceCount = 0;
  let cardCount = 0;

  for (const acc of people.values()) {
    const cardsByTime = [...acc.cards].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const lastPaidIdx = cardsByTime.map((c) => PAID_CARD_STATUSES.has(c.status)).lastIndexOf(true);
    const streak = cardsByTime
      .slice(lastPaidIdx + 1)
      .filter((c) => c.status === 'failed' && new Date(c.created_at).getTime() >= windowStart);
    const open = acc.invoices
      .filter((i) => isOpenInvoice(i, now))
      .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));

    if (streak.length === 0 && open.length === 0) continue;

    // History: what they have paid, and whether they have missed before.
    const paidDates: string[] = [];
    for (const c of cardsByTime) if (PAID_CARD_STATUSES.has(c.status)) paidDates.push(c.created_at);
    let missedBefore = cardsByTime.slice(0, Math.max(0, lastPaidIdx)).filter((c) => c.status === 'failed').length;
    for (const inv of acc.invoices) {
      if (inv.status !== 'paid') continue;
      paidDates.push(inv.paid_at || inv.created_at);
      if (inv.paid_at && inv.due_date && new Date(inv.paid_at).getTime() - new Date(inv.due_date).getTime() > DAY) {
        missedBefore++;
      }
    }
    paidDates.sort();
    const firstPaid = paidDates[0] ?? null;
    const lastPaid = paidDates[paidDates.length - 1] ?? null;
    const line = firstPaid
      ? `Paying since ${fmtMonth(firstPaid)} · ${
          missedBefore === 0 ? 'never missed before' : `missed ${missedBefore} time${missedBefore === 1 ? '' : 's'} before`
        }`
      : 'Has never paid you';

    // Items, newest card failure first so the latest reason leads.
    const items: BehindItem[] = [];
    const owed = new Map<string, number>(); // cents
    for (const inv of open) {
      const currency = (inv.currency || 'USD').toUpperCase();
      const amount = Number(inv.amount) || 0;
      const late = daysLate(inv, now);
      const undelivered = inv.email_status === 'failed';
      items.push({
        kind: 'invoice',
        id: inv.id,
        amount,
        currency,
        date: inv.due_date || inv.created_at,
        title: `Invoice ${inv.invoice_number || inv.id.slice(0, 8)}`,
        detail: undelivered
          ? `The invoice email failed${inv.email_last_error ? `: ${inv.email_last_error}` : ''}.`
          : late > 0
            ? `${late} day${late === 1 ? '' : 's'} late.`
            : 'Overdue.',
        href: `/invoices/${inv.id}`,
      });
      owed.set(currency, (owed.get(currency) ?? 0) + cents(amount));
    }
    invoiceCount += open.length;

    const declines = [...streak].reverse().map((c) => ({ row: c, ...explainDecline(c.failure_code, c.failure_reason) }));
    for (const d of declines) {
      const currency = (d.row.currency || 'usd').toUpperCase();
      const amount = (Number(d.row.amount) || 0) / 100;
      items.push({
        kind: 'card',
        id: d.row.id,
        amount,
        currency,
        date: d.row.created_at,
        title: `Card payment declined ${fmtDay(d.row.created_at)}`,
        detail: d.reason,
        href: `/transactions/${d.row.id}`,
      });
    }
    cardCount += streak.length;
    // A run of attempts at one checkout is one debt, not several: count the
    // latest attempt's amount, not the sum of the retries.
    if (declines[0]) {
      const currency = (declines[0].row.currency || 'usd').toUpperCase();
      owed.set(currency, (owed.get(currency) ?? 0) + (Number(declines[0].row.amount) || 0));
    }

    // One action per person. A fraud flag overrides everything (do not chase a
    // flagged card even if they also owe an invoice); then an invoice that never
    // arrived; then the latest card decline; then how late the invoices are.
    let action: BehindAction;
    if (declines.some((d) => d.action === 'do_not_chase')) action = 'do_not_chase';
    else if (open.some((i) => i.email_status === 'failed')) action = 'unreachable';
    else if (declines[0]) action = declines[0].action as DeclineAction;
    else if (open.some((i) => daysLate(i, now) > 30)) action = 'chase';
    else action = 'remind';

    for (const [currency, c] of owed) totals.set(currency, (totals.get(currency) ?? 0) + c);

    const customer: BehindCustomer = {
      key: acc.key,
      name: acc.name,
      email: acc.email,
      business_id: acc.business_id,
      business_name: acc.business_name,
      action,
      owed: [...owed.entries()].map(([currency, c]) => ({ currency, amount: c / 100 })),
      items,
      history: { paid_count: paidDates.length, first_paid_at: firstPaid, last_paid_at: lastPaid, missed_before: missedBefore, line },
    };
    const list = groups.get(action) ?? [];
    list.push(customer);
    groups.set(action, list);
  }

  const owedCents = (c: BehindCustomer) => c.owed.reduce((s, o) => s + cents(o.amount), 0);
  const outGroups = BEHIND_GROUPS.filter((g) => groups.has(g.action)).map((g) => ({
    ...g,
    customers: groups.get(g.action)!.sort((a, b) => owedCents(b) - owedCents(a)),
  }));
  const totalList = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([currency, c]) => ({ currency, amount: c / 100 }));
  const customers = outGroups.reduce((s, g) => s + g.customers.length, 0);

  return {
    as_of: now.toISOString(),
    summary: summarize(customers, invoiceCount, cardCount, totalList, outGroups),
    totals: totalList,
    counts: { customers, invoices: invoiceCount, card_failures: cardCount },
    groups: outGroups,
  };
}

function summarize(
  customers: number,
  invoices: number,
  cards: number,
  totals: Array<{ currency: string; amount: number }>,
  groups: Array<{ action: BehindAction; customers: BehindCustomer[] }>,
): string {
  if (customers === 0) return 'Nobody is behind. Every sent invoice is paid and no card payment is waiting on a retry.';
  const money = totals.map((t) => formatMoney(t.amount, t.currency)).join(' + ');
  const parts: string[] = [];
  if (invoices) parts.push(`${invoices} overdue invoice${invoices === 1 ? '' : 's'}`);
  if (cards) parts.push(`${cards} declined card payment${cards === 1 ? '' : 's'}`);
  let s = `${customers} customer${customers === 1 ? ' is' : 's are'} behind on ${money}: ${parts.join(' and ')}.`;
  const retry = groups.find((g) => g.action === 'retry')?.customers.length ?? 0;
  if (retry) s += ` ${retry} ${retry === 1 ? 'is' : 'are'} likely to go through on a retry.`;
  const flagged = groups.find((g) => g.action === 'do_not_chase')?.customers.length ?? 0;
  if (flagged) s += ` ${flagged} ${flagged === 1 ? 'card was' : 'cards were'} flagged by the bank; don't retry ${flagged === 1 ? 'it' : 'them'}.`;
  return s;
}
