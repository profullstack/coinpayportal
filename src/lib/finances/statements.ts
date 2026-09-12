import 'server-only';
import { inflateSync, constants as zlibConstants } from 'zlib';
import { getSupabaseAdmin } from '../supabase/server';
import { merchantOwnsAccount } from './summary';
import { putObject, getObject, deleteObject, sha256Hex, objectExists } from './files';
import { parseIsoDate, resolvePeriod, isValidTimeZone } from './periods';
import { audit } from './audit';

/**
 * The statement library: original PDFs the merchant uploads.
 *
 * What CoinPay knows about one of these files is exactly what the user said
 * about it — which account, which period, which institution — plus the
 * bytes. Nothing is extracted from the PDF into the ledger and nothing
 * about its issuer is verified; the provenance column says `user_supplied`
 * and every label calls it "Imported bank statement — user supplied".
 *
 * Before a file is accepted it is inspected: PDF magic, size, and a scan of
 * the raw and inflated streams for encryption and active content
 * (JavaScript, launch actions, embedded files, XFA forms). A file that
 * cannot be inspected — encrypted, or not a PDF — is refused with the
 * reason; a bank password is never asked for. Inspection is synchronous, so
 * a row exists only for a file that passed; there is no half-state where a
 * quarantined file is downloadable.
 */

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

export function maxStatementBytes(): number {
  const configured = Number(process.env.FINANCES_STATEMENT_MAX_BYTES ?? DEFAULT_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, DEFAULT_MAX_BYTES) : DEFAULT_MAX_BYTES;
}

export class StatementError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Names whose presence means the PDF carries something we will not trust. */
const ACTIVE_CONTENT = [
  { pattern: /\/JavaScript\b/, reason: 'contains JavaScript' },
  { pattern: /\/JS\b/, reason: 'contains a JavaScript action' },
  { pattern: /\/Launch\b/, reason: 'contains a launch action' },
  { pattern: /\/OpenAction\b/, reason: 'runs an action when opened' },
  { pattern: /\/AA\b/, reason: 'contains additional actions' },
  { pattern: /\/EmbeddedFile\b/, reason: 'contains an embedded file' },
  { pattern: /\/RichMedia\b/, reason: 'contains rich media' },
  { pattern: /\/XFA\b/, reason: 'contains an XFA form' },
  { pattern: /\/GoToR\b/, reason: 'contains a remote go-to action' },
  { pattern: /\/SubmitForm\b/, reason: 'contains a form submission action' },
  { pattern: /\/ImportData\b/, reason: 'contains a data import action' },
];

export type PdfInspection = { ok: true; pages: number | null } | { ok: false; reason: string };

/**
 * Inspect PDF bytes without rendering them.
 *
 * Streams are inflated so a name hidden in an object stream is seen too;
 * a stream that will not inflate is skipped rather than treated as a
 * failure, since image data is not Flate.
 */
export function inspectPdf(bytes: Buffer): PdfInspection {
  if (bytes.length < 16) return { ok: false, reason: 'the file is too small to be a PDF' };
  const head = bytes.subarray(0, 1024).toString('latin1');
  if (!head.includes('%PDF-')) return { ok: false, reason: 'the file is not a PDF (missing %PDF header)' };
  const text = bytes.toString('latin1');
  if (!/\bstartxref\b/.test(text) && !/\btrailer\b/.test(text)) {
    return { ok: false, reason: 'the file is not a complete PDF (no trailer)' };
  }
  if (/\/Encrypt\b/.test(text)) {
    return { ok: false, reason: 'the PDF is encrypted; remove the password with your PDF viewer before importing' };
  }

  const segments: string[] = [text];
  const streamRe = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  let inflated = 0;
  while ((match = streamRe.exec(text)) !== null && inflated < 5000) {
    const start = match.index + match[0].length;
    const end = text.indexOf('endstream', start);
    if (end === -1) break;
    const raw = bytes.subarray(start, end);
    try {
      const out = inflateSync(raw, { finishFlush: zlibConstants.Z_SYNC_FLUSH, maxOutputLength: 32 * 1024 * 1024 });
      segments.push(out.toString('latin1'));
      inflated += 1;
    } catch {
      // Not Flate, or damaged: nothing to scan here.
    }
    streamRe.lastIndex = end;
  }

  for (const segment of segments) {
    for (const { pattern, reason } of ACTIVE_CONTENT) {
      if (pattern.test(segment)) return { ok: false, reason: `the PDF ${reason}, which CoinPay does not accept` };
    }
  }

  const pageMatches = text.match(/\/Type\s*\/Page\b/g);
  return { ok: true, pages: pageMatches ? pageMatches.length : null };
}

