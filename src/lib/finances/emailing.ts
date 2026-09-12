import 'server-only';
import { sendEmail, type EmailAttachment } from '../email';
import { getReport, readArtifact, type ReportFormat } from './reports';
import { booksSummary, renderBooksCsv, renderBooksHtml, renderBooksPdf, toPublicRow, type BooksSummary } from './books';
import { resolvePeriod, boundPeriod, type EffectivePeriod } from './periods';
import { createShareLink } from './share';
import { escapeHtml, canonicalJson, GENERATED_BY_NOTICE } from './render';
import { formatFixed, displayDecimalsFor } from './decimal';
import { audit } from './audit';

/**
 * Emailing reports and the CPA pack.
 *
 * Sending bank data by email is the merchant's decision, taken one send at
 * a time, to addresses they typed. What goes out: the files as attachments
 * (when they fit) and an expiring link that needs no login, so an
 * accountant can fetch the same bytes later. The email body carries the
 * period, the per-currency totals and the notices; never a transaction.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_RECIPIENTS = 5;
/** Above this the files travel by link only. */
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export class EmailingError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function normalizeRecipients(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[,;\s]+/) : [];
  const out = [...new Set(raw.map((v) => String(v).trim().toLowerCase()).filter(Boolean))];
  if (out.length === 0) throw new EmailingError('invalid_request', 'At least one recipient email is required', 400);
  if (out.length > MAX_RECIPIENTS) throw new EmailingError('invalid_request', `At most ${MAX_RECIPIENTS} recipients per send`, 400);
  for (const email of out) {
    if (!EMAIL_RE.test(email) || email.length > 254) throw new EmailingError('invalid_request', `Not a valid email address: ${email}`, 400);
  }
  return out;
}

export interface SendOutcome {
  sent: string[];
  failed: Array<{ to: string; error: string }>;
  attached: string[];
  linkUrl: string;
  linkExpiresAt: string;
}

function contentTypeFor(format: string): string {
  return format === 'pdf' ? 'application/pdf' : format === 'csv' ? 'text/csv' : format === 'html' ? 'text/html' : 'application/json';
}

