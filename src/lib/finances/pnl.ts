import { categoryLabel } from './classify';
import { defaultTaxCategory, isTaxCategory, taxCategoryLabel, EXCLUDED_TAX_CATEGORIES, INCOME_TAX_CATEGORIES } from './tax';
import { fromUnits, sumAmounts, isNegativeAmount, negateAmount, isZeroAmount, toUnits, formatFixed, type ExactAmount } from './decimal';
import { csvText, escapeHtml } from './render';

/**
 * Profit and loss statement, one per scope (personal or business).
 *
 * The books answer "what tax bucket is this row"; this answers "how much
 * did this person or business earn and spend", which is what a benefits
 * office, a lender or a landlord asks for. The rules that matter:
 *
 *  - A transfer between two of the owner's own accounts is neither income
 *    nor spending. Pairs are matched across every linked account (both
 *    scopes) by exact amount within four days, so a move from personal
 *    checking into business checking reads as an owner contribution on one
 *    statement and a transfer to the business on the other.
 *  - Credits on a card or loan are payments, refunds or rewards. Never income.
 *  - Purchases on a card are spending; the payment that clears them is not
 *    spending a second time.
 *  - Money that cannot be shown to be something else counts as income and is
 *    listed row by row. A statement of no income that quietly drops an
 *    unexplained deposit is worse than useless to the person relying on it.
 *
 * Pure: the loader in pnl-data.ts supplies rows, accounts and CoinPay
 * receipts; everything here is exact decimal and deterministic.
 */

export type PnlScope = 'personal' | 'business';
export type PnlSection = 'income' | 'expense' | 'excluded';

export interface PnlAccount {
  id: string;
  name: string;
  orgName: string | null;
  kind: string;
  liability: boolean;
  scope: string;
  hidden: boolean;
  currency: string;
}

export interface PnlRow {
  id: string;
  accountId: string;
  posted: string;
  amount: ExactAmount;
  description: string | null;
  payee: string | null;
  category: string | null;
  taxCategory: string | null;
  reviewed: boolean;
  /** Effective scope of the row (row override, else the account's). */
  scope: string;
}

/** A payment received through CoinPay itself (crypto checkout). */
export interface PnlReceipt {
  id: string;
  created: string;
  amount: ExactAmount;
  currency: string;
  business: string;
  status: string;
}

export interface PnlLineDef {
  key: string;
  label: string;
  section: PnlSection;
  /** Earned income (wages, self-employment, business receipts). */
  earned?: boolean;
  /** Shown row by row in the appendix because a reader will ask. */
  itemize?: boolean;
  note?: string;
}

export const PNL_LINES: Record<string, PnlLineDef> = {
  wages: { key: 'wages', label: 'Wages and salary', section: 'income', earned: true, itemize: true },
  gross_receipts: { key: 'gross_receipts', label: 'Sales and receipts deposited', section: 'income', earned: true, itemize: true },
  coinpay_receipts: { key: 'coinpay_receipts', label: 'Payments received through CoinPay', section: 'income', earned: true, itemize: true },
  self_employment: { key: 'self_employment', label: 'Self-employment receipts', section: 'income', earned: true, itemize: true },
  benefits: { key: 'benefits', label: 'Government benefits', section: 'income', itemize: true },
  retirement: {
    key: 'retirement', label: 'Retirement account withdrawals (one-time)', section: 'income', itemize: true,
    note: 'Deposits from a retirement plan or IRA custodian. Each is a one-time lump sum, not recurring income; the taxable part depends on the account type (traditional or Roth) and is stated on the custodian\'s Form 1099-R.',
  },
  interest: { key: 'interest', label: 'Interest and dividends', section: 'income' },
  other_income: { key: 'other_income', label: 'Other income', section: 'income', itemize: true },
  unidentified: {
    key: 'unidentified', label: 'Other deposits (source not stated by the bank)', section: 'income', itemize: true,
    note: 'Counted as income because the bank record does not show where the money came from. Each one is listed in the appendix; if it was a transfer from the owner\'s own account, a loan or a retirement withdrawal, mark it in Books and regenerate.',
  },

  own_transfers: { key: 'own_transfers', label: 'Transfers between own accounts', section: 'excluded' },
  card_payments: { key: 'card_payments', label: 'Payments to credit cards and loans', section: 'excluded' },
  refunds: { key: 'refunds', label: 'Refunds, rewards and statement credits', section: 'excluded' },
  investments: { key: 'investments', label: 'Moved to or from investment accounts', section: 'excluded' },
  investment_activity: { key: 'investment_activity', label: 'Trades inside investment accounts', section: 'excluded' },
  tax_refunds: { key: 'tax_refunds', label: 'Tax refunds and payments', section: 'excluded' },
  owner_in: { key: 'owner_in', label: 'Owner contributions (from personal accounts)', section: 'excluded' },
  owner_out: { key: 'owner_out', label: 'Owner draws and repayments (to personal accounts)', section: 'excluded' },
  to_business: { key: 'to_business', label: 'Money put into own business', section: 'excluded' },
  from_business: { key: 'from_business', label: 'Received from own business, or personal bills it paid', section: 'excluded' },
};

const PERSONAL_EXPENSE_LABELS: Record<string, string> = {
  groceries: 'Groceries',
  dining: 'Dining',
  transport: 'Transportation and fuel',
  fuel: 'Transportation and fuel',
  travel: 'Travel',
  shopping: 'Shopping and household',
  utilities: 'Utilities, phone and internet',
  software: 'Software and subscriptions',
  advertising: 'Advertising',
  health: 'Health and medical',
  entertainment: 'Entertainment',
  insurance: 'Insurance',
  taxes: 'Taxes',
  fees: 'Bank fees and interest charges',
  cash: 'Withdrawals and person-to-person payments',
  income: 'Other / uncategorised',
  other: 'Other / uncategorised',
};

