/**
 * Finance reports, sync jobs, coverage and the statement library.
 *
 * Every function takes a `CoinPayClient` authenticated with a merchant
 * session. Nothing here computes a total: the server freezes each report's
 * rows and sums them exactly, and these calls fetch what it produced. A
 * download returns bytes, never a JSON-wrapped blob.
 */

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const v of value) search.append(key, String(v));
    } else {
      search.set(key, String(value));
    }
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

function headersWith(idempotencyKey) {
  return idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {};
}

/** Surface the server's structured error `{ error: { code, message } }` as an Error with `.code`. */
async function call(client, endpoint, options = {}) {
  try {
    return await client.request(endpoint, options);
  } catch (err) {
    const body = err && err.response && err.response.error;
    if (body && typeof body === 'object') {
      const wrapped = new Error(body.message || err.message);
      wrapped.code = body.code;
      wrapped.status = err.status;
      wrapped.retryable = body.retryable === true;
      wrapped.jobId = body.jobId;
      wrapped.reportId = body.reportId;
      wrapped.retryAfter = body.retryAfter;
      wrapped.response = err.response;
      throw wrapped;
    }
    if (err && err.response && typeof err.response.code === 'string' && !err.code) err.code = err.response.code;
    throw err;
  }
}

// ── Connections ──

/**
 * Claim a SimpleFIN setup token. The token is single-use; the server checks
 * everything it can before spending it and says plainly when the outcome is
 * unknown (`err.code === 'claim_outcome_unknown'`).
 */
export async function connectSimpleFin(client, { setupToken, label, protocolVersion, idempotencyKey } = {}) {
  if (!setupToken || !String(setupToken).trim()) throw new Error('A setup token is required');
  return call(client, '/finances/connections', {
    method: 'POST',
    headers: headersWith(idempotencyKey),
    body: JSON.stringify({ setupToken: String(setupToken).trim(), label, protocolVersion }),
  });
}

/** Stop future syncs and remove the credential; history is kept. */
export async function disconnectFinanceConnection(client, connectionId) {
  return call(client, `/finances/connections/${encodeURIComponent(connectionId)}/disconnect`, { method: 'POST', body: '{}' });
}

/** What deleting a connection would remove. */
export async function describeFinanceConnection(client, connectionId) {
  return call(client, `/finances/connections/${encodeURIComponent(connectionId)}`);
}

/** Delete a connection and everything under it. `confirm` must be true. */
export async function deleteFinanceConnection(client, connectionId, { confirm = false } = {}) {
  if (!confirm) throw new Error('Deleting a connection removes its account data; pass { confirm: true }');
  return call(client, `/finances/connections/${encodeURIComponent(connectionId)}?confirm=yes`, {
    method: 'DELETE',
    headers: { 'X-Confirm-Delete': 'yes' },
  });
}

/** Opt a connection in or out of a once-daily background sync. */
export async function setFinanceSyncConsent(client, connectionId, dailySync) {
  return call(client, `/finances/connections/${encodeURIComponent(connectionId)}/consent`, {
    method: 'POST',
    body: JSON.stringify({ dailySync: dailySync === true }),
  });
}

// ── Jobs ──

/** Queue a period backfill (`{ period: '2026-Q2' }` or `{ from, to }`). Answers 202 with the job(s). */
export async function createBackfillJob(client, { connectionId, period, from, to, timezone, idempotencyKey } = {}) {
  return call(client, '/finances/sync-jobs', {
    method: 'POST',
    headers: headersWith(idempotencyKey),
    body: JSON.stringify({ kind: 'backfill', connectionId, period, from, to, timezone }),
  });
}

/** Queue a background rolling refresh of one connection. */
export async function createRefreshJob(client, { connectionId, days, idempotencyKey } = {}) {
  return call(client, '/finances/sync-jobs', {
    method: 'POST',
    headers: headersWith(idempotencyKey),
    body: JSON.stringify({ kind: 'refresh', connectionId, days }),
  });
}

export async function getFinanceJob(client, jobId) {
  const data = await call(client, `/finances/jobs/${encodeURIComponent(jobId)}`);
  return data.job;
}

export async function listFinanceJobs(client, { limit, connectionId } = {}) {
  const data = await call(client, `/finances/jobs${query({ limit, connection: connectionId })}`);
  return data.jobs || [];
}

