import type { CoinPayClient } from './client.js';

export type ProviderCoverage = 'unknown' | 'partial' | 'available_window_fetched';
export type ReconciliationStatus = 'not_attempted' | 'unavailable' | 'mismatch' | 'user_reconciled';
export type ReportFormat = 'pdf' | 'html' | 'csv' | 'json';
export type ReportStatus = 'queued' | 'generating' | 'ready' | 'failed' | 'superseded' | 'deleted';
export type JobStatus = 'queued' | 'running' | 'waiting_for_budget' | 'partial' | 'failed' | 'completed' | 'cancelled';
export type JobKind = 'backfill' | 'refresh' | 'scheduled_sync' | 'report' | 'categorize' | 'email_report';

/** Thrown by every call here when the server answers with its structured error body. */
export interface FinanceApiError extends Error {
  code?: string;
  status?: number;
  retryable?: boolean;
  jobId?: string;
  reportId?: string;
  retryAfter?: string | null;
}

export interface FinanceJob {
  id: string;
  kind: JobKind;
  connectionId: string | null;
  status: JobStatus;
  params: Record<string, unknown>;
  progress: Record<string, unknown>;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface FinanceReportPeriod {
  kind: 'month' | 'quarter' | 'custom';
  selector: string;
  label: string;
  timezone: string;
  start: string;
  end: string;
  effectiveEnd: string;
  periodToDate: boolean;
  cutoff: string;
}

export interface FinanceReportTotals {
  currency: string;
  credits: string;
  debits: string;
  net: string;
  rows: number;
}

export interface FinanceReport {
  id: string;
  revision: number;
  supersedesReportId: string | null;
  supersededByReportId: string | null;
  jobId: string | null;
  period: FinanceReportPeriod;
  scope: 'all' | 'business' | 'personal';
  accountIds: string[];
  includeHidden: boolean;
  includePending: boolean;
  strict: boolean;
  status: ReportStatus;
  local_export_complete: boolean | null;
  provider_coverage: ProviderCoverage | null;
  reconciliation_status: ReconciliationStatus;
  datasetHash: string | null;
  rowCount: number | null;
  pendingCount: number | null;
  totals: FinanceReportTotals[] | null;
  warnings: string[];
  rendererVersion: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  artifacts: Array<{ format: ReportFormat; bytes: number; sha256: string }>;
  createdAt: string;
  generatedAt: string | null;
  notice: string;
}

export interface BinaryResponse {
  bytes: Uint8Array;
  contentType: string;
  filename: string | null;
  sha256: string | null;
  headers: Record<string, string>;
}

export interface FinanceStatement {
  id: string;
  accountId: string;
  institutionLabel: string | null;
  label: string;
  cycle: 'monthly' | 'quarterly' | 'custom';
  periodStart: string;
  periodEnd: string;
  timezone: string;
  notes: string | null;
  originalFilename: string | null;
  contentType: string;
  bytes: number;
  sha256: string;
  scanState: 'quarantined' | 'clean' | 'rejected';
  scanReason: string | null;
  provenance: string;
  verified: false;
  reconciliation: FinanceReconciliation | null;
  createdAt: string;
}

export interface FinanceReconciliation {
  id: string;
  statementId: string;
  reportId: string;
  accountId: string;
  currency: string;
  entered: { opening: string; closing: string; credits: string | null; debits: string | null };
  signConvention: 'as_stated' | 'liability_positive';
  normalized: { opening: string; closing: string };
  expectedClosing: string;
  difference: string;
  state: 'matched' | 'mismatch' | 'unavailable' | 'user_reconciled' | 'invalidated';
  acknowledged: boolean;
  datasetHash: string | null;
  version: number;
  createdAt: string;
  invalidatedAt: string | null;
  bankVerified: false;
}

export interface AccountCoverage {
  accountId: string;
  name: string | null;
  org_name: string | null;
  currency: string | null;
  coverage: ProviderCoverage;
  fraction: number;
  gaps: Array<{ start: string; end: string }>;
  warnings: string[];
  capped: boolean;
  rowsRejected: number;
}

export interface PeriodSelection {
  period?: string;
  from?: string;
  to?: string;
  timezone?: string;
}

export function connectSimpleFin(
  client: CoinPayClient,
  options: { setupToken: string; label?: string; protocolVersion?: 1 | 2; idempotencyKey?: string },
): Promise<{ connection: Record<string, unknown>; replayed?: boolean }>;
export function disconnectFinanceConnection(client: CoinPayClient, connectionId: string): Promise<{ connection: Record<string, unknown>; note: string }>;
export function describeFinanceConnection(
  client: CoinPayClient,
  connectionId: string,
): Promise<{ connection: Record<string, unknown>; deletionWouldRemove: { accounts: number; transactions: number; statements: number; reports: number } }>;
export function deleteFinanceConnection(client: CoinPayClient, connectionId: string, options: { confirm: true }): Promise<{ success: boolean; removed: Record<string, number> }>;
export function setFinanceSyncConsent(client: CoinPayClient, connectionId: string, dailySync: boolean): Promise<{ connection: Record<string, unknown> }>;

export function createBackfillJob(
  client: CoinPayClient,
  options: PeriodSelection & { connectionId?: string; idempotencyKey?: string },
): Promise<{ jobs: FinanceJob[]; job: FinanceJob; timezone?: { timezone: string; source: 'request' | 'saved' } }>;
export function createRefreshJob(client: CoinPayClient, options: { connectionId: string; days?: number; idempotencyKey?: string }): Promise<{ jobs: FinanceJob[]; job: FinanceJob }>;
export function getFinanceJob(client: CoinPayClient, jobId: string): Promise<FinanceJob>;
export function listFinanceJobs(client: CoinPayClient, options?: { limit?: number; connectionId?: string }): Promise<FinanceJob[]>;
export function cancelFinanceJob(client: CoinPayClient, jobId: string): Promise<FinanceJob>;
export function waitForFinanceJob(
  client: CoinPayClient,
  jobId: string,
  options?: { intervalMs?: number; timeoutMs?: number; onProgress?: (job: FinanceJob) => void; sleep?: (ms: number) => Promise<void> },
): Promise<FinanceJob>;

export function getFinanceCoverage(
  client: CoinPayClient,
  options: PeriodSelection & { accountIds?: string[]; includeHidden?: boolean },
): Promise<{ period: FinanceReportPeriod; provider_coverage: ProviderCoverage; accounts: AccountCoverage[] }>;

export function createFinanceReport(
  client: CoinPayClient,
  options: PeriodSelection & {
    accountIds?: string[];
    scope?: 'all' | 'business' | 'personal';
    includeHidden?: boolean;
    includePendingAppendix?: boolean;
    formats?: ReportFormat[];
    strict?: boolean;
    /** Fill the days before the first observed posting with a labelled extrapolation. */
    estimateGaps?: boolean;
    idempotencyKey?: string;
  },
): Promise<{ report: FinanceReport; job: FinanceJob }>;
export function listFinanceReports(client: CoinPayClient, options?: { limit?: number; offset?: number }): Promise<{ reports: FinanceReport[]; total: number }>;
export function getFinanceReport(client: CoinPayClient, reportId: string): Promise<{ report: FinanceReport; job: FinanceJob | null }>;
export function deleteFinanceReport(client: CoinPayClient, reportId: string): Promise<{ success: boolean; note: string }>;
export function waitForFinanceReport(
  client: CoinPayClient,
  reportId: string,
  options?: { intervalMs?: number; timeoutMs?: number; onProgress?: (data: { report: FinanceReport; job: FinanceJob | null }) => void; sleep?: (ms: number) => Promise<void> },
): Promise<{ report: FinanceReport; job: FinanceJob | null }>;
export function downloadFinanceReport(client: CoinPayClient, reportId: string, options?: { format?: ReportFormat }): Promise<BinaryResponse>;

export function importFinanceStatement(
  client: CoinPayClient,
  options: PeriodSelection & {
    file: Uint8Array | Blob;
    filename?: string;
    accountId: string;
    institutionLabel?: string;
    cycle?: 'monthly' | 'quarterly' | 'custom';
    notes?: string;
  },
): Promise<{ statement: FinanceStatement; duplicateOf: string | null; note: string }>;
export function listFinanceStatements(
  client: CoinPayClient,
  options?: PeriodSelection & { accountId?: string; limit?: number },
): Promise<FinanceStatement[]>;
export function getFinanceStatement(client: CoinPayClient, statementId: string): Promise<{ statement: FinanceStatement; reconciliations: FinanceReconciliation[] }>;
export function downloadFinanceStatement(client: CoinPayClient, statementId: string): Promise<BinaryResponse>;
export function deleteFinanceStatement(client: CoinPayClient, statementId: string): Promise<{ success: boolean; note: string }>;
export function reconcileFinanceStatement(
  client: CoinPayClient,
  statementId: string,
  options: {
    reportId: string;
    opening: string;
    closing: string;
    credits?: string;
    debits?: string;
    currency: string;
    signConvention?: 'as_stated' | 'liability_positive';
    acknowledge?: boolean;
  },
): Promise<FinanceReconciliation>;

export interface BooksRow {
  id: string;
  accountId: string;
  accountName: string;
  orgName: string | null;
  currency: string;
  posted: string | null;
  amount: string;
  payee: string | null;
  description: string | null;
  memo: string | null;
  category: string | null;
  categorySource: 'auto' | 'rule' | 'model' | 'user';
  categoryConfidence: number | null;
  taxCategory: string | null;
  taxCategoryLabel: string;
  scope: 'business' | 'personal' | string;
  scopeOverride: string | null;
  accountScope: string;
  reviewedAt: string | null;
  note: string | null;
  suggestion: { category: string | null; taxCategory: string | null; confidence: number | null; by: string | null } | null;
}

export interface BooksRule {
  id: string;
  match_field: 'payee' | 'description';
  match_type: 'exact' | 'contains';
  pattern: string;
  category: string;
  tax_category: string | null;
  scope: 'business' | 'personal' | null;
  hits: number;
  active: boolean;
  created_at: string;
}

export interface BooksSummaryLine {
  taxCategory: string;
  label: string;
  currency: string;
  total: string;
  rows: number;
  excluded: boolean;
  income: boolean;
}

export function listBooksQueue(
  client: CoinPayClient,
  options?: { status?: 'unreviewed' | 'reviewed' | 'all'; scope?: 'business' | 'personal' | 'all'; accountId?: string; search?: string; start?: string; end?: string; limit?: number; offset?: number },
): Promise<{ rows: BooksRow[]; total: number; unreviewed: number; categories: string[]; taxCategories: Array<{ id: string; label: string }>; modelEnabled: boolean }>;
export function reviewBooksTransaction(
  client: CoinPayClient,
  transactionId: string,
  options?: { category?: string | null; taxCategory?: string | null; scope?: 'business' | 'personal' | null; note?: string | null; createRule?: boolean },
): Promise<BooksRow>;
export function bulkReviewBooks(
  client: CoinPayClient,
  ids: string[],
  options?: { category?: string | null; taxCategory?: string | null; scope?: 'business' | 'personal' | null; createRule?: boolean },
): Promise<{ reviewed: number }>;
export function categorizeBooks(client: CoinPayClient, options?: { useModel?: boolean; onlyUncategorized?: boolean }): Promise<{ job: FinanceJob; modelEnabled: boolean }>;
export function listBooksRules(client: CoinPayClient): Promise<BooksRule[]>;
export function createBooksRule(
  client: CoinPayClient,
  options: { matchField?: 'payee' | 'description'; matchType?: 'exact' | 'contains'; pattern: string; category: string; taxCategory?: string | null; scope?: 'business' | 'personal' | null },
): Promise<BooksRule>;
export function deleteBooksRule(client: CoinPayClient, ruleId: string): Promise<{ success: boolean }>;
export function getBooksSummary(
  client: CoinPayClient,
  options?: PeriodSelection & { scope?: 'business' | 'personal' | 'all'; rows?: boolean },
): Promise<{ period: Record<string, unknown>; scope: string; lines: BooksSummaryLine[]; totals: Array<{ currency: string; income: string; expenses: string; net: string; excluded: string }>; rows: number; unreviewed: number; uncategorized: number; notice: string; transactions?: BooksRow[] }>;
export function exportBooks(client: CoinPayClient, options?: PeriodSelection & { scope?: 'business' | 'personal' | 'all'; format?: 'csv' | 'pdf' | 'html' | 'json'; withDocuments?: boolean }): Promise<BinaryResponse>;

export interface FinanceDocument {
  id: string;
  title: string;
  category: 'report' | 'statement' | 'tax' | 'invoice' | 'other';
  periodLabel: string | null;
  notes: string | null;
  filename: string | null;
  contentType: string;
  bytes: number;
  source: 'upload' | 'api' | 'fetch' | 'cloud';
  institutionKey: string | null;
  taxYear: number | null;
  docType: string | null;
  uploadedBy: string | null;
  createdAt: string;
  downloadUrl: string;
}
export function uploadFinanceDocument(
  client: CoinPayClient,
  options: {
    file: Uint8Array | Blob;
    filename?: string;
    title?: string;
    category?: 'report' | 'statement' | 'tax' | 'invoice' | 'other';
    periodLabel?: string | null;
    notes?: string | null;
    contentType?: string;
    source?: 'fetch';
    institutionKey?: string;
    taxYear?: number | null;
    docType?: string | null;
  },
): Promise<{ document: FinanceDocument; duplicate: boolean }>;
export function listFinanceDocuments(client: CoinPayClient, options?: { category?: FinanceDocument['category']; limit?: number }): Promise<FinanceDocument[]>;
export function getFinanceDocument(client: CoinPayClient, documentId: string): Promise<FinanceDocument>;
export function listFinancePayloads(client: CoinPayClient, options?: { connectionId?: string; limit?: number; offset?: number }): Promise<{ payloads: Array<Record<string, unknown>>; total: number }>;
export function downloadFinancePayload(client: CoinPayClient, payloadId: string): Promise<BinaryResponse>;

export interface SendOutcome {
  sent: string[];
  failed: Array<{ to: string; error: string }>;
  attached: string[];
  linkUrl: string;
  linkExpiresAt: string;
}

export interface WeeklyDigest {
  id: string;
  kind: 'weekly_digest';
  weekdays: number[];
  hour: number;
  timezone: string;
  recipients: string[];
  scope: 'business' | 'personal' | 'all';
  formats: string[];
  active: boolean;
  lastSentAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
}

export function sendFinanceReportEmail(
  client: CoinPayClient,
  reportId: string,
  options: { to: string | string[]; formats?: ReportFormat[]; message?: string | null; attach?: boolean; expiresInDays?: number },
): Promise<SendOutcome>;
export function sendBooksEmail(
  client: CoinPayClient,
  options: { to: string | string[]; period?: string; from?: string; toDate?: string; timezone?: string; scope?: 'business' | 'personal' | 'all'; formats?: string[]; message?: string | null; attach?: boolean; expiresInDays?: number; withDocuments?: boolean },
): Promise<SendOutcome & { unreviewed: number; rows: number; documents?: { attached: string[]; skipped: Array<{ title: string; bytes: number; reason: string }> } }>;
export function getWeeklyDigest(client: CoinPayClient): Promise<WeeklyDigest | null>;
export function setWeeklyDigest(
  client: CoinPayClient,
  options?: { weekdays?: number[]; hour?: number; timezone?: string; recipients?: string[]; scope?: 'business' | 'personal' | 'all'; formats?: string[]; active?: boolean },
): Promise<WeeklyDigest>;
export function deleteWeeklyDigest(client: CoinPayClient): Promise<{ success: boolean }>;
export function sendWeeklyDigestNow(client: CoinPayClient): Promise<SendOutcome>;

export interface DueItem {
  source: 'projected' | 'scheduled';
  payee: string;
  amount: number | null;
  owed: number | null;
  cadence: string;
  dueOn: string;
  daysUntil: number;
  status: 'overdue' | 'awaiting' | 'today' | 'soon' | 'paid';
  accountId: string;
  accountName: string;
  scope: 'business' | 'personal';
  isDebtService: boolean;
}

export interface DueSoon {
  timezone: string;
  today: string;
  horizonDays: number;
  items: DueItem[];
  paid: DueItem[];
  missed: Array<{ payee: string; amount: number; expectedOn: string; lastSeen: string; accountName: string }>;
  totals: { due: number; overdue: number; unpriced: number };
  recurring: {
    charges: Array<{ key: string; payee: string; amount: number; cadence: string; occurrences: number; lastSeen: string; nextExpected: string; monthlyEquivalent: number; scope: 'business' | 'personal'; isDebtService: boolean; accountId: string; accountName: string; origin?: 'observed' | 'matched' | 'declared'; declared?: DeclaredCostRef }>;
    monthlyTotal: number;
    monthlyDebtService: number;
    /** The declared part of monthlyTotal that no feed shows. */
    monthlyDeclared?: number;
    declaredSkipped?: number;
  };
  currency: string | null;
}

export function getDueSoon(client: CoinPayClient, opts?: { days?: number; timezone?: string }): Promise<DueSoon>;

export interface DeclaredCostRef {
  source: string;
  key: string;
  payee: string;
  amount: number;
  cadence: 'monthly' | 'yearly';
  monthlyEquivalent: number;
  category: string | null;
  paidWith: string | null;
  meta: Record<string, unknown>;
}

export interface DeclaredCost extends DeclaredCostRef {
  currency: string;
  scope: 'business' | 'personal';
  nextExpected: string | null;
  updatedAt?: string | null;
}

export function listDeclaredCosts(client: CoinPayClient, opts?: { source?: string }): Promise<{ costs: DeclaredCost[]; monthly: Record<string, number> }>;
export function importDeclaredCosts(
  client: CoinPayClient,
  body: unknown,
  opts?: { source?: string },
): Promise<{ source: string; removed: number; upserted: number; costs: DeclaredCost[]; monthly: Record<string, number> }>;
export function getDailySummary(client: CoinPayClient): Promise<WeeklyDigest | null>;
export function setDailySummary(
  client: CoinPayClient,
  opts?: { weekdays?: number[]; hour?: number; timezone?: string; recipients?: string[]; active?: boolean },
): Promise<WeeklyDigest>;
export function deleteDailySummary(client: CoinPayClient): Promise<{ success: boolean }>;
export function sendDailySummaryNow(client: CoinPayClient): Promise<{ sent: string[]; failed: Array<{ to: string; error: string }>; due: number; overdue: number }>;
export function setAccountDueDay(client: CoinPayClient, accountId: string, opts: { day: number | null; amount?: number | string | null }): Promise<Record<string, unknown>>;

export type GoalKind = 'house' | 'car' | 'emergency_fund' | 'debt_payoff' | 'custom';
export type GoalPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly';
export type GoalStatus = 'achieved' | 'on_track' | 'behind' | 'overdue';
export interface GoalSnapshot {
  progress: number;
  remaining: number;
  percent: number;
  expectedByNow: number;
  status: GoalStatus;
  daysLeft: number;
  required: { perDay: number; perWeek: number; perMonth: number; perQuarter: number };
  recentPerMonth: number | null;
  projectedDate: string | null;
  exact: boolean;
}
export interface FinanceGoal {
  id: string;
  name: string;
  kind: GoalKind;
  targetAmount: number;
  currency: string;
  startDate: string;
  deadline: string;
  startingAmount: number | null;
  startProgress: number;
  linkedAccountIds: string[];
  linkedWalletIds: string[];
  notes: string | null;
  archivedAt: string | null;
  direction: 'save' | 'payoff';
  snapshot: GoalSnapshot;
  /** What progress is made of; counted amounts sum to `snapshot.progress`. */
  sources: GoalSource[];
}
export interface GoalSource {
  type: 'account' | 'wallets' | 'contributions' | 'starting';
  id: string | null;
  name: string;
  institution: string | null;
  kind: string | null;
  amount: number;
  asOf: string | null;
  stale: boolean;
  counted: boolean;
}
export interface GoalInput {
  name: string;
  kind: GoalKind;
  targetAmount?: number | string;
  deadline: string;
  currency?: string;
  startDate?: string;
  startingAmount?: number | string | null;
  linkedAccountIds?: string[];
  linkedWalletIds?: string[];
  notes?: string | null;
}
export function listGoals(client: CoinPayClient, opts?: { archived?: boolean }): Promise<{ goals: FinanceGoal[]; timezone: string; disclaimer: string }>;
export function getGoal(client: CoinPayClient, id: string): Promise<{ goal: FinanceGoal; contributions: Array<{ id: string; amount: number; occurredOn: string; note: string | null }> }>;
export function createGoal(client: CoinPayClient, goal: GoalInput): Promise<FinanceGoal>;
export function updateGoal(client: CoinPayClient, id: string, patch: Partial<GoalInput> & { archived?: boolean; startProgress?: number }): Promise<FinanceGoal>;
export function deleteGoal(client: CoinPayClient, id: string): Promise<{ success: boolean }>;
export function addGoalContribution(client: CoinPayClient, id: string, c: { amount: number | string; occurredOn?: string; note?: string }): Promise<{ id: string; amount: number; occurredOn: string; note: string | null }>;
export function getGoalSources(client: CoinPayClient): Promise<{ accounts: Array<{ id: string; name: string; institution: string | null; liability: boolean; currency: string; balance: number | null }>; wallets: Array<{ walletId: string; label: string | null }> }>;
export function getGoalsReport(client: CoinPayClient, opts?: { period?: GoalPeriod }): Promise<{ report: Record<string, unknown>; text: string }>;
export function getGoalsDigest(client: CoinPayClient): Promise<(WeeklyDigest & { cadence?: GoalPeriod }) | null>;
export function setGoalsDigest(client: CoinPayClient, opts?: { cadence?: GoalPeriod; hour?: number; timezone?: string; recipients?: string[]; active?: boolean }): Promise<WeeklyDigest & { cadence?: GoalPeriod }>;
export function deleteGoalsDigest(client: CoinPayClient): Promise<{ success: boolean }>;
export function sendGoalsDigestNow(client: CoinPayClient): Promise<{ sent: string[]; failed: Array<{ to: string; error: string }>; goals: number; period: GoalPeriod }>;