// Patterns over the bank's own text. Order matters: a retirement custodian's
// deposit is often auto-categorised "transfer", so it is tested first.
// T. Rowe Price pays IRA distributions out of its U.S. Treasury Money fund
// (PRTXX), and the bank shows only "000053UST MONEY TRAN000053": no custodian
// name, and no word boundary before UST, so it sits outside the \b group.
const RE_RETIREMENT = /\b(EMPOWER|ITC2\.0|ITRUST|T ?ROWE|TRP\b|FIDELITY|VANGUARD|SCHWAB|PRINCIPAL|VOYA|TIAA|NATIONWIDE RET|401\(?K\)?|IRA DIST|PENSION|ANNUITY|CALPERS|CALSTRS)|UST MONEY TRAN/i;
const RE_WAGES = /\b(PAYROLL|PAYRL|DIR DEP|DIRECT DEP|SALARY|ADP\b|GUSTO|PAYCHEX|TRINET|JUSTWORKS|RIPPLING)/i;
const RE_BENEFITS = /\b(EDD\b|UNEMPLOY|SSA TREAS|SOC SEC|SSI\b|DISABILITY|CALFRESH|EBT\b)/i;
const RE_TAX = /\b(TAX REF|IRS TREAS|IRS USATAXPYMT|FRANCHISE TAX|FTB\b|CA TAX|STATE TAX)/i;
const RE_INTEREST = /\b(INTEREST|DIVIDEND|APY EARNED|INT EARNED|LENDING REBATE)\b/i;
const RE_RECEIPTS = /\b(STRIPE|PAYPAL|SQUARE|SHOPIFY|COINPAY|GUMROAD|PATREON|UPWORK|FIVERR|VENMO BUSINESS)\b/i;
const RE_REFUND = /\b(REFUND|REVERSAL|RETURN(ED)? (ITEM|CREDIT)|CREDIT ADJ|CASH ?BACK|REWARD|STATEMENT CREDIT)\b/i;
const RE_CARD_PAYMENT = /\b(PAYMENT|PYMT|PMT|AUTOPAY|AUTO-PMT|EPAY|CRCARDPMT|LOAN PAYMENT|APPLECARD|THANK ?YOU)\b/i;
// No trailing \b: banks run the name into the next word ("INTERACTIVE BROKACH", "MOOMOOFINANCIAL").
const RE_INVESTMENT = /\b(KRAKEN|COINBASE|GEMINI|INTERACTIVE BROK|SOFI SECURITIES|STASH|ROBINHOOD|MOOMOO|WEBULL|E\*?TRADE|ACORNS|BETTERMENT|WEALTHFRONT)/i;
const RE_TRANSFER_TEXT = /\b(TRANSFER FROM|TRANSFER TO|INTERNET TRANSFER|ONLINE TRANSFER|OVERDRAFT|P2P|ACH TRANSF)\b/i;
const RE_RETURNED_PAYMENT = /\b(RETURNED CHECK|RETURNED PAYMENT|RETURNED PMT|PAYMENT REVERSAL|PAYMENT RETURNED|NSF RETURN)/i;
/** Text a bank prints on one leg of a move between two accounts. */
const RE_TRANSFERISH = /\b(TRANSFER|XFER|TRANSF|OVERDRAFT|P2P|EXTERNAL (DEPOSIT|WITHDRAWAL)|CREDIT UNION|BANK|ACH)\b/i;

export interface ClassifiedRow extends PnlRow {
  line: string;
  label: string;
  section: PnlSection;
  account: PnlAccount;
  /** Why the row landed where it did, printed in the appendix. */
  basis: string;
  pairedWith: string | null;
}

function text(r: PnlRow): string {
  return `${r.payee ?? ''} ${r.description ?? ''}`;
}

function isInvestment(a: PnlAccount): boolean {
  return a.kind === 'investment' || a.kind === 'brokerage' || a.kind === 'retirement';
}

const DAY = 86_400_000;

/**
 * Whether a row may be one leg of a transfer. A brokerage buy or a
 * retirement deposit is never paired away. An amount with cents is specific
 * enough to match on alone; a round amount ($100, $250) is not, so it also
 * needs transfer-like text, or a Greenlight top-up pairs with a deposit into
 * a child's savings account because both were $100 that week.
 */
function pairable(r: PnlRow): boolean {
  const t = text(r);
  if (RE_INVESTMENT.test(t) || RE_RETIREMENT.test(t)) return false;
  const round = toUnits(r.amount) % 10_000n === 0n;
  if (!round) return true;
  return r.category === 'transfer' || r.category === 'payment' || RE_TRANSFERISH.test(t) || RE_CARD_PAYMENT.test(t);
}

/**
 * Pair each credit with an equal and opposite debit in another of the
 * owner's accounts posted within four days. Greedy on nearest date, each row
 * used once; ties broken by id so the result is deterministic.
 */
export function pairTransfers(rows: PnlRow[], accounts: Map<string, PnlAccount>): Map<string, string> {
  const pairs = new Map<string, string>();
  const debits = new Map<bigint, PnlRow[]>();
  for (const r of rows) {
    if (!isNegativeAmount(r.amount) || !pairable(r)) continue;
    const key = toUnits(negateAmount(r.amount));
    const list = debits.get(key) ?? [];
    list.push(r);
    debits.set(key, list);
  }
  const credits = rows
    .filter((r) => !isNegativeAmount(r.amount) && !isZeroAmount(r.amount) && pairable(r))
    .sort((a, b) => a.posted.localeCompare(b.posted) || a.id.localeCompare(b.id));
  for (const c of credits) {
    const candidates = debits.get(toUnits(c.amount));
    if (!candidates) continue;
    const ca = accounts.get(c.accountId);
    let best: PnlRow | null = null;
    let bestGap = Infinity;
    for (const d of candidates) {
      if (pairs.has(d.id) || d.accountId === c.accountId) continue;
      const da = accounts.get(d.accountId);
      if (!ca || !da || ca.currency !== da.currency) continue;
      const gap = Math.abs(Date.parse(c.posted) - Date.parse(d.posted));
      if (gap > 4 * DAY) continue;
      if (gap < bestGap || (gap === bestGap && best && d.id < best.id)) {
        best = d;
        bestGap = gap;
      }
    }
    if (best) {
      pairs.set(c.id, best.id);
      pairs.set(best.id, c.id);
    }
  }
  return pairs;
}