export async function cancelFinanceJob(client, jobId) {
  const data = await call(client, `/finances/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', body: '{}' });
  return data.job;
}

const TERMINAL_JOB = new Set(['completed', 'failed', 'cancelled', 'partial']);

/**
 * Poll a job until it reaches a terminal state or `waiting_for_budget`
 * (which can take hours to clear and is reported, not waited out).
 */
export async function waitForFinanceJob(client, jobId, { intervalMs = 3000, timeoutMs = 30 * 60 * 1000, onProgress, sleep } = {}) {
  const started = Date.now();
  const pause = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (;;) {
    const job = await getFinanceJob(client, jobId);
    if (onProgress) onProgress(job);
    if (TERMINAL_JOB.has(job.status) || job.status === 'waiting_for_budget') return job;
    if (Date.now() - started > timeoutMs) return job;
    await pause(intervalMs);
  }
}

// ── Coverage ──

export async function getFinanceCoverage(client, { period, from, to, timezone, accountIds, includeHidden } = {}) {
  return call(client, `/finances/coverage${query({ period, from, to, timezone, account: accountIds, hidden: includeHidden ? 1 : undefined })}`);
}

// ── Reports ──

/**
 * Create an immutable report revision. Answers 202 with `{ report, job }`;
 * use `waitForFinanceReport` to block until it is ready.
 */
export async function createFinanceReport(client, {
  period, from, to, timezone, accountIds, scope, includeHidden, includePendingAppendix, formats, strict, idempotencyKey,
} = {}) {
  return call(client, '/finances/reports', {
    method: 'POST',
    headers: headersWith(idempotencyKey),
    body: JSON.stringify({ period, from, to, timezone, accountIds, scope, includeHidden, includePendingAppendix, formats, strict }),
  });
}

export async function listFinanceReports(client, { limit, offset } = {}) {
  return call(client, `/finances/reports${query({ limit, offset })}`);
}

export async function getFinanceReport(client, reportId) {
  return call(client, `/finances/reports/${encodeURIComponent(reportId)}`);
}

export async function deleteFinanceReport(client, reportId) {
  return call(client, `/finances/reports/${encodeURIComponent(reportId)}`, { method: 'DELETE' });
}

const TERMINAL_REPORT = new Set(['ready', 'failed', 'superseded', 'deleted']);

export async function waitForFinanceReport(client, reportId, { intervalMs = 3000, timeoutMs = 30 * 60 * 1000, onProgress, sleep } = {}) {
  const started = Date.now();
  const pause = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (;;) {
    const data = await getFinanceReport(client, reportId);
    if (onProgress) onProgress(data);
    if (TERMINAL_REPORT.has(data.report.status)) return data;
    if (data.job && data.job.status === 'waiting_for_budget') return data;
    if (Date.now() - started > timeoutMs) return data;
    await pause(intervalMs);
  }
}

/**
 * Download one format of a ready report. Resolves to
 * `{ bytes: Uint8Array, contentType, filename, sha256, headers }`.
 */
export async function downloadFinanceReport(client, reportId, { format = 'pdf' } = {}) {
  return client.requestBinary(`/finances/reports/${encodeURIComponent(reportId)}/download${query({ format })}`);
}

// ── Statements ──

/**
 * Import an original PDF. `file` is a Uint8Array/Buffer/Blob of the bytes;
 * nothing is read out of it into the ledger.
 */
export async function importFinanceStatement(client, {
  file, filename = 'statement.pdf', accountId, period, from, to, timezone, institutionLabel, cycle, notes,
} = {}) {
  if (!file) throw new Error('A PDF file is required');
  if (!accountId) throw new Error('accountId is required');
  const form = new FormData();
  const blob = file instanceof Blob ? file : new Blob([file], { type: 'application/pdf' });
  form.append('file', blob, filename);
  form.append('accountId', accountId);
  if (period) form.append('period', period);
  if (from) form.append('from', from);
  if (to) form.append('to', to);
  if (timezone) form.append('timezone', timezone);
  if (institutionLabel) form.append('institutionLabel', institutionLabel);
  if (cycle) form.append('cycle', cycle);
  if (notes) form.append('notes', notes);
  return client.requestForm('/finances/statements', form);
}

export async function listFinanceStatements(client, { accountId, period, from, to, timezone, limit } = {}) {
  const data = await call(client, `/finances/statements${query({ account: accountId, period, from, to, timezone, limit })}`);
  return data.statements || [];
}

export async function getFinanceStatement(client, statementId) {
  return call(client, `/finances/statements/${encodeURIComponent(statementId)}`);
}

export async function downloadFinanceStatement(client, statementId) {
  return client.requestBinary(`/finances/statements/${encodeURIComponent(statementId)}/download`);
}

export async function deleteFinanceStatement(client, statementId) {
  return call(client, `/finances/statements/${encodeURIComponent(statementId)}`, { method: 'DELETE' });
}

/**
 * Enter a statement's balances and check them against one report revision.
 * Amounts are decimal strings in the account currency.
 */
export async function reconcileFinanceStatement(client, statementId, {
  reportId, opening, closing, credits, debits, currency, signConvention, acknowledge,
} = {}) {
  const data = await call(client, `/finances/statements/${encodeURIComponent(statementId)}/reconciliations`, {
    method: 'POST',
    body: JSON.stringify({ reportId, opening, closing, credits, debits, currency, signConvention, acknowledge }),
  });
  return data.reconciliation;
}

// ── Books ──

/** Rows awaiting review (default) plus the category vocabularies. */
export async function listBooksQueue(client, { status, scope, accountId, search, start, end, limit, offset } = {}) {
  return call(client, `/finances/books/queue${query({ status, scope, account: accountId, search, start, end, limit, offset })}`);
}

/** Confirm one row. Omitted fields keep the row's current values. */
export async function reviewBooksTransaction(client, transactionId, { category, taxCategory, scope, note, createRule } = {}) {
  const data = await call(client, `/finances/books/transactions/${encodeURIComponent(transactionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ category, taxCategory, scope, note, createRule }),
  });
  return data.transaction;
}

