/**
 * Render a synthetic report (eight months, an estimated gap, twenty accounts)
 * to PDF and HTML so the executive summary can be looked at before it ships.
 *
 *   pnpm exec tsx scripts/preview-report.mts /tmp/out
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderHtml, renderPdf, GENERATED_BY_NOTICE, type ReportDataset, type ReportRow, type ReportAccount } from '../src/lib/finances/render';
import { summarizeDataset } from '../src/lib/finances/report-summary';
import { estimateLeadingGap, combineWithEstimate } from '../src/lib/finances/estimates';
import { sumAmounts, negateAmount, isNegativeAmount, subtractAmounts } from '../src/lib/finances/decimal';

const out = process.argv[2] ?? '/tmp/coinpay-preview';
mkdirSync(out, { recursive: true });

const TZ = 'America/Los_Angeles';
const start = '2026-01-01T08:00:00.000Z';
const end = '2026-09-13T07:00:00.000Z';

const kinds = ['checking', 'savings', 'credit', 'checking', 'credit', 'investment', 'checking', 'savings', 'credit', 'loan'];
const accounts: ReportAccount[] = Array.from({ length: 20 }, (_, i) => ({
  id: `acct-${i}`,
  name: `${['Business Checking', 'Savings', 'Sapphire Card', 'Personal Checking', 'Amex Gold', 'Brokerage', 'Payroll', 'Emergency Fund', 'Store Card', 'Auto Loan'][i % 10]} ${i + 1}`,
  orgName: ['Chase', 'Wells Fargo', 'Amex', 'Schwab', 'Capital One'][i % 5],
  currency: 'USD',
  kind: kinds[i % 10],
  scope: i % 3 === 0 ? 'personal' : 'business',
  isHidden: false,
  identityState: 'ok',
  currentBalance: kinds[i % 10] === 'credit' || kinds[i % 10] === 'loan' ? (-(1200 + i * 310.5)).toFixed(2) : (500 + i * 1234.25).toFixed(2),
  currentBalanceAsOf: '2026-09-13T06:30:00.000Z',
  availableBalance: null,
  openingBalance: null,
  closingBalance: null,
  balanceProvenance: 'unavailable',
}));

let seed = 7;
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
const posted: ReportRow[] = [];
const cats = ['software', 'dining', 'groceries', 'utilities', 'advertising', 'travel', 'fees', 'shopping', 'health', null, 'transport'];
const sources = ['Stripe Payout', 'ACME Corp Invoice 1033', 'Zelle from Jane', 'Coinbase Payout', 'Upwork'];
let n = 0;
for (let month = 2; month <= 9; month += 1) {
  const days = month === 9 ? 12 : 28;
  for (let d = 1; d <= days; d += 1) {
    const dateStr = `2026-${String(month).padStart(2, '0')}-${String(month === 2 && d < 20 ? d + 19 : d).padStart(2, '0')}T18:00:00.000Z`;
    if (month === 2 && d < 20 && d > 9) continue;
    const spend = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < spend; k += 1) {
      const acct = accounts[Math.floor(rnd() * 20)];
      const cat = cats[Math.floor(rnd() * cats.length)];
      posted.push({ id: `t${n++}`, accountId: acct.id, externalId: `x${n}`, posted: dateStr, transactedAt: null, amount: (-(5 + Math.round(rnd() * 40000) / 100)).toFixed(2), description: `${cat ?? 'MISC'} purchase #${n}`, payee: cat ? `${cat} vendor` : null, memo: null, mcc: null, category: cat, revision: 1 });
    }
    if (rnd() < 0.18) {
      const src = sources[Math.floor(rnd() * sources.length)];
      posted.push({ id: `t${n++}`, accountId: accounts[0].id, externalId: `x${n}`, posted: dateStr, transactedAt: null, amount: (Math.round((400 + rnd() * 3200) * 100) / 100).toFixed(2), description: src, payee: src, memo: null, mcc: null, category: 'income', revision: 1 });
    }
    if (rnd() < 0.12) {
      posted.push({ id: `t${n++}`, accountId: accounts[0].id, externalId: `x${n}`, posted: dateStr, transactedAt: null, amount: '-1500', description: 'Transfer to savings', payee: null, memo: null, mcc: null, category: 'transfer', revision: 1 });
      posted.push({ id: `t${n++}`, accountId: accounts[1].id, externalId: `x${n}`, posted: dateStr, transactedAt: null, amount: '1500', description: 'Transfer from checking', payee: null, memo: null, mcc: null, category: 'transfer', revision: 1 });
    }
  }
}
posted.sort((a, b) => (a.posted as string).localeCompare(b.posted as string));

const credits = sumAmounts(posted.filter((r) => !isNegativeAmount(r.amount)).map((r) => r.amount));
const debits = sumAmounts(posted.filter((r) => isNegativeAmount(r.amount)).map((r) => negateAmount(r.amount)));
const totals = [{ currency: 'USD', credits, debits, net: subtractAmounts(credits, debits), rows: posted.length }];
const estimate = estimateLeadingGap({ currency: 'USD', start, end, timezone: TZ, firstPosted: posted[0].posted, observedCredits: credits, observedDebits: debits });
const estimates = estimate ? [estimate] : [];

const ds: ReportDataset = {
  schema: 'coinpay.finance-report/1',
  report: {
    id: 'preview', revision: 3, merchantId: 'm', periodKind: 'custom', periodSelector: '2026-01-01..2026-09-13', periodLabel: '2026-01-01 to 2026-09-13', timezone: TZ,
    requestedStart: start, requestedEnd: end, effectiveEnd: end, periodToDate: true, cutoff: end, scope: 'all', includeHidden: false, includePending: true,
    generatedAt: '2026-09-13T07:05:00.000Z', snapshotAt: '2026-09-13T07:05:00.000Z', rendererVersion: 'preview',
  },
  accounts,
  posted,
  pending: [],
  totals,
  accountTotals: accounts.map((a) => {
    const rows = posted.filter((r) => r.accountId === a.id);
    const c = sumAmounts(rows.filter((r) => !isNegativeAmount(r.amount)).map((r) => r.amount));
    const d = sumAmounts(rows.filter((r) => isNegativeAmount(r.amount)).map((r) => negateAmount(r.amount)));
    return { accountId: a.id, credits: c, debits: d, net: subtractAmounts(c, d), rows: rows.length };
  }),
  estimates,
  totalsWithEstimates: estimate ? [{ currency: 'USD', ...combineWithEstimate(totals[0], estimate) }] : [],
  summary: summarizeDataset({ timezone: TZ, start, end, accounts, posted, estimates }),
  coverage: { local_export_complete: true, provider_coverage: 'partial', reconciliation_status: 'not_attempted', accounts: [], warnings: ['This report contains estimated figures.'], explanation: 'Part of this period was never fetched.' },
  statements: [],
  disclaimers: [GENERATED_BY_NOTICE],
};

writeFileSync(join(out, 'preview.html'), renderHtml(ds));
writeFileSync(join(out, 'preview.pdf'), await renderPdf(ds));
writeFileSync(join(out, 'summary.json'), JSON.stringify(ds.summary, null, 2));
console.log(`rows=${posted.length} months=${ds.summary[0].months.length} -> ${out}`);