function lineFor(key: string, row: PnlRow, account: PnlAccount, basis: string, pairedWith: string | null = null): ClassifiedRow {
  const def = PNL_LINES[key];
  return { ...row, line: key, label: def.label, section: def.section, account, basis, pairedWith };
}

function expense(row: PnlRow, account: PnlAccount, scope: PnlScope): ClassifiedRow {
  if (scope === 'business') {
    const reviewedTax = row.reviewed && isTaxCategory(row.taxCategory) && !INCOME_TAX_CATEGORIES.has(row.taxCategory) && !EXCLUDED_TAX_CATEGORIES.has(row.taxCategory)
      ? row.taxCategory
      : null;
    const tax = reviewedTax ?? defaultTaxCategory(row.category, 'business', false);
    const label = tax === 'uncategorized' ? 'Uncategorised expenses' : taxCategoryLabel(tax);
    return { ...row, line: `exp:${tax}`, label, section: 'expense', account, basis: reviewedTax ? 'reviewed tax category' : 'spend category', pairedWith: null };
  }
  const label = PERSONAL_EXPENSE_LABELS[row.category ?? 'other'] ?? categoryLabel(row.category);
  return { ...row, line: `exp:${label}`, label, section: 'expense', account, basis: 'spend category', pairedWith: null };
}

/** Classify one row for a statement of `scope`. */
export function classifyRow(
  row: PnlRow,
  account: PnlAccount,
  scope: PnlScope,
  partner: { row: PnlRow; account: PnlAccount } | null,
): ClassifiedRow {
  const t = text(row);
  const credit = !isNegativeAmount(row.amount);

  // A person's confirmation in Books outranks every heuristic.
  if (row.reviewed && isTaxCategory(row.taxCategory)) {
    if (row.taxCategory === 'transfer') return lineFor('own_transfers', row, account, 'reviewed as a transfer');
    if (row.taxCategory === 'owner_draw') return lineFor(credit ? (scope === 'business' ? 'owner_in' : 'from_business') : (scope === 'business' ? 'owner_out' : 'to_business'), row, account, 'reviewed as an owner draw');
    if (row.taxCategory === 'income_tax_payment') return lineFor('tax_refunds', row, account, 'reviewed as a tax payment');
    if (credit && row.taxCategory === 'income_gross_receipts') return lineFor(scope === 'business' ? 'gross_receipts' : 'self_employment', row, account, 'reviewed as receipts');
    if (credit && row.taxCategory === 'income_other') return lineFor('other_income', row, account, 'reviewed as other income');
  }

  if (partner) {
    const crossScope = partner.row.scope !== row.scope;
    if (crossScope) {
      if (scope === 'business') return lineFor(credit ? 'owner_in' : 'owner_out', row, account, `matched ${partner.account.name}`, partner.row.id);
      return lineFor(credit ? 'from_business' : 'to_business', row, account, `matched ${partner.account.name}`, partner.row.id);
    }
    if (account.liability || partner.account.liability) return lineFor('card_payments', row, account, `matched ${partner.account.name}`, partner.row.id);
    if (isInvestment(account) || isInvestment(partner.account)) return lineFor('investments', row, account, `matched ${partner.account.name}`, partner.row.id);
    return lineFor('own_transfers', row, account, `matched ${partner.account.name}`, partner.row.id);
  }

  if (account.liability) {
    if (credit) {
      if (row.category === 'payment' || RE_CARD_PAYMENT.test(t)) return lineFor('card_payments', row, account, 'payment credited to a card or loan');
      return lineFor('refunds', row, account, 'credit on a card or loan');
    }
    if (row.category === 'payment' || row.category === 'transfer') return lineFor('card_payments', row, account, 'card or loan movement');
    // A bounced payment re-debits the card; it reverses a payment, it is not a purchase.
    if (RE_RETURNED_PAYMENT.test(t)) return lineFor('card_payments', row, account, 'returned payment');
    return expense(row, account, scope);
  }

  if (isInvestment(account)) {
    if (credit && RE_INTEREST.test(t)) return lineFor('interest', row, account, 'interest or dividend text');
    if (/\bACH\b|TRANSFER|DEPOSIT|WITHDRAW/i.test(t)) return lineFor('investments', row, account, 'cash moved in or out of an investment account');
    return lineFor('investment_activity', row, account, 'trade inside an investment account');
  }

  if (credit) {
    if (RE_RETIREMENT.test(t)) return lineFor('retirement', row, account, 'retirement custodian named in the bank text');
    if (RE_WAGES.test(t)) return lineFor('wages', row, account, 'payroll text');
    if (RE_BENEFITS.test(t)) return lineFor('benefits', row, account, 'benefits text');
    if (RE_TAX.test(t)) return lineFor('tax_refunds', row, account, 'tax agency text');
    if (row.category === 'income' && RE_INTEREST.test(t)) return lineFor('interest', row, account, 'interest or dividend');
    if (RE_INTEREST.test(t) && !RE_TRANSFER_TEXT.test(t)) return lineFor('interest', row, account, 'interest or dividend text');
    if (RE_REFUND.test(t)) return lineFor('refunds', row, account, 'refund text');
    if (row.category === 'transfer' || RE_TRANSFER_TEXT.test(t)) return lineFor('own_transfers', row, account, 'transfer text, no matching withdrawal in the linked accounts');
    if (scope === 'business' && RE_RECEIPTS.test(t)) return lineFor('gross_receipts', row, account, 'payment processor deposit');
    if (scope === 'personal' && RE_RECEIPTS.test(t)) return lineFor('self_employment', row, account, 'payment processor deposit');
    return lineFor('unidentified', row, account, 'deposit with no stated source');
  }

  if (row.category === 'payment' || (RE_CARD_PAYMENT.test(t) && !/PURCHASE/i.test(t))) return lineFor('card_payments', row, account, 'payment to a card or loan');
  if (RE_INVESTMENT.test(t)) return lineFor('investments', row, account, 'sent to a brokerage or exchange');
  if (RE_TAX.test(t) || row.category === 'taxes') return lineFor('tax_refunds', row, account, 'tax payment');
  if (row.category === 'transfer') return lineFor('own_transfers', row, account, 'transfer, no matching deposit in the linked accounts');
  return expense(row, account, scope);
}