function totalsHtml(totals: Array<{ currency: string; [k: string]: string | number }>, columns: Array<[string, string]>): string {
  if (totals.length === 0) return '<p>No posted activity in this period.</p>';
  return `<table style="border-collapse:collapse;font-size:13px"><thead><tr>${['Currency', ...columns.map(([, label]) => label)].map((h) => `<th style="text-align:left;padding:4px 10px;border-bottom:1px solid #ddd">${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${totals
    .map(
      (t) =>
        `<tr><td style="padding:4px 10px">${escapeHtml(t.currency)}</td>${columns.map(([key]) => `<td style="padding:4px 10px;text-align:right">${escapeHtml(formatFixed(String(t[key]), displayDecimalsFor(t.currency)))}</td>`).join('')}</tr>`,
    )
    .join('')}</tbody></table>`;
}

function wrapEmail(title: string, intro: string, body: string, link: { url: string; expiresAt: string }, message: string | null, attached: string[]): string {
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;max-width:640px">
<h2 style="margin:0 0 8px">${escapeHtml(title)}</h2>
<p style="margin:0 0 12px;color:#444">${escapeHtml(intro)}</p>
${message ? `<blockquote style="margin:0 0 16px;padding:8px 12px;border-left:3px solid #ccc;color:#333">${escapeHtml(message)}</blockquote>` : ''}
${body}
<p style="margin:16px 0 4px">${attached.length ? `Attached: ${escapeHtml(attached.join(', '))}. ` : ''}Download link (expires ${escapeHtml(link.expiresAt.slice(0, 10))}, no login needed):</p>
<p style="margin:0 0 16px"><a href="${escapeHtml(link.url)}">${escapeHtml(link.url)}</a></p>
<p style="font-size:12px;color:#666">${escapeHtml(GENERATED_BY_NOTICE)} Sent from CoinPay at the account owner's request.</p>
</div>`;
}

async function deliver(recipients: string[], subject: string, html: string, attachments: EmailAttachment[]): Promise<{ sent: string[]; failed: Array<{ to: string; error: string }> }> {
  const sent: string[] = [];
  const failed: Array<{ to: string; error: string }> = [];
  for (const to of recipients) {
    const result = await sendEmail({ to, subject, html, attachments });
    if (result.success) sent.push(to);
    else failed.push({ to, error: result.error ?? 'send failed' });
  }
  return { sent, failed };
}

/** Email a ready report revision. */
export async function sendReportEmail(input: {
  merchantId: string;
  reportId: string;
  to: unknown;
  formats?: string[];
  message?: string | null;
  attach?: boolean;
  expiresInDays?: number;
}): Promise<SendOutcome> {
  const recipients = normalizeRecipients(input.to);
  const report = await getReport(input.reportId, input.merchantId);
  if (!report) throw new EmailingError('not_found', 'Report not found', 404);
  if (report.status !== 'ready' && report.status !== 'superseded') throw new EmailingError('report_not_ready', `Report is ${report.status}`, 409);
  const formats = (input.formats?.length ? input.formats : ['pdf', 'csv']).filter((f): f is ReportFormat => ['pdf', 'csv', 'html', 'json'].includes(f));
  if (formats.length === 0) throw new EmailingError('invalid_request', 'formats must be among pdf, csv, html, json', 400);

  const link = await createShareLink({ merchantId: input.merchantId, kind: 'report', reportId: report.id, formats, recipients, expiresInDays: input.expiresInDays });

  const attachments: EmailAttachment[] = [];
  const attached: string[] = [];
  if (input.attach !== false) {
    let total = 0;
    for (const format of formats) {
      const artifact = await readArtifact({ ...report, status: 'ready' }, format);
      if (!artifact) continue;
      if (total + artifact.bytes.length > MAX_ATTACHMENT_BYTES) break;
      total += artifact.bytes.length;
      attachments.push({ filename: artifact.filename, content: artifact.bytes, contentType: contentTypeFor(format) });
      attached.push(artifact.filename);
    }
  }

  const totals = (report.totals as Array<{ currency: string; credits: string; debits: string; net: string; rows: number }> | null) ?? [];
  const body = `<p style="margin:0 0 8px"><strong>${escapeHtml(report.period_label)}</strong> (${escapeHtml(report.timezone)}) · ${report.account_ids.length} account(s) · revision ${report.revision}${report.period_to_date ? ' · period to date' : ''}</p>
${totalsHtml(totals, [['credits', 'Credits'], ['debits', 'Debits'], ['net', 'Net activity'], ['rows', 'Rows']])}
<p style="margin:12px 0 0;font-size:12px;color:#555">Provider coverage: ${escapeHtml(report.provider_coverage ?? 'unknown')}. Reconciliation: ${escapeHtml(report.reconciliation_status)}.${report.warnings?.length ? ` ${report.warnings.length} warning(s) inside the report.` : ''}</p>`;
  const subject = `CoinPay activity report: ${report.period_label}${report.period_to_date ? ' (to date)' : ''}`;
  const html = wrapEmail(subject, 'An activity report generated by CoinPay from imported bank and card data. It is not an institution-issued statement.', body, { url: link.url, expiresAt: link.row.expires_at }, input.message ?? null, attached);

  const outcome = await deliver(recipients, subject, html, attachments);
  await audit(input.merchantId, 'report.email', 'report', report.id, { recipients: recipients.length, sent: outcome.sent.length, failed: outcome.failed.length, attached: attached.length });
  return { ...outcome, attached, linkUrl: link.url, linkExpiresAt: link.row.expires_at };
}

export interface BooksSelection {
  period?: string | null;
  from?: string | null;
  to?: string | null;
  timezone: string;
  scope: 'business' | 'personal' | 'all';
}

export function resolveBooksSelection(sel: BooksSelection): EffectivePeriod {
  let { period, from, to } = sel;
  if (period && /^\d{4}$/.test(period)) {
    const year = Number.parseInt(period, 10);
    from = `${year}-01-01`;
    to = `${year + 1}-01-01`;
    period = null;
  }
  return boundPeriod(resolvePeriod({ period, from, to, timezone: sel.timezone }), new Date());
}

export async function renderBooksFormat(summary: BooksSummary, format: string, extra: Record<string, unknown>): Promise<{ bytes: Buffer; filename: string; contentType: string }> {
  const label = `${summary.start.slice(0, 10)}_${summary.end.slice(0, 10)}-${summary.scope}`;
  if (format === 'csv') return { bytes: Buffer.from(renderBooksCsv(summary), 'utf8'), filename: `coinpay-books-${label}.csv`, contentType: 'text/csv' };
  if (format === 'html') return { bytes: Buffer.from(renderBooksHtml(summary), 'utf8'), filename: `coinpay-books-${label}.html`, contentType: 'text/html' };
  if (format === 'json') return { bytes: Buffer.from(canonicalJson({ ...summary, transactions: summary.transactions.map(toPublicRow), ...extra }), 'utf8'), filename: `coinpay-books-${label}.json`, contentType: 'application/json' };
  return { bytes: await renderBooksPdf(summary), filename: `coinpay-books-${label}.pdf`, contentType: 'application/pdf' };
}

/** Email the CPA pack for a period, as the books stand now. */
export async function sendBooksEmail(input: {
  merchantId: string;
  selection: BooksSelection;
  to: unknown;
  formats?: string[];
  message?: string | null;
  attach?: boolean;
  expiresInDays?: number;
  subjectPrefix?: string;
}): Promise<SendOutcome & { unreviewed: number; rows: number }> {
  const recipients = normalizeRecipients(input.to);
  const formats = (input.formats?.length ? input.formats : ['pdf', 'csv']).filter((f) => ['pdf', 'csv', 'html', 'json'].includes(f));
  if (formats.length === 0) throw new EmailingError('invalid_request', 'formats must be among pdf, csv, html, json', 400);
  const bounded = resolveBooksSelection(input.selection);
  const summary = await booksSummary(input.merchantId, { start: bounded.start, end: bounded.effectiveEnd, scope: input.selection.scope });

  const link = await createShareLink({
    merchantId: input.merchantId,
    kind: 'books',
    params: { start: bounded.start, end: bounded.effectiveEnd, scope: input.selection.scope, timezone: bounded.timezone, label: bounded.label },
    formats,
    recipients,
    expiresInDays: input.expiresInDays,
  });

  const attachments: EmailAttachment[] = [];
  const attached: string[] = [];
  if (input.attach !== false) {
    let total = 0;
    for (const format of formats) {
      const file = await renderBooksFormat(summary, format, { timezone: bounded.timezone, periodLabel: bounded.label });
      if (total + file.bytes.length > MAX_ATTACHMENT_BYTES) break;
      total += file.bytes.length;
      attachments.push({ filename: file.filename, content: file.bytes, contentType: file.contentType });
      attached.push(file.filename);
    }
  }

  const body = `<p style="margin:0 0 8px"><strong>${escapeHtml(bounded.label)}</strong> (${escapeHtml(bounded.timezone)}) · ${escapeHtml(input.selection.scope)} books${bounded.periodToDate ? ' · period to date' : ''}</p>
${totalsHtml(summary.totals as Array<{ currency: string; [k: string]: string | number }>, [['income', 'Income'], ['expenses', 'Expenses'], ['net', 'Net'], ['excluded', 'Excluded']])}
<p style="margin:12px 0 0;font-size:12px;color:#555">${summary.rows} rows, ${summary.unreviewed} not yet reviewed, ${summary.uncategorized} uncategorised. Tax categories are a bookkeeping mapping prepared for an accountant, not tax advice.</p>`;
  const subject = `${input.subjectPrefix ?? 'CoinPay books'}: ${bounded.label} (${input.selection.scope})`;
  const html = wrapEmail(subject, 'Totals by tax category and the rows behind them, from the CoinPay books as they stand today.', body, { url: link.url, expiresAt: link.row.expires_at }, input.message ?? null, attached);

  const outcome = await deliver(recipients, subject, html, attachments);
  await audit(input.merchantId, 'books.email', 'merchant', input.merchantId, { recipients: recipients.length, sent: outcome.sent.length, failed: outcome.failed.length, attached: attached.length, scope: input.selection.scope });
  return { ...outcome, attached, linkUrl: link.url, linkExpiresAt: link.row.expires_at, unreviewed: summary.unreviewed, rows: summary.rows };
}
