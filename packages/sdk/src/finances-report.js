/**
 * A print-ready financial report, for handing to somebody who bills by the hour.
 *
 * The point is not that it is pretty. The point is that a bookkeeper opening it
 * does not have to ask for anything: the period is stated, business and personal
 * are separated, every figure says where it came from, and the transaction list
 * is complete enough to tie out against. Every question this document answers in
 * advance is a question nobody pays to have asked.
 *
 * Self-contained by design. No web fonts, no CDN, no script: it has to render
 * identically on a machine that has never seen it, offline, and print the same
 * way. The styling follows the shadcn palette because it is neutral and prints
 * well in greyscale, not because anything here is a React component.
 *
 * It is a data export and says so. It is not a filing, not advice, and not
 * reconciled against anything.
 */

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const num = (value) => {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
};

const money = (value, currency = 'USD') => {
  const v = num(value);
  const sign = v < 0 ? '-' : '';
  return `${sign}${currency === 'USD' ? '$' : ''}${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const day = (value) => String(value ?? '').slice(0, 10);

/** A figure that is negative reads red; everything else stays plain. */
const signed = (value, currency) =>
  `<span class="${num(value) < 0 ? 'neg' : 'pos'}">${esc(money(value, currency))}</span>`;

const CSS = `
:root{
  --bg:#ffffff; --fg:#09090b; --muted:#71717a; --line:#e4e4e7;
  --card:#ffffff; --accent:#18181b; --neg:#b91c1c; --pos:#15803d; --soft:#fafafa;
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--bg); color:var(--fg);
  font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
.page{max-width:860px;margin:0 auto;padding:32px 28px 56px}
h1{font-size:22px;letter-spacing:-.01em;margin:0 0 2px}
h2{font-size:14px;letter-spacing:-.005em;margin:0 0 10px;text-transform:none}
.sub{color:var(--muted);font-size:12px;margin:0}
header.doc{border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:22px}
.meta{display:flex;flex-wrap:wrap;gap:18px;margin-top:12px}
.meta div{min-width:120px}
.meta dt{color:var(--muted);font-size:11px;margin:0 0 2px}
.meta dd{margin:0;font-size:12px;font-weight:500}
section{margin:0 0 22px;break-inside:avoid}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.cards.three{grid-template-columns:repeat(3,1fr)}
.card{border:1px solid var(--line);border-radius:8px;padding:11px 12px;background:var(--card)}
.card .label{color:var(--muted);font-size:11px;margin-bottom:3px}
.card .value{font-size:16px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.card .note{color:var(--muted);font-size:10px;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{
  text-align:left;color:var(--muted);font-weight:500;font-size:11px;
  border-bottom:1px solid var(--line);padding:6px 8px;background:var(--soft);
}
td{padding:6px 8px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}
td.r,th.r{text-align:right}
tbody tr:last-child td{border-bottom:none}
.neg{color:var(--neg)}
.pos{color:var(--pos)}
.tag{
  display:inline-block;font-size:10px;padding:1px 6px;border:1px solid var(--line);
  border-radius:999px;color:var(--muted);background:var(--soft)
}
.notes{border:1px solid var(--line);border-radius:8px;padding:12px 14px;background:var(--soft);font-size:11px;color:var(--muted)}
.notes p{margin:0 0 6px}
.notes p:last-child{margin:0}
/* A truncated ledger has to be visible on a printed page, not just present. */
.notes p.warn{color:var(--neg);border-left:3px solid var(--neg);padding-left:8px}
.month{margin-top:16px;break-inside:avoid}
.month h3{font-size:12px;margin:0 0 6px;color:var(--muted);font-weight:600}
@page{size:letter;margin:14mm 12mm}
@media print{
  .page{max-width:none;padding:0}
  thead{display:table-header-group}
  tr{break-inside:avoid}
  section{break-inside:avoid}
  .txns section{break-inside:auto}
}
`;

function card(label, value, note) {
  return `<div class="card"><div class="label">${esc(label)}</div><div class="value">${value}</div>${
    note ? `<div class="note">${esc(note)}</div>` : ''
  }</div>`;
}

function table(headers, rows) {
  if (!rows.length) return '<p class="sub">Nothing in this period.</p>';
  const head = headers.map((h) => `<th class="${h.align === 'right' ? 'r' : ''}">${esc(h.title)}</th>`).join('');
  const body = rows
    .map(
      (cells) =>
        `<tr>${cells
          .map((c) => `<td class="${c.align === 'right' ? 'r' : ''}">${c.html ?? esc(c.text)}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Business and personal, side by side. The separation an S-corp return needs. */
function scopeSection(position, currency) {
  const scopes = position?.scopes ?? [];
  if (!scopes.length) return '';
  const months = num(position?.monthsObserved) || 1;
  const rows = scopes.map((s) => [
    { text: s.scope === 'business' ? 'Business' : 'Personal' },
    { text: String(num(s.accounts)) , align: 'right' },
    { html: signed(s.income, currency), align: 'right' },
    { html: signed(-Math.abs(num(s.spending)), currency), align: 'right' },
    { html: signed(num(s.income) - num(s.spending), currency), align: 'right' },
    { html: esc(money(num(s.spending) / months, currency)), align: 'right' },
  ]);
  return `<section>
    <h2>Business and personal</h2>
    ${table(
      [
        { title: 'Set of books' },
        { title: 'Accounts', align: 'right' },
        { title: 'Money in', align: 'right' },
        { title: 'Money out', align: 'right' },
        { title: 'Net', align: 'right' },
        { title: 'Spend / month', align: 'right' },
      ],
      rows,
    )}
    <p class="sub" style="margin-top:8px">Scope comes from how each account is marked in the feed, not from
    how a transaction looks. An account marked wrong moves every one of its transactions to the wrong side.</p>
  </section>`;
}

function accountsSection(bank, currency) {
  const accounts = bank?.accounts ?? [];
  if (!accounts.length) return '';
  const rows = accounts.map((a) => [
    { text: a.org_name ?? '' },
    { text: a.name ?? '' },
    { html: `<span class="tag">${esc(a.effective_kind ?? a.kind ?? '')}</span>` },
    { html: `<span class="tag">${esc(a.effective_scope ?? 'unmarked')}</span>` },
    { html: signed(a.display_balance ?? a.balance, a.currency ?? currency), align: 'right' },
    { text: day(a.balance_date), align: 'right' },
  ]);
  return `<section>
    <h2>Accounts</h2>
    ${table(
      [
        { title: 'Institution' },
        { title: 'Account' },
        { title: 'Type' },
        { title: 'Books' },
        { title: 'Balance', align: 'right' },
        { title: 'As of', align: 'right' },
      ],
      rows,
    )}
  </section>`;
}

function categoriesSection(bank, currency) {
  const cats = (bank?.topCategories ?? []).filter((c) => num(c.spent) > 0);
  if (!cats.length) return '';
  const total = cats.reduce((t, c) => t + num(c.spent), 0);
  const rows = cats.map((c) => [
    { text: c.category ?? 'uncategorised' },
    { text: String(num(c.count)), align: 'right' },
    { html: esc(money(c.spent, currency)), align: 'right' },
    { text: `${((num(c.spent) / total) * 100).toFixed(1)}%`, align: 'right' },
  ]);
  return `<section>
    <h2>Spending by category</h2>
    ${table(
      [
        { title: 'Category' },
        { title: 'Charges', align: 'right' },
        { title: 'Spent', align: 'right' },
        { title: 'Share', align: 'right' },
      ],
      rows,
    )}
  </section>`;
}

function debtSection(position, currency) {
  const debt = position?.debt;
  if (!debt || !num(debt.total)) return '';
  const rows = (debt.accounts ?? []).map((a) => [
    { text: a.org ?? '' },
    { text: a.name ?? '' },
    { html: `<span class="tag">${esc(a.scope ?? 'unmarked')}</span>` },
    { html: esc(money(a.owed, currency)), align: 'right' },
    { html: esc(money(a.paid, currency)), align: 'right' },
    { text: a.payoffMonths ? `${a.payoffMonths} mo` : '-', align: 'right' },
  ]);
  return `<section>
    <h2>Debt</h2>
    <div class="cards three" style="margin-bottom:10px">
      ${card('Owed', esc(money(debt.total, currency)))}
      ${card('Service / month', esc(money(position?.income?.perMonth ? debt.total / 12 : 0, currency)), 'estimate')}
      ${card('Revolving', esc(money(debt.revolving, currency)))}
    </div>
    ${table(
      [
        { title: 'Institution' },
        { title: 'Account' },
        { title: 'Books' },
        { title: 'Owed', align: 'right' },
        { title: 'Paid in period', align: 'right' },
        { title: 'Payoff', align: 'right' },
      ],
      rows,
    )}
  </section>`;
}

function recurringSection(position, currency) {
  const charges = position?.recurring?.charges ?? [];
  if (!charges.length) return '';
  const rows = charges.map((c) => [
    { text: c.payee ?? '' },
    { html: `<span class="tag">${esc(c.scope ?? 'unmarked')}</span>` },
    { text: c.cadence ?? '' },
    { html: esc(money(c.amount, currency)), align: 'right' },
    { html: esc(money(c.monthlyEquivalent, currency)), align: 'right' },
    { text: day(c.lastSeen), align: 'right' },
  ]);
  return `<section>
    <h2>Recurring obligations</h2>
    ${table(
      [
        { title: 'Payee' },
        { title: 'Books' },
        { title: 'Every' },
        { title: 'Amount', align: 'right' },
        { title: 'Per month', align: 'right' },
        { title: 'Last seen', align: 'right' },
      ],
      rows,
    )}
  </section>`;
}

/**
 * Every transaction, grouped by month.
 *
 * Grouped rather than one flat run because a bookkeeper reconciles a month at a
 * time, and because a 1,200 row table with no landmarks is unusable on paper.
 */
function transactionsSection(bank, currency, limit) {
  const ledger = bank?.ledger ?? [];
  if (!ledger.length) return '';
  const scopeById = new Map((bank?.accounts ?? []).map((a) => [a.id, a.effective_scope ?? 'unmarked']));

  const rows = [...ledger].sort((a, b) => String(b.posted ?? '').localeCompare(String(a.posted ?? '')));
  const shown = limit > 0 ? rows.slice(0, limit) : rows;

  const byMonth = new Map();
  for (const row of shown) {
    const key = day(row.posted).slice(0, 7) || 'undated';
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(row);
  }

  const blocks = [...byMonth.entries()]
    .map(([month, entries]) => {
      const out = entries.reduce((t, r) => t + (num(r.amount) < 0 ? Math.abs(num(r.amount)) : 0), 0);
      const inn = entries.reduce((t, r) => t + (num(r.amount) > 0 ? num(r.amount) : 0), 0);
      const body = table(
        [
          { title: 'Date' },
          { title: 'Account' },
          { title: 'Payee' },
          { title: 'Category' },
          { title: 'Books' },
          { title: 'Amount', align: 'right' },
        ],
        entries.map((r) => [
          { text: day(r.posted) },
          { text: r.account_name ?? '' },
          { text: r.payee || r.description || '' },
          { text: r.category ?? '' },
          { html: `<span class="tag">${esc(scopeById.get(r.account_id) ?? 'unmarked')}</span>` },
          { html: signed(r.amount, r.currency ?? currency), align: 'right' },
        ]),
      );
      return `<div class="month">
        <h3>${esc(month)} &middot; ${entries.length} transactions &middot; in ${esc(money(inn, currency))} &middot; out ${esc(money(out, currency))}</h3>
        ${body}
      </div>`;
    })
    .join('');

  const omitted = rows.length - shown.length;
  return `<section class="txns" style="break-before:page">
    <h2>Transactions</h2>
    <p class="sub">${shown.length} of ${num(bank?.ledgerTotal) || rows.length} in the period, newest first.${
      omitted > 0 ? ` ${omitted} not shown.` : ''
    }</p>
    ${blocks}
  </section>`;
}

/**
 * Build the report.
 *
 * `snapshot` is what collectFinanceSnapshot returns.
 */
export function buildFinanceReportHtml(snapshot, options = {}) {
  const {
    preparedFor = '',
    preparedBy = '',
    entity = '',
    generatedAt = new Date().toISOString(),
    includeTransactions = true,
    transactionLimit = 0,
    title = 'Financial summary',
  } = options;

  const bank = snapshot?.bank ?? {};
  const position = snapshot?.position ?? {};
  const currency = bank.currency || 'USD';
  const days = num(snapshot?.windowDays) || 30;
  const cash = bank.cashflow ?? {};

  const requestedEnd = day(generatedAt);
  const requestedStart = day(new Date(Date.parse(generatedAt) - days * 86400000).toISOString());

  // What the feed actually holds, which is usually less than what was asked
  // for. Printing the requested window alone tells a reader that the missing
  // months had no transactions in them, which is a much stronger claim than
  // "the bank did not give us those months".
  const dates = (bank.ledger ?? []).map((r) => day(r.posted)).filter(Boolean).sort();
  const coveredStart = dates[0] ?? '';
  const coveredEnd = dates[dates.length - 1] ?? '';
  const short = coveredStart && coveredStart > requestedStart;

  const glance = `<section>
    <h2>At a glance</h2>
    <div class="cards">
      ${card('Money in', signed(cash.moneyIn, currency), `${days} days`)}
      ${card('Money out', signed(-Math.abs(num(cash.moneyOut)), currency), `${days} days`)}
      ${card('Net', signed(cash.net, currency), `${days} days`)}
      ${card('Transactions', esc(String(num(cash.transactions))), `${days} days`)}
    </div>
    <div class="cards" style="margin-top:10px">
      ${card('Cash and assets', signed(bank.assets, currency), 'as of today')}
      ${card('Owed', signed(-Math.abs(num(bank.liabilities)), currency), 'as of today')}
      ${card('Net position', signed(bank.net, currency), 'assets minus debts')}
      ${card('Accounts', esc(String(num(bank.accountCount))), `${(bank.connections ?? []).length} institutions`)}
    </div>
  </section>`;

  const rates = num(position.monthsObserved)
    ? `<section>
    <h2>Run rate</h2>
    <div class="cards three">
      ${card('Income / month', signed(position.income?.perMonth, currency), `over ${num(position.lookbackDays)} days`)}
      ${card('Spending / month', signed(-Math.abs(num(position.spending?.perMonth)), currency), `over ${num(position.lookbackDays)} days`)}
      ${card('Net / month', signed(position.net?.perMonth, currency), `${num(position.monthsObserved).toFixed(1)} months observed`)}
    </div>
    <p class="sub" style="margin-top:8px">Transfers between accounts and card payments are netted out of both
    sides, so paying a card off does not read as income on one side and spending on the other.</p>
  </section>`
    : '';

  const uncategorised = num(position.confidence?.uncategorisedShare);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}${entity ? ` - ${esc(entity)}` : ''}</title>
<style>${CSS}</style>
</head><body><div class="page">
<header class="doc">
  <h1>${esc(title)}</h1>
  <p class="sub">${
    coveredStart ? `Data covers ${esc(coveredStart)} to ${esc(coveredEnd)}` : `${esc(requestedStart)} to ${esc(requestedEnd)}`
  }</p>
  ${
    short
      ? `<p class="sub" style="color:var(--neg)">Requested ${esc(requestedStart)} to ${esc(requestedEnd)}, but the
      feed holds nothing before ${esc(coveredStart)}. The earlier months are missing, not empty.</p>`
      : ''
  }
  <dl class="meta">
    ${entity ? `<div><dt>Entity</dt><dd>${esc(entity)}</dd></div>` : ''}
    ${preparedFor ? `<div><dt>Prepared for</dt><dd>${esc(preparedFor)}</dd></div>` : ''}
    ${preparedBy ? `<div><dt>Prepared by</dt><dd>${esc(preparedBy)}</dd></div>` : ''}
    <div><dt>Generated</dt><dd>${esc(generatedAt.replace('T', ' ').slice(0, 16))}</dd></div>
    <div><dt>Source</dt><dd>Bank feed via CoinPay</dd></div>
  </dl>
</header>

${glance}
${rates}
${scopeSection(position, currency)}
${accountsSection(bank, currency)}
${categoriesSection(bank, currency)}
${debtSection(position, currency)}
${recurringSection(position, currency)}

<section>
  <div class="notes">
    <p><strong>What this is.</strong> A direct export of a bank and card feed for the period above. It is not a
    filing, not reconciled against statements, and not advice.</p>
    <p><strong>Coverage.</strong> ${esc(String((bank.ledger ?? []).length))} transactions across
    ${esc(String(num(bank.accountCount)))} accounts${
      coveredStart ? `, ${esc(coveredStart)} to ${esc(coveredEnd)}` : ''
    }. Run-rate figures use a fixed
    ${esc(String(num(position.lookbackDays)))} day lookback and do not move with the period above.</p>
    ${
      // A coverage line that names a period must not imply it covered it. If
      // the ledger is one page of a longer window, the document says so where
      // the claim is made, not in a log nobody keeps.
      bank.ledgerComplete === false
        ? `<p class="warn"><strong>Incomplete.</strong> This is ${esc(String((bank.ledger ?? []).length))}
          of ${esc(String(num(bank.ledgerTotal)))} transactions the API reports for this period. The totals
          below are computed from what was returned and understate the period. Do not reconcile against
          this document.</p>`
        : ''
    }
    ${
      uncategorised > 0
        ? `<p><strong>Uncategorised.</strong> ${(uncategorised * 100).toFixed(0)}% of transactions carry no
      category, so any category total is a floor rather than a complete figure.</p>`
        : ''
    }
    <p><strong>Books split.</strong> Business and personal come from how each account is marked. Anything marked
    "unmarked" has not been assigned and is counted in totals but in neither set of books.</p>
  </div>
</section>

${includeTransactions ? transactionsSection(bank, currency, transactionLimit) : ''}
</div></body></html>`;
}

export default buildFinanceReportHtml;