// ---------------------------------------------------------------------------
// Statement
// ---------------------------------------------------------------------------

export interface PnlLine {
  key: string;
  label: string;
  section: PnlSection;
  earned: boolean;
  note: string | null;
  /** Positive magnitudes per month key, then the period total. */
  months: Record<string, ExactAmount>;
  total: ExactAmount;
  rows: number;
}

export interface PnlAccountCoverage extends PnlAccount {
  rows: number;
  first: string | null;
  last: string | null;
}

export interface PnlStatement {
  scope: PnlScope;
  holder: string;
  start: string;
  end: string;
  timezone: string;
  currency: string;
  generatedAt: string;
  months: Array<{ key: string; label: string; partial: boolean }>;
  income: PnlLine[];
  expenses: PnlLine[];
  excluded: PnlLine[];
  totals: {
    earned: ExactAmount;
    unearned: ExactAmount;
    income: ExactAmount;
    expenses: ExactAmount;
    net: ExactAmount;
    monthlyIncome: ExactAmount;
    monthlyEarned: ExactAmount;
    byMonth: Record<string, { income: ExactAmount; earned: ExactAmount; expenses: ExactAmount; net: ExactAmount }>;
  };
  itemized: ClassifiedRow[];
  receipts: PnlReceipt[];
  accounts: PnlAccountCoverage[];
  notes: string[];
  rows: ClassifiedRow[];
}

