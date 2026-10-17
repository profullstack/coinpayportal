/**
 * Accounts receivable aging: what clients owe, by how late it is.
 * Amounts stay per currency (cents internally) because mixed currencies do
 * not add up; a business invoicing only in USD sees one row.
 */

export const AGING_BUCKETS = ['current', '1_30', '31_60', '61_90', '90_plus'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
type Buckets = Record<AgingBucket, number> & { total: number };

type OpenInvoice = {
  id: string;
  currency: string | null;
  amount: string | number;
  due_date: string | null;
  client_id: string | null;
  clients?: { name: string | null; company_name: string | null; email: string | null } | null;
};

const DAY = 86_400_000;
const empty = (): Buckets => ({ current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0, total: 0 });

export function agingBucket(dueDate: string | null, now: Date): AgingBucket {
  if (!dueDate) return 'current';
  const late = Math.floor((now.getTime() - new Date(dueDate).getTime()) / DAY);
  if (late < 1) return 'current';
  if (late <= 30) return '1_30';
  if (late <= 60) return '31_60';
  if (late <= 90) return '61_90';
  return '90_plus';
}

const toMoney = (b: Buckets): Buckets =>
  Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v / 100])) as Buckets;

export function arAging(invoices: OpenInvoice[], now: Date) {
  const totals = new Map<string, Buckets>();
  const clients = new Map<string, { client_id: string | null; name: string; currency: string; buckets: Buckets; invoices: number }>();

  for (const inv of invoices) {
    const currency = inv.currency || 'USD';
    const cents = Math.round(Number(inv.amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) continue;
    const bucket = agingBucket(inv.due_date, now);

    const t = totals.get(currency) ?? empty();
    t[bucket] += cents;
    t.total += cents;
    totals.set(currency, t);

    const key = `${inv.client_id ?? 'none'}|${currency}`;
    const c = clients.get(key) ?? {
      client_id: inv.client_id,
      name: inv.clients?.company_name || inv.clients?.name || inv.clients?.email || 'No client',
      currency,
      buckets: empty(),
      invoices: 0,
    };
    c.buckets[bucket] += cents;
    c.buckets.total += cents;
    c.invoices++;
    clients.set(key, c);
  }

  return {
    as_of: now.toISOString(),
    totals: [...totals.entries()].map(([currency, b]) => ({ currency, ...toMoney(b) })),
    clients: [...clients.values()]
      .sort((a, b) => b.buckets.total - a.buckets.total)
      .map((c) => ({ client_id: c.client_id, name: c.name, currency: c.currency, invoices: c.invoices, ...toMoney(c.buckets) })),
  };
}