export interface FinanceStatementRow {
  id: string;
  merchant_id: string;
  account_id: string;
  institution_label: string | null;
  cycle: string;
  period_start: string;
  period_end: string;
  timezone: string;
  notes: string | null;
  original_filename: string | null;
  content_type: string;
  bytes: number;
  content_hash: string;
  object_key: string;
  key_version: number;
  scan_state: string;
  scan_reason: string | null;
  provenance: string;
  state: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATEMENT_COLUMNS =
  'id, merchant_id, account_id, institution_label, cycle, period_start, period_end, timezone, notes, original_filename, content_type, bytes, content_hash, object_key, key_version, scan_state, scan_reason, provenance, state, deleted_at, created_at, updated_at';

export function toPublicStatement(s: FinanceStatementRow, reconciliation: Record<string, unknown> | null = null) {
  return {
    id: s.id,
    accountId: s.account_id,
    institutionLabel: s.institution_label,
    label: 'Imported bank statement — user supplied',
    cycle: s.cycle,
    periodStart: s.period_start,
    periodEnd: s.period_end,
    timezone: s.timezone,
    notes: s.notes,
    originalFilename: s.original_filename,
    contentType: s.content_type,
    bytes: s.bytes,
    sha256: s.content_hash,
    scanState: s.scan_state,
    scanReason: s.scan_reason,
    provenance: s.provenance,
    verified: false,
    reconciliation,
    createdAt: s.created_at,
  };
}

/** A safe filename for downloads: the user's name, stripped to a whitelist. */
function safeFilename(original: string | null, fallback: string): string {
  const base = (original ?? '').replace(/^.*[\\/]/, '').replace(/[^0-9A-Za-z._-]/g, '_').replace(/^_+/, '');
  const name = base && base !== '.pdf' ? base : fallback;
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
}

export interface ImportStatementInput {
  merchantId: string;
  accountId: string;
  bytes: Buffer;
  originalFilename?: string | null;
  institutionLabel?: string | null;
  cycle?: 'monthly' | 'quarterly' | 'custom';
  /** Either a period selector... */
  period?: string | null;
  /** ...or an explicit [from, to) in local dates. */
  from?: string | null;
  to?: string | null;
  timezone: string;
  notes?: string | null;
}

export async function importStatement(input: ImportStatementInput): Promise<{ statement: FinanceStatementRow; duplicateOf: string | null }> {
  if (!isValidTimeZone(input.timezone)) throw new StatementError('invalid_timezone', 'Timezone must be an IANA name', 400);
  if (!(await merchantOwnsAccount(input.accountId, input.merchantId))) {
    throw new StatementError('not_found', 'Account not found', 404);
  }
  if (input.bytes.length === 0) throw new StatementError('document_rejected', 'The file is empty', 400);
  if (input.bytes.length > maxStatementBytes()) {
    throw new StatementError('document_rejected', `The file is larger than ${Math.floor(maxStatementBytes() / (1024 * 1024))} MiB`, 413);
  }
  const inspection = inspectPdf(input.bytes);
  if (!inspection.ok) throw new StatementError('document_rejected', `Rejected: ${inspection.reason}`, 422);

  let periodStart: string;
  let periodEnd: string;
  let cycle: 'monthly' | 'quarterly' | 'custom' = input.cycle ?? 'custom';
  if (input.period) {
    const resolved = resolvePeriod({ period: input.period, timezone: input.timezone });
    periodStart = resolved.startDate;
    periodEnd = resolved.endDate;
    if (!input.cycle) cycle = resolved.kind === 'month' ? 'monthly' : resolved.kind === 'quarter' ? 'quarterly' : 'custom';
  } else {
    const f = parseIsoDate(input.from);
    const t = parseIsoDate(input.to);
    if (!f || !t) throw new StatementError('invalid_period', 'Pass a period (2026-08) or from/to dates (YYYY-MM-DD, to is exclusive)', 400);
    if (t <= f) throw new StatementError('invalid_period', 'The to date is exclusive and must be after the from date', 400);
    periodStart = f;
    periodEnd = t;
  }

  const supabase = getSupabaseAdmin();
  const hash = sha256Hex(input.bytes);
  const { data: same, error: sameError } = await supabase
    .from('finance_statements')
    .select('id, account_id, period_start, period_end')
    .eq('merchant_id', input.merchantId)
    .eq('content_hash', hash)
    .eq('state', 'active')
    .limit(20);
  if (sameError) throw new Error(`Could not check for duplicates: ${sameError.message}`);
  const exact = (same ?? []).find(
    (s) => s.account_id === input.accountId && s.period_start === periodStart && s.period_end === periodEnd,
  );
  if (exact) {
    // Identical bytes, identical association: the same import, repeated.
    const existing = await getStatement(exact.id as string, input.merchantId);
    if (existing) return { statement: existing, duplicateOf: existing.id };
  }
  const duplicateOf = (same ?? [])[0]?.id ?? null;

  const stored = await putObject('statements', input.merchantId, input.bytes);
  const { data, error } = await supabase
    .from('finance_statements')
    .insert({
      merchant_id: input.merchantId,
      account_id: input.accountId,
      institution_label: input.institutionLabel?.trim().slice(0, 200) || null,
      cycle,
      period_start: periodStart,
      period_end: periodEnd,
      timezone: input.timezone,
      notes: input.notes?.trim().slice(0, 2000) || null,
      original_filename: input.originalFilename ? safeFilename(input.originalFilename, 'statement') : null,
      content_type: 'application/pdf',
      bytes: stored.bytes,
      content_hash: stored.sha256,
      object_key: stored.objectKey,
      key_version: stored.keyVersion,
      scan_state: 'clean',
      scan_reason: inspection.pages !== null ? `inspected; ${inspection.pages} page object(s)` : 'inspected',
      provenance: 'user_supplied',
    })
    .select(STATEMENT_COLUMNS)
    .single();
  if (error) {
    await deleteObject(stored.objectKey).catch(() => undefined);
    throw new Error(`Could not save the statement: ${error.message}`);
  }
  const statement = data as FinanceStatementRow;
  await audit(input.merchantId, 'statement.import', 'statement', statement.id, {
    bytes: statement.bytes, cycle, duplicateOf, account: input.accountId,
  });
  return { statement, duplicateOf: duplicateOf === statement.id ? null : duplicateOf };
}

export async function getStatement(statementId: string, merchantId: string): Promise<FinanceStatementRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_statements')
    .select(STATEMENT_COLUMNS)
    .eq('id', statementId)
    .eq('merchant_id', merchantId)
    .eq('state', 'active')
    .maybeSingle();
  if (error) throw new Error(`Could not read the statement: ${error.message}`);
  return (data as FinanceStatementRow | null) ?? null;
}