/** YYYY-MM-DD of `date` in `timezone`. */
function localDay(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** The `n` complete calendar months before the current one, as [from, to). */
export function lastCompleteMonths(n: number, now: Date, timezone: string): { from: string; to: string } {
  const [y, m] = localDay(now, timezone).split('-').map(Number);
  const to = `${y}-${String(m).padStart(2, '0')}-01`;
  const startIndex = y * 12 + (m - 1) - n;
  const from = `${Math.floor(startIndex / 12)}-${String((startIndex % 12) + 1).padStart(2, '0')}-01`;
  return { from, to };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthKey(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit' }).formatToParts(new Date(iso));
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
}

/**
 * The calendar day of a bank row. Institutions post a date, not an instant;
 * it is stored as midnight (or noon) UTC, so converting it into a western
 * timezone would move every transaction to the day before.
 */
export function rowDay(r: { posted: string }): string {
  return r.posted.slice(0, 10);
}

export function localDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** Calendar months touched by [start, end) in `timezone`. */
export function monthsBetween(start: string, end: string, timezone: string): Array<{ key: string; label: string; partial: boolean }> {
  const out: Array<{ key: string; label: string; partial: boolean }> = [];
  const first = monthKey(start, timezone);
  const last = monthKey(new Date(Date.parse(end) - 1).toISOString(), timezone);
  let [y, m] = first.split('-').map(Number);
  const startDay = localDate(start, timezone).slice(8);
  const endDay = localDate(new Date(Date.parse(end) - 1).toISOString(), timezone);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const lastDayOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const partial = (key === first && startDay !== '01') || (key === last && Number(endDay.slice(8)) !== lastDayOfMonth);
    out.push({ key, label: `${MONTHS[m - 1]} ${y}${partial ? ' (part)' : ''}`, partial });
    if (key === last) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function magnitude(a: ExactAmount): ExactAmount {
  return isNegativeAmount(a) ? negateAmount(a) : a;
}

function excludedTotal(rows: ClassifiedRow[], line: string): ExactAmount | null {
  const list = rows.filter((r) => r.line === line).map((r) => magnitude(r.amount));
  return list.length ? sumAmounts(list) : null;
}

export interface BuildPnlInput {
  scope: PnlScope;
  holder: string;
  start: string;
  end: string;
  timezone: string;
  /** Every posted row of the merchant in the period, BOTH scopes, so transfers pair. */
  rows: PnlRow[];
  accounts: PnlAccount[];
  receipts?: PnlReceipt[];
  currency?: string;
  now?: Date;
}

export function buildPnl(input: BuildPnlInput): PnlStatement {
  const currency = input.currency ?? 'USD';
  const accounts = new Map(input.accounts.map((a) => [a.id, a]));
  const firstDay = localDate(input.start, input.timezone);
  const endDay = localDate(input.end, input.timezone);
  const all = input.rows.filter((r) => {
    const day = rowDay(r);
    return day >= firstDay && day < endDay && !isZeroAmount(r.amount) && accounts.get(r.accountId)?.currency === currency;
  });
  const pairs = pairTransfers(all, accounts);
  const byId = new Map(all.map((r) => [r.id, r]));
  const months = monthsBetween(input.start, input.end, input.timezone);

  const classified: ClassifiedRow[] = [];
  for (const r of all) {
    if (r.scope !== input.scope) continue;
    const account = accounts.get(r.accountId)!;
    const partnerId = pairs.get(r.id);
    const partnerRow = partnerId ? byId.get(partnerId) : undefined;
    const partner = partnerRow ? { row: partnerRow, account: accounts.get(partnerRow.accountId)! } : null;
    classified.push(classifyRow(r, account, input.scope, partner));
  }
  classified.sort((a, b) => a.posted.localeCompare(b.posted) || a.id.localeCompare(b.id));

  const receipts = input.scope === 'business' ? (input.receipts ?? []).filter((p) => p.currency === currency) : [];

  const lines = new Map<string, { def: { key: string; label: string; section: PnlSection; earned: boolean; note: string | null }; months: Map<string, ExactAmount[]>; rows: number }>();
  const add = (key: string, label: string, section: PnlSection, month: string, amount: ExactAmount) => {
    const def = PNL_LINES[key];
    const entry = lines.get(key) ?? { def: { key, label, section, earned: Boolean(def?.earned), note: def?.note ?? null }, months: new Map(), rows: 0 };
    const list = entry.months.get(month) ?? [];
    list.push(amount);
    entry.months.set(month, list);
    entry.rows += 1;
    lines.set(key, entry);
  };
  for (const r of classified) {
    // Income is the credit; expense is the debit (a refund on an expense line nets against it).
    const signed = r.section === 'expense' ? negateAmount(r.amount) : r.amount;
    add(r.line, r.label, r.section, rowDay(r).slice(0, 7), r.section === 'excluded' ? magnitude(r.amount) : signed);
  }
  for (const p of receipts) add('coinpay_receipts', PNL_LINES.coinpay_receipts.label, 'income', monthKey(p.created, input.timezone), p.amount);

  const toLine = (e: NonNullable<ReturnType<typeof lines.get>>): PnlLine => {
    const m: Record<string, ExactAmount> = {};
    for (const mo of months) m[mo.key] = sumAmounts(e.months.get(mo.key) ?? []);
    return { ...e.def, months: m, total: sumAmounts(Object.values(m)), rows: e.rows };
  };
  const order = Object.keys(PNL_LINES);
  const pick = (section: PnlSection) =>
    [...lines.values()].filter((e) => e.def.section === section).map(toLine)
      .sort((a, b) => section === 'expense'
        ? (toUnits(b.total) > toUnits(a.total) ? 1 : toUnits(b.total) < toUnits(a.total) ? -1 : a.label.localeCompare(b.label))
        : order.indexOf(a.key) - order.indexOf(b.key));
  const income = pick('income');
  const expenses = pick('expense');
  const excluded = pick('excluded');

  const byMonth: PnlStatement['totals']['byMonth'] = {};
  for (const mo of months) {
    const inc = sumAmounts(income.map((l) => l.months[mo.key]));
    const earned = sumAmounts(income.filter((l) => l.earned).map((l) => l.months[mo.key]));
    const exp = sumAmounts(expenses.map((l) => l.months[mo.key]));
    byMonth[mo.key] = { income: inc, earned, expenses: exp, net: sumAmounts([inc, negateAmount(exp)]) };
  }
  const totalIncome = sumAmounts(income.map((l) => l.total));
  const earned = sumAmounts(income.filter((l) => l.earned).map((l) => l.total));
  const totalExpenses = sumAmounts(expenses.map((l) => l.total));
  const n = BigInt(Math.max(1, months.length));
  const perMonth = (a: ExactAmount) => {
    const u = toUnits(a);
    const q = u / n;
    const rem = u % n;
    const rounded = rem * 2n >= n ? q + 1n : rem * 2n <= -n ? q - 1n : q;
    return fromUnits(rounded);
  };

  const itemized = classified.filter((r) => PNL_LINES[r.line]?.itemize);

  const coverage: PnlAccountCoverage[] = input.accounts
    .filter((a) => a.scope === input.scope && a.currency === currency)
    .map((a) => {
      const own = classified.filter((r) => r.accountId === a.id);
      return { ...a, rows: own.length, first: own[0] ? rowDay(own[0]) : null, last: own.length ? rowDay(own[own.length - 1]) : null };
    })
    .filter((a) => a.rows > 0)
    .sort((a, b) => (a.orgName ?? '').localeCompare(b.orgName ?? '') || a.name.localeCompare(b.name));

  const notes: string[] = [
    'Prepared by CoinPay from transactions imported read-only from the account holder\'s banks, card issuers and brokerages (SimpleFIN and Plaid). It is not a statement issued by any institution; the institutions\' own statements are the source records.',
    'Cash basis: amounts are counted on the date the institution posted them. Pending items are excluded.',
    'Transfers between the holder\'s own accounts, payments to credit cards and loans, refunds, and money moved into or out of investment accounts are shown under "Not income or expense" and are excluded from every total. Card purchases are counted as expenses when made; the later card payment is not counted again.',
    'Any deposit whose source the bank record does not show is counted as income, never omitted.',
  ];
  if (input.scope === 'personal') {
    notes.push('Business activity (Profullstack accounts) is reported separately. Money the holder put into the business is a capital contribution, not an expense, and is not income to the holder.');
  } else {
    notes.push('Owner contributions from personal accounts and draws back to them are equity movements, not revenue or expense.');
  }
  const fromBusiness = excludedTotal(classified, 'from_business');
  if (input.scope === 'personal' && fromBusiness) {
    notes.push(`The holder's business paid ${currency} ${money(fromBusiness)} to the holder or toward the holder's own cards in the period. These are shareholder distributions or loan repayments, not wages; an S-corporation's profit or loss reaches its owner through Schedule K-1, so they are not counted again here.`);
  }
  const partial = coverage.filter((a) => a.first && a.last && (Date.parse(a.first) - Date.parse(firstDay) > 10 * DAY || Date.parse(endDay) - Date.parse(a.last) > 10 * DAY));
  if (partial.length > 0) {
    notes.push(`Some accounts have activity for only part of the period (${partial.map((a) => `${a.orgName ?? ''} ${a.name}`.trim()).join('; ')}). Where a bank was re-linked, its old and new feeds appear as two accounts that together cover the period.`);
  }

  return {
    scope: input.scope,
    holder: input.holder,
    start: input.start,
    end: input.end,
    timezone: input.timezone,
    currency,
    generatedAt: (input.now ?? new Date()).toISOString(),
    months,
    income,
    expenses,
    excluded,
    totals: {
      earned,
      unearned: sumAmounts([totalIncome, negateAmount(earned)]),
      income: totalIncome,
      expenses: totalExpenses,
      net: sumAmounts([totalIncome, negateAmount(totalExpenses)]),
      monthlyIncome: perMonth(totalIncome),
      monthlyEarned: perMonth(earned),
      byMonth,
    },
    itemized,
    receipts,
    accounts: coverage,
    notes,
    rows: classified,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function money(a: ExactAmount): string {
  const neg = isNegativeAmount(a);
  const s = formatFixed(magnitude(a), 2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `(${s})` : s;
}

function title(s: PnlStatement): string {
  return s.scope === 'personal' ? 'Personal Profit and Loss Statement' : 'Business Profit and Loss Statement';
}

export function periodLabel(s: PnlStatement): string {
  const fmt = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: s.timezone, month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(iso));
  return `${fmt(s.start)} through ${fmt(new Date(Date.parse(s.end) - 1).toISOString())}`;
}

/** The plain-English answer a caseworker or lender reads first. */
export function headline(s: PnlStatement): string {
  const monthsN = s.months.length;
  if (s.scope === 'business') {
    return `Over the ${monthsN} months, the business recorded ${s.currency} ${money(s.totals.income)} of income and ${s.currency} ${money(s.totals.expenses)} of expenses, a net ${isNegativeAmount(s.totals.net) ? 'loss' : 'profit'} of ${s.currency} ${money(magnitude(s.totals.net))}.`;
  }
  const parts = [`Earned income (wages, salary or self-employment pay) over the ${monthsN} months: ${s.currency} ${money(s.totals.earned)}.`];
  const unearned = s.income.filter((l) => !l.earned && !isZeroAmount(l.total));
  if (unearned.length > 0) parts.push(`Other income: ${unearned.map((l) => `${l.label.toLowerCase()} ${s.currency} ${money(l.total)}`).join('; ')}.`);
  return parts.join(' ');
}

export function renderPnlCsv(s: PnlStatement): string {
  const out: string[] = [];
  out.push(`# ${title(s)} | ${s.holder} | ${periodLabel(s)} | ${s.timezone} | generated ${s.generatedAt}`);
  out.push(['section', 'line', ...s.months.map((m) => m.key), 'total', 'rows'].join(','));
  for (const l of [...s.income, ...s.expenses, ...s.excluded]) {
    out.push([l.section, csvText(l.label), ...s.months.map((m) => l.months[m.key]), l.total, String(l.rows)].join(','));
  }
  out.push(['total', 'Total income', ...s.months.map((m) => s.totals.byMonth[m.key].income), s.totals.income, ''].join(','));
  out.push(['total', 'Total expenses', ...s.months.map((m) => s.totals.byMonth[m.key].expenses), s.totals.expenses, ''].join(','));
  out.push(['total', 'Net', ...s.months.map((m) => s.totals.byMonth[m.key].net), s.totals.net, ''].join(','));
  out.push('');
  out.push('posted,account,institution,amount,line,section,basis,description,transaction_id');
  for (const r of s.rows) {
    out.push([rowDay(r), csvText(r.account.name), csvText(r.account.orgName), r.amount, csvText(r.label), r.section, csvText(r.basis), csvText([r.payee, r.description].filter(Boolean).join(' / ')), r.id].join(','));
  }
  for (const p of s.receipts) {
    out.push([localDate(p.created, s.timezone), csvText(`CoinPay: ${p.business}`), 'CoinPay', p.amount, csvText(PNL_LINES.coinpay_receipts.label), 'income', csvText(`payment ${p.status}`), '', p.id].join(','));
  }
  return out.join('\r\n') + '\r\n';
}

const CSS = `body{font:12px/1.45 Georgia,'Times New Roman',serif;color:#111;margin:32px auto;max-width:820px;padding:0 16px}
h1{font-size:20px;margin:0}h2{font-size:14px;margin:22px 0 6px;border-bottom:1px solid #111;padding-bottom:2px;text-transform:uppercase;letter-spacing:.04em}
.meta{color:#333;margin:4px 0 14px}.lead{border:1px solid #999;background:#f6f6f2;padding:10px 12px;margin:12px 0;font-size:13px}
table{border-collapse:collapse;width:100%;font-size:11.5px}th,td{padding:3px 6px;text-align:left;vertical-align:top}thead th{border-bottom:1px solid #111}
.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.sub td{border-top:1px solid #111;font-weight:bold}.grand td{border-top:2px double #111;font-weight:bold}
.muted{color:#555}.note{font-size:10.5px;color:#333}small{color:#555}`;

export function renderPnlHtml(s: PnlStatement): string {
  const cols = s.months;
  const head = `<thead><tr><th></th>${cols.map((m) => `<th class="num">${escapeHtml(m.label)}</th>`).join('')}<th class="num">Total</th></tr></thead>`;
  const row = (label: string, vals: ExactAmount[], total: ExactAmount, cls = '') =>
    `<tr${cls ? ` class="${cls}"` : ''}><td>${label}</td>${vals.map((v) => `<td class="num">${money(v)}</td>`).join('')}<td class="num">${money(total)}</td></tr>`;
  const section = (lines: PnlLine[], empty: string) =>
    lines.length === 0 ? `<tr><td colspan="${cols.length + 2}" class="muted">${escapeHtml(empty)}</td></tr>` : lines.map((l) => row(escapeHtml(l.label), cols.map((m) => l.months[m.key]), l.total)).join('');
  const tm = s.totals.byMonth;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(title(s))}</title><style>${CSS}</style></head><body>
<h1>${escapeHtml(title(s))}</h1>
<div class="meta"><strong>${escapeHtml(s.holder)}</strong><br>Period: ${escapeHtml(periodLabel(s))} (${escapeHtml(s.timezone)})<br>Basis: cash, posted transactions · Currency: ${escapeHtml(s.currency)} · Prepared ${escapeHtml(localDate(s.generatedAt, s.timezone))}</div>
<div class="lead">${escapeHtml(headline(s))}</div>
<h2>Summary</h2><table>${head}<tbody>
${row('Earned income', cols.map((m) => tm[m.key].earned), s.totals.earned)}
${row('Other income', cols.map((m) => sumAmounts([tm[m.key].income, negateAmount(tm[m.key].earned)])), s.totals.unearned)}
${row('Total income', cols.map((m) => tm[m.key].income), s.totals.income, 'sub')}
${row('Total expenses', cols.map((m) => tm[m.key].expenses), s.totals.expenses)}
${row(isNegativeAmount(s.totals.net) ? 'Net loss' : 'Net income', cols.map((m) => tm[m.key].net), s.totals.net, 'grand')}
</tbody></table>
<p class="note">Average per month: total income ${s.currency} ${money(s.totals.monthlyIncome)}; earned income ${s.currency} ${money(s.totals.monthlyEarned)}. Figures in parentheses are negative.</p>
<h2>Income</h2><table>${head}<tbody>${section(s.income, 'No income recorded in the period.')}${row('Total income', cols.map((m) => tm[m.key].income), s.totals.income, 'sub')}</tbody></table>
${s.income.filter((l) => l.note).map((l) => `<p class="note"><strong>${escapeHtml(l.label)}:</strong> ${escapeHtml(l.note)}</p>`).join('')}
<h2>Expenses</h2><table>${head}<tbody>${section(s.expenses, 'No expenses recorded in the period.')}${row('Total expenses', cols.map((m) => tm[m.key].expenses), s.totals.expenses, 'sub')}</tbody></table>
<h2>Not income or expense</h2><p class="note">Shown for reconciliation only and excluded from every total above.</p><table>${head}<tbody>${section(s.excluded, 'None.')}</tbody></table>
<h2>Income items</h2><p class="note">Every deposit counted as income, as the institution described it.</p>
<table><thead><tr><th>Date</th><th>Account</th><th>Bank description</th><th>Line</th><th class="num">Amount</th></tr></thead><tbody>
${s.itemized.map((r) => `<tr><td>${escapeHtml(rowDay(r))}</td><td>${escapeHtml(`${r.account.orgName ?? ''} ${r.account.name}`.trim())}</td><td>${escapeHtml(r.description ?? r.payee ?? '')}</td><td>${escapeHtml(r.label)}</td><td class="num">${money(r.amount)}</td></tr>`).join('')}
${s.receipts.map((p) => `<tr><td>${escapeHtml(localDate(p.created, s.timezone))}</td><td>CoinPay</td><td>${escapeHtml(p.business)} (${escapeHtml(p.status)})</td><td>${escapeHtml(PNL_LINES.coinpay_receipts.label)}</td><td class="num">${money(p.amount)}</td></tr>`).join('')}
${s.itemized.length + s.receipts.length === 0 ? '<tr><td colspan="5" class="muted">None.</td></tr>' : ''}
</tbody></table>
<h2>Accounts included</h2><table><thead><tr><th>Institution</th><th>Account</th><th>Type</th><th>First</th><th>Last</th><th class="num">Transactions</th></tr></thead><tbody>
${s.accounts.map((a) => `<tr><td>${escapeHtml(a.orgName ?? '')}</td><td>${escapeHtml(a.name)}</td><td>${escapeHtml(a.kind)}</td><td>${escapeHtml(a.first ?? '')}</td><td>${escapeHtml(a.last ?? '')}</td><td class="num">${a.rows}</td></tr>`).join('')}
</tbody></table>
<h2>Notes</h2>${s.notes.map((n, i) => `<p class="note">${i + 1}. ${escapeHtml(n)}</p>`).join('')}
</body></html>`;
}

export async function renderPnlPdf(s: PnlStatement): Promise<Buffer> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
  const margin = 48;
  const width = 612 - margin * 2;
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  let y = margin;

  doc.setFont('times', 'bold');
  doc.setFontSize(17);
  doc.text(title(s), margin, y);
  y += 20;
  doc.setFont('times', 'normal');
  doc.setFontSize(10.5);
  for (const line of [s.holder, `Period: ${periodLabel(s)} (${s.timezone})`, `Basis: cash, posted transactions  |  Currency: ${s.currency}  |  Prepared ${localDate(s.generatedAt, s.timezone)}`]) {
    doc.text(line, margin, y);
    y += 13;
  }
  y += 4;
  const lead = doc.splitTextToSize(headline(s), width - 16) as string[];
  doc.setFillColor(246, 246, 242);
  doc.setDrawColor(150);
  doc.rect(margin, y, width, lead.length * 13 + 12, 'FD');
  doc.setFont('times', 'bold');
  doc.text(lead, margin + 8, y + 15);
  doc.setFont('times', 'normal');
  y += lead.length * 13 + 24;

  const cols = s.months;
  const head = [['', ...cols.map((m) => m.label), 'Total']];
  const numCols = Object.fromEntries(cols.map((_, i) => [i + 1, { halign: 'right' as const }]).concat([[cols.length + 1, { halign: 'right' as const }]]));
  const base = {
    theme: 'plain' as const,
    styles: { font: 'times', fontSize: 9.5, cellPadding: { top: 2.5, bottom: 2.5, left: 4, right: 4 } },
    headStyles: { fontStyle: 'bold' as const, lineWidth: { bottom: 0.8 }, lineColor: 20 },
    columnStyles: { 0: { cellWidth: 210 }, ...numCols },
    margin: { left: margin, right: margin },
  };
  const heading = (text: string) => {
    if (y > 700) { doc.addPage(); y = margin; }
    doc.setFont('times', 'bold');
    doc.setFontSize(11);
    doc.text(text.toUpperCase(), margin, y);
    doc.setLineWidth(0.8);
    doc.line(margin, y + 3, margin + width, y + 3);
    doc.setFont('times', 'normal');
    y += 8;
  };
  const tm = s.totals.byMonth;
  const bold = (cells: string[]) => cells.map((c) => ({ content: c, styles: { fontStyle: 'bold' as const } }));
  const lineRows = (lines: PnlLine[], empty: string) =>
    lines.length === 0 ? [[{ content: empty, colSpan: cols.length + 2, styles: { textColor: 90 } }]] : lines.map((l) => [l.label, ...cols.map((m) => money(l.months[m.key])), money(l.total)]);

  heading('Summary');
  autoTable(doc, {
    ...base, startY: y, head,
    body: [
      ['Earned income', ...cols.map((m) => money(tm[m.key].earned)), money(s.totals.earned)],
      ['Other income', ...cols.map((m) => money(sumAmounts([tm[m.key].income, negateAmount(tm[m.key].earned)]))), money(s.totals.unearned)],
      bold(['Total income', ...cols.map((m) => money(tm[m.key].income)), money(s.totals.income)]),
      ['Total expenses', ...cols.map((m) => money(tm[m.key].expenses)), money(s.totals.expenses)],
      bold([isNegativeAmount(s.totals.net) ? 'Net loss' : 'Net income', ...cols.map((m) => money(tm[m.key].net)), money(s.totals.net)]),
    ],
  });
  y = lastY() + 12;
  doc.setFontSize(9);
  doc.text(`Average per month: total income ${s.currency} ${money(s.totals.monthlyIncome)}; earned income ${s.currency} ${money(s.totals.monthlyEarned)}. Parentheses are negative.`, margin, y);
  y += 20;

  heading('Income');
  autoTable(doc, { ...base, startY: y, head, body: [...lineRows(s.income, 'No income recorded in the period.'), bold(['Total income', ...cols.map((m) => money(tm[m.key].income)), money(s.totals.income)])] });
  y = lastY() + 10;
  doc.setFontSize(8.5);
  for (const l of s.income.filter((x) => x.note)) {
    const wrapped = doc.splitTextToSize(`${l.label}: ${l.note}`, width) as string[];
    if (y + wrapped.length * 10 > 740) { doc.addPage(); y = margin; }
    doc.text(wrapped, margin, y);
    y += wrapped.length * 10 + 4;
  }
  y += 10;

  heading('Expenses');
  autoTable(doc, { ...base, startY: y, head, body: [...lineRows(s.expenses, 'No expenses recorded in the period.'), bold(['Total expenses', ...cols.map((m) => money(tm[m.key].expenses)), money(s.totals.expenses)])] });
  y = lastY() + 22;

  heading('Not income or expense (excluded from totals)');
  autoTable(doc, { ...base, startY: y, head, body: lineRows(s.excluded, 'None.') });
  y = lastY() + 22;

  heading('Income items');
  autoTable(doc, {
    ...base, startY: y,
    head: [['Date', 'Account', 'Bank description', 'Line', 'Amount']],
    body: [
      ...s.itemized.map((r) => [rowDay(r), `${r.account.orgName ?? ''} ${r.account.name}`.trim(), r.description ?? r.payee ?? '', r.label, money(r.amount)]),
      ...s.receipts.map((p) => [localDate(p.created, s.timezone), 'CoinPay', `${p.business} (${p.status})`, PNL_LINES.coinpay_receipts.label, money(p.amount)]),
      ...(s.itemized.length + s.receipts.length === 0 ? [[{ content: 'None.', colSpan: 5, styles: { textColor: 90 } }]] : []),
    ],
    styles: { font: 'times', fontSize: 8.5, cellPadding: 2.5, overflow: 'linebreak' },
    columnStyles: { 0: { cellWidth: 58 }, 1: { cellWidth: 110 }, 3: { cellWidth: 105 }, 4: { halign: 'right', cellWidth: 62 } },
    showHead: 'everyPage',
  });
  y = lastY() + 22;

  heading('Accounts included');
  autoTable(doc, {
    ...base, startY: y,
    head: [['Institution', 'Account', 'Type', 'First', 'Last', 'Txns']],
    body: s.accounts.map((a) => [a.orgName ?? '', a.name, a.kind, a.first ?? '', a.last ?? '', String(a.rows)]),
    styles: { font: 'times', fontSize: 8.5, cellPadding: 2.5 },
    columnStyles: { 5: { halign: 'right' } },
  });
  y = lastY() + 22;

  heading('Notes');
  doc.setFontSize(8.5);
  s.notes.forEach((n, i) => {
    const wrapped = doc.splitTextToSize(`${i + 1}. ${n}`, width) as string[];
    if (y + wrapped.length * 10 > 740) { doc.addPage(); y = margin; }
    doc.text(wrapped, margin, y);
    y += wrapped.length * 10 + 4;
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(110);
    doc.text(`${title(s)}  |  ${s.holder}  |  ${periodLabel(s)}`, margin, 792 - 24);
    doc.text(`Page ${i} of ${pages}`, 612 - margin, 792 - 24, { align: 'right' });
    doc.setTextColor(0);
  }
  return Buffer.from(doc.output('arraybuffer'));
}
