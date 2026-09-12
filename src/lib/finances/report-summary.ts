import {
  sumAmounts,
  subtractAmounts,
  negateAmount,
  isNegativeAmount,
  isZeroAmount,
  toUnits,
  compareAmounts,
  formatFixed,
  displayDecimalsFor,
  type ExactAmount,
} from './decimal';
import { localDate, wallClock, addDays } from './periods';
import { categoryLabel } from './classify';
import { divideAmount, multiplyAmount, type GapEstimate } from './estimates';
import type { ReportRow, ReportAccount } from './render';

/**
 * The executive summary of a report: what a reader who will never open the
 * ledger needs to know about the period's financial health.
 *
 * Everything here is derived from the same rows the ledger prints, in exact
 * decimal, and every figure is per currency; nothing is converted. Two
 * ideas the ledger does not have:
 *
 * - "Money in" and "money out" exclude transfers between the owner's own
 *   accounts and card payments (`transfer` and `payment` categories). A
 *   paycheque moved from checking to savings is not income twice, and a card
 *   payment is not spending on top of the purchases it paid for. The gross
 *   bank flows the rest of the report uses are kept alongside, so the two
 *   never disagree silently.
 * - When the report carries an estimate for the days the institutions never
 *   supplied, the same daily-mean method is applied to money in and money
 *   out, and every month it touches is marked. Estimated figures are never
 *   folded into an observed one without saying so.
 */

export const SUMMARY_VERSION = 'finance-report-summary/1';

/** Categories that move money between the owner's own accounts. */
export const INTERNAL_CATEGORIES: ReadonlySet<string> = new Set(['transfer', 'payment']);

export interface SummaryMonth {
  /** `YYYY-MM` in the report timezone. */
  month: string;
  /** e.g. "Jan 2026". */
  label: string;
  /** Calendar days of this month that fall inside the period. */
  days: number;
  /** Days the institutions supplied data for (days minus estimated days). */
  observedDays: number;
  /** Days covered by the estimate, when the report carries one. */
  estimatedDays: number;
  rows: number;
  /** Gross bank flows, as the rest of the report defines them. */
  credits: ExactAmount;
  debits: ExactAmount;
  /** Money in and out excluding transfers and card payments. */
  income: ExactAmount;
  spending: ExactAmount;
  net: ExactAmount;
  transfersIn: ExactAmount;
  transfersOut: ExactAmount;
  /** The estimate's share of this month, null when nothing is estimated here. */
  estimatedIncome: ExactAmount | null;
  estimatedSpending: ExactAmount | null;
  /** Observed plus estimated, the figure a chart plots for this month. */
  incomeWithEstimate: ExactAmount;
  spendingWithEstimate: ExactAmount;
  netWithEstimate: ExactAmount;
  /** Running total of `netWithEstimate` from the first month. */
  cumulativeNet: ExactAmount;
}

export interface SummaryBreakdownLine {
  key: string;
  label: string;
  total: ExactAmount;
  rows: number;
  /** Fraction of the breakdown's total, 0..1, for chart geometry only. */
  share: number;
}

export interface SummaryBalance {
  accountId: string;
  name: string;
  orgName: string | null;
  kind: string;
  liability: boolean;
  /** The provider's latest balance; negative on a card means owed. */
  balance: ExactAmount | null;
  asOf: string | null;
}

export interface ReportSummary {
  version: typeof SUMMARY_VERSION;
  currency: string;
  periodStart: string;
  periodEnd: string;
  /** Days of the period, and how many of them the institutions supplied. */
  days: number;
  observedDays: number;
  estimatedDays: number;
  months: SummaryMonth[];
  rows: number;
  /** Gross bank flows over the observed rows. */
  credits: ExactAmount;
  debits: ExactAmount;
  /** Money in and out excluding transfers and card payments, observed only. */
  income: ExactAmount;
  spending: ExactAmount;
  net: ExactAmount;
  transfersIn: ExactAmount;
  transfersOut: ExactAmount;
  /** Present only when the report carries a gap estimate for this currency. */
  estimate: {
    gapStart: string;
    gapEnd: string;
    missingDays: number;
    income: ExactAmount;
    spending: ExactAmount;
    net: ExactAmount;
    basis: string;
  } | null;
  incomeWithEstimate: ExactAmount;
  spendingWithEstimate: ExactAmount;
  netWithEstimate: ExactAmount;
  /** Average per calendar month (365/12 days) over the observed days. */
  monthlyMeanIncome: ExactAmount;
  monthlyMeanSpending: ExactAmount;
  monthlyMeanNet: ExactAmount;
  monthsSpendingExceededIncome: number;
  spendingByCategory: SummaryBreakdownLine[];
  incomeBySource: SummaryBreakdownLine[];
  balances: SummaryBalance[];
  /** Sum of positive balances on checking, savings and cash accounts. */
  cashOnHand: ExactAmount;
  /** Sum of positive balances on investment accounts. */
  investments: ExactAmount;
  /** Sum of amounts owed on cards and loans. */
  owed: ExactAmount;
  balancesAsOf: string | null;
  /** Plain-English sentences a non-specialist can read; every number is above. */
  highlights: string[];
}