/** Confirm many rows; with no category given each row's suggestion is accepted. */
export async function bulkReviewBooks(client, ids, { category, taxCategory, scope, createRule } = {}) {
  return call(client, '/finances/books/bulk', { method: 'POST', body: JSON.stringify({ ids, category, taxCategory, scope, createRule }) });
}

/** Queue an auto-categorisation run over unreviewed rows. Answers with the job. */
export async function categorizeBooks(client, { useModel = true, onlyUncategorized = false } = {}) {
  return call(client, '/finances/books/categorize', { method: 'POST', body: JSON.stringify({ useModel, onlyUncategorized }) });
}

export async function listBooksRules(client) {
  const data = await call(client, '/finances/books/rules');
  return data.rules || [];
}

export async function createBooksRule(client, { matchField = 'payee', matchType = 'exact', pattern, category, taxCategory, scope } = {}) {
  const data = await call(client, '/finances/books/rules', { method: 'POST', body: JSON.stringify({ matchField, matchType, pattern, category, taxCategory, scope }) });
  return data.rule;
}

export async function deleteBooksRule(client, ruleId) {
  return call(client, `/finances/books/rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' });
}

/** Totals by tax category for a year (`2026`), quarter or month. */
export async function getBooksSummary(client, { period, from, to, timezone, scope, rows } = {}) {
  return call(client, `/finances/books/summary${query({ period, from, to, timezone, scope, rows: rows ? 1 : undefined })}`);
}

/** The CPA pack as bytes. */
export async function exportBooks(client, { period, from, to, timezone, scope, format = 'csv' } = {}) {
  return client.requestBinary(`/finances/books/export${query({ period, from, to, timezone, scope, format })}`);
}

// ── Raw provider payloads ──

export async function listFinancePayloads(client, { connectionId, limit, offset } = {}) {
  return call(client, `/finances/payloads${query({ connection: connectionId, limit, offset })}`);
}

export async function downloadFinancePayload(client, payloadId) {
  return client.requestBinary(`/finances/payloads/${encodeURIComponent(payloadId)}/download`);
}

// ── Email ──

/** Email a ready report: attachments plus an expiring no-login link. */
export async function sendFinanceReportEmail(client, reportId, { to, formats, message, attach, expiresInDays } = {}) {
  return call(client, `/finances/reports/${encodeURIComponent(reportId)}/send`, {
    method: 'POST',
    body: JSON.stringify({ to, formats, message, attach, expiresInDays }),
  });
}

/** Email the CPA pack for a period. `toDate` is the exclusive end for a custom range. */
export async function sendBooksEmail(client, { to, period, from, toDate, timezone, scope, formats, message, attach, expiresInDays } = {}) {
  return call(client, '/finances/books/send', {
    method: 'POST',
    body: JSON.stringify({ to, period, from, toDate, timezone, scope, formats, message, attach, expiresInDays }),
  });
}

export async function getWeeklyDigest(client) {
  const data = await call(client, '/finances/email-schedules');
  return data.schedule;
}

export async function setWeeklyDigest(client, { weekdays, hour, timezone, recipients, scope, formats, active } = {}) {
  const data = await call(client, '/finances/email-schedules', {
    method: 'POST',
    body: JSON.stringify({ weekdays, hour, timezone, recipients, scope, formats, active }),
  });
  return data.schedule;
}

export async function deleteWeeklyDigest(client) {
  return call(client, '/finances/email-schedules', { method: 'DELETE' });
}

export async function sendWeeklyDigestNow(client) {
  return call(client, '/finances/email-schedules/send-now', { method: 'POST', body: '{}' });
}