export async function listStatements(
  merchantId: string,
  filters: { accountId?: string | null; period?: string | null; from?: string | null; to?: string | null; timezone?: string | null; limit?: number } = {},
): Promise<FinanceStatementRow[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('finance_statements')
    .select(STATEMENT_COLUMNS)
    .eq('merchant_id', merchantId)
    .eq('state', 'active')
    .order('period_start', { ascending: false })
    .limit(Math.min(Math.max(filters.limit ?? 100, 1), 500));
  if (filters.accountId) query = query.eq('account_id', filters.accountId);
  let from = parseIsoDate(filters.from);
  let to = parseIsoDate(filters.to);
  if (filters.period) {
    const resolved = resolvePeriod({ period: filters.period, timezone: filters.timezone && isValidTimeZone(filters.timezone) ? filters.timezone : 'UTC' });
    from = resolved.startDate;
    to = resolved.endDate;
  }
  if (from && to) query = query.lt('period_start', to).gt('period_end', from);
  const { data, error } = await query;
  if (error) throw new Error(`Could not list statements: ${error.message}`);
  return (data ?? []) as FinanceStatementRow[];
}

export async function readStatementBytes(statement: FinanceStatementRow): Promise<{ bytes: Buffer; filename: string }> {
  if (statement.scan_state !== 'clean') throw new StatementError('document_quarantined', 'This file has not passed inspection', 409);
  if (!(await objectExists(statement.object_key))) throw new StatementError('storage_error', 'The stored file is not available on this server', 503);
  const bytes = await getObject(statement.object_key);
  if (sha256Hex(bytes) !== statement.content_hash) {
    throw new StatementError('storage_error', 'The stored file does not match its recorded hash', 500);
  }
  return { bytes, filename: safeFilename(statement.original_filename, `bank-statement-${statement.period_start}`) };
}

/**
 * Delete the bytes and retire the metadata. Dependent reconciliation
 * evidence becomes `unavailable`; synced transactions are untouched.
 */
export async function deleteStatement(statementId: string, merchantId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const statement = await getStatement(statementId, merchantId);
  if (!statement) return false;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('finance_statements')
    .update({ state: 'deleted', deleted_at: now, updated_at: now })
    .eq('id', statementId)
    .eq('merchant_id', merchantId);
  if (error) throw new Error(`Could not delete the statement: ${error.message}`);
  await deleteObject(statement.object_key).catch((err) => console.error('[finances/statements] object delete failed', err?.message));
  await supabase
    .from('finance_reconciliations')
    .update({ state: 'unavailable', invalidated_at: now })
    .eq('statement_id', statementId)
    .eq('merchant_id', merchantId)
    .in('state', ['matched', 'mismatch', 'user_reconciled']);
  await audit(merchantId, 'statement.delete', 'statement', statementId, { bytes: statement.bytes });
  return true;
}