const ZERO: ExactAmount = '0';
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LIABILITY_KINDS = new Set(['credit', 'loan']);
const CASH_KINDS = new Set(['checking', 'savings', 'cash', 'unknown']);
const MAX_CATEGORY_LINES = 8;
const MAX_SOURCE_LINES = 6;

function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.UTC(Number(fromDate.slice(0, 4)), Number(fromDate.slice(5, 7)) - 1, Number(fromDate.slice(8, 10)));
  const b = Date.UTC(Number(toDate.slice(0, 4)), Number(toDate.slice(5, 7)) - 1, Number(toDate.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

function lastDayOfMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const day = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** Overlap in days of two inclusive local-date ranges. */
function overlapDays(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  return end < start ? 0 : daysBetween(start, end) + 1;
}

/** Display money with grouping for prose; the exact string is what is stored. */
export function formatMoney(amount: ExactAmount, currency: string): string {
  const decimals = displayDecimalsFor(currency);
  const fixed = formatFixed(amount, decimals);
  const negative = fixed.startsWith('-');
  const [intPart, frac] = (negative ? fixed.slice(1) : fixed).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = frac !== undefined ? `${grouped}.${frac}` : grouped;
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : `${currency} `;
  return `${negative ? '-' : ''}${symbol}${body}`;
}

/** A merchant or payer name good enough to group income by. */
export function sourceKey(row: Pick<ReportRow, 'payee' | 'description'>): { key: string; label: string } {
  const raw = (row.payee ?? row.description ?? '').trim();
  const cleaned = raw
    .replace(/[#*]\s*\d[\w-]*/g, ' ')
    .replace(/\b\d{2,}[\d\-/]*\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter(Boolean).slice(0, 3);
  const label = (words.join(' ') || 'Unknown source').slice(0, 40);
  return { key: label.toLowerCase(), label };
}

function share(total: ExactAmount, part: ExactAmount): number {
  const t = toUnits(total);
  if (t === 0n) return 0;
  return Number((toUnits(part) * 10_000n) / t) / 10_000;
}

function breakdown(map: Map<string, { label: string; total: ExactAmount; rows: number }>, limit: number, otherLabel: string): SummaryBreakdownLine[] {
  const lines = [...map.entries()]
    .map(([key, v]) => ({ key, label: v.label, total: v.total, rows: v.rows }))
    .sort((a, b) => compareAmounts(b.total, a.total) || a.label.localeCompare(b.label));
  const total = sumAmounts(lines.map((l) => l.total));
  const head = lines.slice(0, limit);
  const tail = lines.slice(limit);
  const out: SummaryBreakdownLine[] = head.map((l) => ({ ...l, share: share(total, l.total) }));
  if (tail.length) {
    const otherTotal = sumAmounts(tail.map((l) => l.total));
    out.push({ key: 'other', label: `${otherLabel} (${tail.length} more)`, total: otherTotal, rows: tail.reduce((n, l) => n + l.rows, 0), share: share(total, otherTotal) });
  }
  return out;
}

export interface SummarizeInput {
  currency: string;
  timezone: string;
  /** ISO instants; end exclusive. */
  start: string;
  end: string;
  accounts: ReportAccount[];
  posted: ReportRow[];
  estimate: GapEstimate | null;
}

/** Summarise one currency of a report. Pure; every input is in the dataset. */
export function summarizeCurrency(input: SummarizeInput): ReportSummary {
  const { currency, timezone } = input;
  const accounts = input.accounts.filter((a) => a.currency === currency);
  const accountIds = new Set(accounts.map((a) => a.id));
  const rows = input.posted.filter((r) => accountIds.has(r.accountId) && r.posted);

  const periodStart = localDate(new Date(input.start), timezone);
  const endDate = localDate(new Date(input.end), timezone);
  const endClock = wallClock(new Date(input.end), timezone);
  const endsAtMidnight = endClock.hour === 0 && endClock.minute === 0 && endClock.second === 0;
  const periodLastDay = endsAtMidnight ? addDays(endDate, -1) : endDate;
  const days = Math.max(0, daysBetween(periodStart, periodLastDay) + 1);

  const estimate = input.estimate && input.estimate.currency === currency ? input.estimate : null;
  const estimatedDays = estimate ? estimate.missingDays : 0;
  const observedDays = Math.max(0, days - estimatedDays);

  // --- bucket rows by month -------------------------------------------------
  type Bucket = { rows: number; credits: ExactAmount[]; debits: ExactAmount[]; income: ExactAmount[]; spending: ExactAmount[]; tIn: ExactAmount[]; tOut: ExactAmount[] };
  const buckets = new Map<string, Bucket>();
  const bucketFor = (month: string): Bucket => {
    let b = buckets.get(month);
    if (!b) {
      b = { rows: 0, credits: [], debits: [], income: [], spending: [], tIn: [], tOut: [] };
      buckets.set(month, b);
    }
    return b;
  };
  const byCategory = new Map<string, { label: string; total: ExactAmount; rows: number }>();
  const bySource = new Map<string, { label: string; total: ExactAmount; rows: number }>();

  for (const row of rows) {
    const month = localDate(new Date(row.posted as string), timezone).slice(0, 7);
    const b = bucketFor(month);
    b.rows += 1;
    const internal = INTERNAL_CATEGORIES.has(row.category ?? '');
    if (isNegativeAmount(row.amount)) {
      const magnitude = negateAmount(row.amount);
      b.debits.push(magnitude);
      if (internal) b.tOut.push(magnitude);
      else {
        b.spending.push(magnitude);
        const key = row.category ?? 'uncategorised';
        const line = byCategory.get(key) ?? { label: categoryLabel(row.category), total: ZERO, rows: 0 };
        line.total = sumAmounts([line.total, magnitude]);
        line.rows += 1;
        byCategory.set(key, line);
      }
    } else if (!isZeroAmount(row.amount)) {
      b.credits.push(row.amount);
      if (internal) b.tIn.push(row.amount);
      else {
        b.income.push(row.amount);
        const { key, label } = sourceKey(row);
        const line = bySource.get(key) ?? { label, total: ZERO, rows: 0 };
        line.total = sumAmounts([line.total, row.amount]);
        line.rows += 1;
        bySource.set(key, line);
      }
    }
  }

  const income = sumAmounts([...buckets.values()].flatMap((b) => b.income));
  const spending = sumAmounts([...buckets.values()].flatMap((b) => b.spending));
  const dailyMeanIncome = estimate && estimate.observedDays > 0 ? divideAmount(income, estimate.observedDays) : ZERO;
  const dailyMeanSpending = estimate && estimate.observedDays > 0 ? divideAmount(spending, estimate.observedDays) : ZERO;

  // --- calendar months of the period ------------------------------------------
  const months: SummaryMonth[] = [];
  let cumulative: ExactAmount = ZERO;
  if (days > 0) {
    for (let month = periodStart.slice(0, 7); month <= periodLastDay.slice(0, 7); month = nextMonth(month)) {
      const monthStart = `${month}-01` > periodStart ? `${month}-01` : periodStart;
      const monthEnd = lastDayOfMonth(month) < periodLastDay ? lastDayOfMonth(month) : periodLastDay;
      const monthDays = daysBetween(monthStart, monthEnd) + 1;
      const estDays = estimate ? overlapDays(monthStart, monthEnd, estimate.gapStart, addDays(estimate.gapEnd, -1)) : 0;
      const b = buckets.get(month) ?? { rows: 0, credits: [], debits: [], income: [], spending: [], tIn: [], tOut: [] };
      const mIncome = sumAmounts(b.income);
      const mSpending = sumAmounts(b.spending);
      const estIncome = estDays > 0 ? multiplyAmount(dailyMeanIncome, estDays) : null;
      const estSpending = estDays > 0 ? multiplyAmount(dailyMeanSpending, estDays) : null;
      const incomeWithEstimate = estIncome ? sumAmounts([mIncome, estIncome]) : mIncome;
      const spendingWithEstimate = estSpending ? sumAmounts([mSpending, estSpending]) : mSpending;
      const netWithEstimate = subtractAmounts(incomeWithEstimate, spendingWithEstimate);
      cumulative = sumAmounts([cumulative, netWithEstimate]);
      months.push({
        month,
        label: monthLabel(month),
        days: monthDays,
        observedDays: monthDays - estDays,
        estimatedDays: estDays,
        rows: b.rows,
        credits: sumAmounts(b.credits),
        debits: sumAmounts(b.debits),
        income: mIncome,
        spending: mSpending,
        net: subtractAmounts(mIncome, mSpending),
        transfersIn: sumAmounts(b.tIn),
        transfersOut: sumAmounts(b.tOut),
        estimatedIncome: estIncome,
        estimatedSpending: estSpending,
        incomeWithEstimate,
        spendingWithEstimate,
        netWithEstimate,
        cumulativeNet: cumulative,
      });
    }
  }

  const estimateBlock = estimate
    ? (() => {
        const eIncome = multiplyAmount(dailyMeanIncome, estimate.missingDays);
        const eSpending = multiplyAmount(dailyMeanSpending, estimate.missingDays);
        return {
          gapStart: estimate.gapStart,
          gapEnd: estimate.gapEnd,
          missingDays: estimate.missingDays,
          income: eIncome,
          spending: eSpending,
          net: subtractAmounts(eIncome, eSpending),
          basis: `Money in and money out for ${estimate.gapStart} to ${addDays(estimate.gapEnd, -1)} (${estimate.missingDays} days) are estimated from the daily average of the ${estimate.observedDays} observed days, the same method as the report's estimated period. Not observed transactions.`,
        };
      })()
    : null;

  const incomeWithEstimate = estimateBlock ? sumAmounts([income, estimateBlock.income]) : income;
  const spendingWithEstimate = estimateBlock ? sumAmounts([spending, estimateBlock.spending]) : spending;

  // Average per calendar month over the observed days: amount × 365 / (days × 12).
  const perMonth = (amount: ExactAmount): ExactAmount => (observedDays > 0 ? divideAmount(multiplyAmount(amount, 365), observedDays * 12) : ZERO);
  const monthlyMeanIncome = perMonth(income);
  const monthlyMeanSpending = perMonth(spending);

  // --- balances ----------------------------------------------------------------
  const balances: SummaryBalance[] = accounts.map((a) => ({
    accountId: a.id,
    name: a.name,
    orgName: a.orgName,
    kind: a.kind,
    liability: LIABILITY_KINDS.has(a.kind),
    balance: a.currentBalance,
    asOf: a.currentBalanceAsOf,
  }));
  const cashOnHand = sumAmounts(balances.filter((b) => !b.liability && CASH_KINDS.has(b.kind) && b.balance && !isNegativeAmount(b.balance)).map((b) => b.balance as ExactAmount));
  const investments = sumAmounts(balances.filter((b) => b.kind === 'investment' && b.balance && !isNegativeAmount(b.balance)).map((b) => b.balance as ExactAmount));
  const owed = sumAmounts(balances.filter((b) => b.liability && b.balance && isNegativeAmount(b.balance)).map((b) => negateAmount(b.balance as ExactAmount)));
  const balancesAsOf = balances.reduce<string | null>((latest, b) => (b.asOf && (!latest || b.asOf > latest) ? b.asOf : latest), null);

  const spendingByCategory = breakdown(byCategory, MAX_CATEGORY_LINES, 'Everything else');
  const incomeBySource = breakdown(bySource, MAX_SOURCE_LINES, 'Other sources');
  const monthsSpendingExceededIncome = months.filter((m) => isNegativeAmount(m.netWithEstimate)).length;

  const summary: ReportSummary = {
    version: SUMMARY_VERSION,
    currency,
    periodStart,
    periodEnd: periodLastDay,
    days,
    observedDays,
    estimatedDays,
    months,
    rows: rows.length,
    credits: sumAmounts([...buckets.values()].flatMap((b) => b.credits)),
    debits: sumAmounts([...buckets.values()].flatMap((b) => b.debits)),
    income,
    spending,
    net: subtractAmounts(income, spending),
    transfersIn: sumAmounts([...buckets.values()].flatMap((b) => b.tIn)),
    transfersOut: sumAmounts([...buckets.values()].flatMap((b) => b.tOut)),
    estimate: estimateBlock,
    incomeWithEstimate,
    spendingWithEstimate,
    netWithEstimate: subtractAmounts(incomeWithEstimate, spendingWithEstimate),
    monthlyMeanIncome,
    monthlyMeanSpending,
    monthlyMeanNet: subtractAmounts(monthlyMeanIncome, monthlyMeanSpending),
    monthsSpendingExceededIncome,
    spendingByCategory,
    incomeBySource,
    balances,
    cashOnHand,
    investments,
    owed,
    balancesAsOf,
    highlights: [],
  };
  summary.highlights = highlightsFor(summary);
  return summary;
}

function list(lines: SummaryBreakdownLine[], currency: string, n: number): string {
  return lines
    .filter((l) => l.key !== 'other')
    .slice(0, n)
    .map((l) => `${l.label} (${formatMoney(l.total, currency)})`)
    .join(', ');
}

/** The sentences. Written for a reader who will not open the tables. */
export function highlightsFor(s: ReportSummary): string[] {
  const c = s.currency;
  const out: string[] = [];
  const estNote = s.estimate ? ` That includes an estimate for ${s.estimate.gapStart} to ${addDays(s.estimate.gapEnd, -1)}, the ${s.estimate.missingDays} days the banks supplied nothing for.` : '';
  const net = s.netWithEstimate;
  out.push(
    `Between ${s.periodStart} and ${s.periodEnd}, money coming in from outside these accounts came to ${formatMoney(s.incomeWithEstimate, c)} and money going out came to ${formatMoney(s.spendingWithEstimate, c)}, so ${isNegativeAmount(net) ? `${formatMoney(negateAmount(net), c)} more went out than came in` : `${formatMoney(net, c)} more came in than went out`}.${estNote}`,
  );
  if (s.observedDays > 0) {
    out.push(`Over the ${s.observedDays} days the banks did supply, that is an average of about ${formatMoney(s.monthlyMeanIncome, c)} a month coming in and ${formatMoney(s.monthlyMeanSpending, c)} a month going out.`);
  }
  if (s.months.length > 1) {
    out.push(`Spending was higher than income in ${s.monthsSpendingExceededIncome} of the ${s.months.length} months.`);
  }
  if (s.incomeBySource.length) out.push(`Main sources of money in: ${list(s.incomeBySource, c, 4)}.`);
  if (s.spendingByCategory.length) out.push(`Largest spending: ${list(s.spendingByCategory, c, 4)}.`);
  const withBalance = s.balances.filter((b) => b.balance !== null);
  if (withBalance.length) {
    const parts: string[] = [`${formatMoney(s.cashOnHand, c)} in ${s.balances.filter((b) => !b.liability && CASH_KINDS.has(b.kind)).length} bank account(s)`];
    if (!isZeroAmount(s.investments)) parts.push(`${formatMoney(s.investments, c)} in investments`);
    if (!isZeroAmount(s.owed)) parts.push(`${formatMoney(s.owed, c)} owed on cards and loans`);
    out.push(`Balances as of ${(s.balancesAsOf ?? 'the last sync').slice(0, 10)}: ${parts.join(', ')}.`);
  }
  if (!isZeroAmount(s.transfersIn) || !isZeroAmount(s.transfersOut)) {
    out.push(`Transfers between the owner's own accounts and card payments (${formatMoney(s.transfersIn, c)} in, ${formatMoney(s.transfersOut, c)} out) are not counted as income or spending.`);
  }
  return out;
}

/** One summary per currency that has rows or accounts, in currency order. */
export function summarizeDataset(input: Omit<SummarizeInput, 'currency' | 'estimate'> & { estimates: GapEstimate[] }): ReportSummary[] {
  const currencies = [...new Set(input.accounts.map((a) => a.currency))].sort();
  return currencies.map((currency) =>
    summarizeCurrency({
      currency,
      timezone: input.timezone,
      start: input.start,
      end: input.end,
      accounts: input.accounts,
      posted: input.posted,
      estimate: input.estimates.find((e) => e.currency === currency) ?? null,
    }),
  );
}
