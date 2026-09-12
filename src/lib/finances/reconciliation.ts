import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';
import { getReport, getReportDataset, ReportError } from './reports';
import { getStatement } from './statements';
import { localDate } from './periods';
import { parseExactAmount, addAmounts, subtractAmounts, negateAmount, isZeroAmount, type ExactAmount } from './decimal';
import { audit } from './audit';

/**
 * Statement-to-report reconciliation.
 *
 *   expected closing = entered opening + sum(posted signed amounts)
 *   difference       = entered closing - expected closing
 *
 * All four values are exact decimals. The sum comes from the report's
 * frozen dataset for the statement's account, so the check is against a
 * specific immutable revision and is invalidated with it. A zero difference
 * plus the user's acknowledgement is `user_reconciled`; it is never
 * `bank_verified`, because nothing here has checked that every transaction
 * the bank printed is one CoinPay holds.
 *
 * Sign convention: a credit-card statement prints what is owed as a
 * positive number, while this ledger stores a liability balance negative.
 * `liability_positive` negates the entered balances so the arithmetic
 * lines up; `as_stated` uses them as typed. The values as typed are stored
 * either way.
 */

export type SignConvention = 'as_stated' | 'liability_positive';
export type ReconciliationState = 'matched' | 'mismatch' | 'unavailable' | 'user_reconciled' | 'invalidated';

export interface ReconciliationRow {
  id: string;
  merchant_id: string;
  statement_id: string;
  account_id: string;
  report_id: string;
  currency: string;
  entered_opening: string;
  entered_closing: string;
  entered_credits: string | null;
  entered_debits: string | null;
  sign_convention: SignConvention;
  normalized_opening: string;
  normalized_closing: string;
  expected_closing: string;
  difference: string;
  state: ReconciliationState;
  acknowledged: boolean;
  actor_merchant_id: string | null;
  dataset_hash: string | null;
  version: number;
  created_at: string;
  invalidated_at: string | null;
}

const COLUMNS =
  'id, merchant_id, statement_id, account_id, report_id, currency, entered_opening, entered_closing, entered_credits, entered_debits, sign_convention, normalized_opening, normalized_closing, expected_closing, difference, state, acknowledged, actor_merchant_id, dataset_hash, version, created_at, invalidated_at';

export function toPublicReconciliation(r: ReconciliationRow) {
  return {
    id: r.id,
    statementId: r.statement_id,
    reportId: r.report_id,
    accountId: r.account_id,
    currency: r.currency,
    entered: { opening: r.entered_opening, closing: r.entered_closing, credits: r.entered_credits, debits: r.entered_debits },
    signConvention: r.sign_convention,
    normalized: { opening: r.normalized_opening, closing: r.normalized_closing },
    expectedClosing: r.expected_closing,
    difference: r.difference,
    state: r.state,
    acknowledged: r.acknowledged,
    datasetHash: r.dataset_hash,
    version: r.version,
    createdAt: r.created_at,
    invalidatedAt: r.invalidated_at,
    bankVerified: false,
  };
}

export interface ReconcileInput {
  merchantId: string;
  statementId: string;
  reportId: string;
  opening: unknown;
  closing: unknown;
  credits?: unknown;
  debits?: unknown;
  currency: unknown;
  signConvention?: SignConvention;
  acknowledge?: boolean;
}

/** Pure arithmetic, exported for tests. */
export function computeReconciliation(params: {
  opening: ExactAmount;
  closing: ExactAmount;
  postedNet: ExactAmount;
  signConvention: SignConvention;
}): { normalizedOpening: ExactAmount; normalizedClosing: ExactAmount; expectedClosing: ExactAmount; difference: ExactAmount } {
  const flip = params.signConvention === 'liability_positive';
  const normalizedOpening = flip ? negateAmount(params.opening) : params.opening;
  const normalizedClosing = flip ? negateAmount(params.closing) : params.closing;
  const expectedClosing = addAmounts(normalizedOpening, params.postedNet);
  const difference = subtractAmounts(normalizedClosing, expectedClosing);
  return { normalizedOpening, normalizedClosing, expectedClosing, difference };
}

