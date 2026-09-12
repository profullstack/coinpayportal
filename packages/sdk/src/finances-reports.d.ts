import type { CoinPayClient } from './client.js';

export type ProviderCoverage = 'unknown' | 'partial' | 'available_window_fetched';
export type ReconciliationStatus = 'not_attempted' | 'unavailable' | 'mismatch' | 'user_reconciled';
export type ReportFormat = 'pdf' | 'html' | 'csv' | 'json';
export type ReportStatus = 'queued' | 'generating' | 'ready' | 'failed' | 'superseded' | 'deleted';
export type JobStatus = 'queued' | 'running' | 'waiting_for_budget' | 'partial' | 'failed' | 'completed' | 'cancelled';
export type JobKind = 'backfill' | 'refresh' | 'scheduled_sync' | 'report';

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