export async function reconcileStatement(input: ReconcileInput): Promise<ReconciliationRow> {
  const supabase = getSupabaseAdmin();
  const statement = await getStatement(input.statementId, input.merchantId);
  if (!statement) throw new ReportError('not_found', 'Statement not found', 404);
  const report = await getReport(input.reportId, input.merchantId);
  if (!report) throw new ReportError('not_found', 'Report not found', 404);
  if (report.status !== 'ready' && report.status !== 'superseded') {
    throw new ReportError('report_not_ready', `Report is ${report.status}; reconciliation needs a ready revision`, 409);
  }
  if (!report.account_ids.includes(statement.account_id)) {
    throw new ReportError('invalid_request', 'The report does not include the statement’s account', 400);
  }
  const reportStart = localDate(new Date(report.requested_start), report.timezone);
  const reportEnd = localDate(new Date(report.effective_end), report.timezone);
  if (reportStart !== statement.period_start || reportEnd !== statement.period_end) {
    throw new ReportError(
      'invalid_request',
      `The report covers ${reportStart} to ${reportEnd} but the statement covers ${statement.period_start} to ${statement.period_end}; generate a report for the statement’s period`,
      400,
    );
  }

  const dataset = await getReportDataset(report.id, input.merchantId);
  if (!dataset) throw new ReportError('report_not_ready', 'The report dataset is not available', 409);
  const account = dataset.accounts.find((a) => a.id === statement.account_id);
  if (!account) throw new ReportError('invalid_request', 'The report dataset does not contain the account', 400);

  const currency = typeof input.currency === 'string' ? input.currency.trim() : '';
  if (!currency || currency !== account.currency) {
    throw new ReportError('invalid_request', `Enter balances in the account currency (${account.currency})`, 400);
  }
  const opening = parseExactAmount(input.opening);
  const closing = parseExactAmount(input.closing);
  if (opening === null || closing === null) throw new ReportError('invalid_request', 'Opening and closing balances must be exact decimals with at most four places', 400);
  const credits = input.credits === undefined || input.credits === null || input.credits === '' ? null : parseExactAmount(input.credits);
  const debits = input.debits === undefined || input.debits === null || input.debits === '' ? null : parseExactAmount(input.debits);
  if (credits === null && input.credits) throw new ReportError('invalid_request', 'credits must be an exact decimal', 400);
  if (debits === null && input.debits) throw new ReportError('invalid_request', 'debits must be an exact decimal', 400);
  const signConvention: SignConvention = input.signConvention === 'liability_positive' ? 'liability_positive' : 'as_stated';

  const accountTotals = dataset.accountTotals.find((t) => t.accountId === statement.account_id);
  const postedNet: ExactAmount = accountTotals?.net ?? '0';
  const computed = computeReconciliation({ opening, closing, postedNet, signConvention });
  const matched = isZeroAmount(computed.difference);
  const state: ReconciliationState = matched ? (input.acknowledge ? 'user_reconciled' : 'matched') : 'mismatch';

  const now = new Date().toISOString();
  await supabase
    .from('finance_reconciliations')
    .update({ state: 'invalidated', invalidated_at: now })
    .eq('statement_id', statement.id)
    .eq('report_id', report.id)
    .eq('merchant_id', input.merchantId)
    .in('state', ['matched', 'mismatch', 'user_reconciled']);

  const { data: prior } = await supabase
    .from('finance_reconciliations')
    .select('version')
    .eq('statement_id', statement.id)
    .eq('merchant_id', input.merchantId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = ((prior?.version as number | undefined) ?? 0) + 1;

  const { data, error } = await supabase
    .from('finance_reconciliations')
    .insert({
      merchant_id: input.merchantId,
      statement_id: statement.id,
      account_id: statement.account_id,
      report_id: report.id,
      currency,
      entered_opening: String(input.opening),
      entered_closing: String(input.closing),
      entered_credits: credits,
      entered_debits: debits,
      sign_convention: signConvention,
      normalized_opening: computed.normalizedOpening,
      normalized_closing: computed.normalizedClosing,
      expected_closing: computed.expectedClosing,
      difference: computed.difference,
      state,
      acknowledged: input.acknowledge === true,
      actor_merchant_id: input.merchantId,
      dataset_hash: report.dataset_hash,
      version,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(`Could not save the reconciliation: ${error.message}`);

  if (state === 'user_reconciled' || state === 'mismatch') {
    await supabase
      .from('finance_reports')
      .update({ reconciliation_status: state, updated_at: now })
      .eq('id', report.id)
      .eq('merchant_id', input.merchantId);
  }
  await audit(input.merchantId, 'statement.reconcile', 'statement', statement.id, { report: report.id, state, version });
  return data as ReconciliationRow;
}

export async function listReconciliations(statementId: string, merchantId: string): Promise<ReconciliationRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_reconciliations')
    .select(COLUMNS)
    .eq('statement_id', statementId)
    .eq('merchant_id', merchantId)
    .order('version', { ascending: false });
  if (error) throw new Error(`Could not list reconciliations: ${error.message}`);
  return (data ?? []) as ReconciliationRow[];
}
