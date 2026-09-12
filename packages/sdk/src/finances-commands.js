/**
 * `coinpay finances` subcommands for reports, backfills and statements.
 *
 * Kept out of bin/coinpay.js so the contract is testable without spawning
 * the whole CLI. `runFinancesCommand` throws `CliExit` with one of the
 * documented codes; the binary maps that to `process.exit`.
 *
 * Exit codes for these subcommands:
 *   0  completed, or a job was accepted and reported
 *   2  invalid input (bad flags, bad dates, missing values)
 *   3  strict completeness rejection
 *   4  authentication / authorization
 *   5  provider, storage or execution failure
 *
 * In `--json` mode stdout carries only the result; progress and warnings
 * go to stderr. A queued job is reported as a job, never as a pretend file.
 */

import { mkdtempSync, writeFileSync, renameSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath, basename } from 'node:path';
import * as api from './finances-reports.js';

export const EXIT = { OK: 0, INVALID: 2, STRICT: 3, AUTH: 4, FAILURE: 5 };

export class CliExit extends Error {
  constructor(code, message = '') {
    super(message);
    this.exitCode = code;
  }
}

const COVERAGE_CODES = new Set(['provider_coverage_partial', 'provider_coverage_unknown', 'export_incomplete', 'export_count_mismatch']);

function exitCodeFor(err) {
  if (err instanceof CliExit) return err.exitCode;
  if (err && (err.status === 401 || err.status === 403)) return EXIT.AUTH;
  if (err && COVERAGE_CODES.has(err.code)) return EXIT.STRICT;
  if (err && (err.code === 'invalid_period' || err.code === 'invalid_request' || err.code === 'invalid_timezone' || err.code === 'timezone_required' || err.status === 400)) return EXIT.INVALID;
  if (err && err.status === 404) return EXIT.INVALID;
  return EXIT.FAILURE;
}

function listFlag(value) {
  if (value === undefined || value === null || value === true) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((v) => String(v).split(',')).map((s) => s.trim()).filter(Boolean);
}

function periodSelection(flags) {
  const period = typeof flags.period === 'string' ? flags.period : null;
  const from = typeof flags.from === 'string' ? flags.from : null;
  const to = typeof flags.to === 'string' ? flags.to : null;
  if (period && (from || to)) throw new CliExit(EXIT.INVALID, 'Use --period or --from/--to, not both');
  if (!period && !(from && to)) throw new CliExit(EXIT.INVALID, 'Pass --period 2026-08 (or 2026-Q2), or --from YYYY-MM-DD --to YYYY-MM-DD (--to is exclusive)');
  if (period && !/^\d{4}-(\d{2}|Q[1-4])$/i.test(period)) throw new CliExit(EXIT.INVALID, `--period must look like 2026-08 or 2026-Q2 (got ${period})`);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (from && !iso.test(from)) throw new CliExit(EXIT.INVALID, `--from must be YYYY-MM-DD (got ${from})`);
  if (to && !iso.test(to)) throw new CliExit(EXIT.INVALID, `--to must be YYYY-MM-DD (got ${to})`);
  if (from && to && to <= from) throw new CliExit(EXIT.INVALID, '--to is exclusive and must be after --from');
  const timezone = typeof flags.timezone === 'string' ? flags.timezone : typeof flags.tz === 'string' ? flags.tz : undefined;
  // Bounded repeat (an IANA name has at most three segments) so the check on
  // a user-supplied flag carries no nested unbounded quantifier.
  if (timezone !== undefined && (timezone.length > 64 || !/^(UTC|[A-Za-z]{1,32}(?:\/[A-Za-z0-9_+-]{1,32}){1,3})$/.test(timezone))) {
    throw new CliExit(EXIT.INVALID, `--timezone must be an IANA name such as America/Los_Angeles (got ${timezone})`);
  }
  return { period: period || undefined, from: from || undefined, to: to || undefined, timezone };
}

/**
 * Write bytes to `target` atomically with owner-only permissions. Refuses
 * to overwrite unless `overwrite` is set.
 */
export function writeDownload(target, bytes, { overwrite = false } = {}) {
  const full = resolvePath(target);
  if (existsSync(full) && !overwrite) {
    throw new CliExit(EXIT.INVALID, `${full} already exists; pass --overwrite to replace it`);
  }
  const dir = dirname(full);
  const tmpDir = mkdtempSync(resolvePath(dir, `.coinpay-${basename(full)}-`));
  const tmp = resolvePath(tmpDir, 'download');
  try {
    writeFileSync(tmp, bytes, { mode: 0o600 });
    renameSync(tmp, full);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  return full;
}

async function readSecretFromStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function promptSecret(message) {
  if (!process.stdin.isTTY) throw new CliExit(EXIT.INVALID, 'No terminal to prompt on; pass --setup-token-stdin and pipe the token in');
  try {
    const { password } = await import('@inquirer/prompts');
    return (await password({ message, mask: '*' })).trim();
  } catch (err) {
    if (err instanceof CliExit) throw err;
    throw new CliExit(EXIT.INVALID, 'Interactive prompt unavailable; pass --setup-token-stdin and pipe the token in');
  }
}

function describeJob(job) {
  const p = job.progress || {};
  const done = Array.isArray(p.windowsDone) ? p.windowsDone.length : 0;
  const planned = job.params && job.params.requestsPlanned ? job.params.requestsPlanned : null;
  const parts = [`${job.kind} ${job.id}`, job.status];
  if (planned !== null) parts.push(`${done}/${planned} windows`);
  if (job.nextAttemptAt) parts.push(`next attempt ${job.nextAttemptAt}`);
  if (job.errorMessage) parts.push(job.errorMessage);
  return parts.join(' · ');
}

function describeReport(report) {
  const parts = [`report ${report.id} r${report.revision}`, report.status, report.period && report.period.label];
  if (report.provider_coverage) parts.push(`coverage ${report.provider_coverage}`);
  if (report.rowCount !== null && report.rowCount !== undefined) parts.push(`${report.rowCount} posted rows`);
  if (report.errorMessage) parts.push(report.errorMessage);
  return parts.filter(Boolean).join(' · ');
}

/**
 * Run one subcommand. `ctx` supplies the client and the output channels.
 * @returns {Promise<number>} an exit code
 */
export async function runFinancesCommand(subcommand, args, flags, ctx) {
  const { client, out, err: errOut } = ctx;
  const json = flags.json === true;
  const progress = (msg) => { if (json) errOut(msg); else out(msg); };
  const warn = (msg) => errOut(`warning: ${msg}`);
  const emit = (data, text) => { if (json) out(JSON.stringify(data, null, 2)); else if (text) out(text); };

  try {
    switch (subcommand) {
      case 'connect': {
        const provider = typeof flags.provider === 'string' ? flags.provider : 'simplefin';
        if (provider !== 'simplefin') throw new CliExit(EXIT.INVALID, 'Only --provider simplefin can be connected from the CLI; Plaid links in the browser');
        if (flags['setup-token'] !== undefined) {
          throw new CliExit(EXIT.INVALID, 'Refusing --setup-token on the command line (it lands in shell history). Use --setup-token-stdin or the prompt.');
        }
        const token = flags['setup-token-stdin'] ? await readSecretFromStdin() : await promptSecret('SimpleFIN setup token (input hidden)');
        if (!token) throw new CliExit(EXIT.INVALID, 'No setup token provided');
        const protocolVersion = flags['protocol-version'] !== undefined ? Number(flags['protocol-version']) : undefined;
        if (protocolVersion !== undefined && protocolVersion !== 1 && protocolVersion !== 2) throw new CliExit(EXIT.INVALID, '--protocol-version must be 1 or 2');
        progress('Claiming the setup token…');
        const data = await api.connectSimpleFin(client, {
          setupToken: token,
          label: typeof flags.label === 'string' ? flags.label : undefined,
          protocolVersion,
          idempotencyKey: typeof flags['idempotency-key'] === 'string' ? flags['idempotency-key'] : undefined,
        });
        emit(data, `Linked connection ${data.connection.id}${data.connection.label ? ` (${data.connection.label})` : ''}. Run: coinpay finances sync`);
        return EXIT.OK;
      }

      case 'disconnect': {
        const id = args[0];
        if (!id) throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances disconnect <connection-id> --yes');
        if (!flags.yes) throw new CliExit(EXIT.INVALID, 'This stops future syncs and removes the stored credential (history is kept). Re-run with --yes to confirm.');
        const data = await api.disconnectFinanceConnection(client, id);
        emit(data, `Disconnected ${id}. ${data.note}`);
        return EXIT.OK;
      }

      case 'consent': {
        const id = args[0];
        const mode = args[1];
        if (!id || (mode !== 'on' && mode !== 'off')) throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances consent <connection-id> on|off');
        const data = await api.setFinanceSyncConsent(client, id, mode === 'on');
        emit(data, mode === 'on' ? `Daily background sync enabled for ${id} (next: ${data.connection.next_sync_at})` : `Daily background sync disabled for ${id}`);
        return EXIT.OK;
      }

      case 'backfill': {
        const sel = periodSelection(flags);
        const connectionId = typeof flags.connection === 'string' ? flags.connection : typeof flags['connection-id'] === 'string' ? flags['connection-id'] : undefined;
        const data = await api.createBackfillJob(client, { ...sel, connectionId, idempotencyKey: typeof flags['idempotency-key'] === 'string' ? flags['idempotency-key'] : undefined });
        let jobs = data.jobs || [data.job];
        for (const job of jobs) progress(`Queued ${describeJob(job)} (${job.params.requestsPlanned} provider request(s) planned)`);
        if (flags.wait) {
          const finished = [];
          for (const job of jobs) {
            const result = await api.waitForFinanceJob(client, job.id, { onProgress: (j) => progress(describeJob(j)) });
            finished.push(result);
          }
          jobs = finished;
        }
        emit({ jobs }, jobs.map(describeJob).join('\n'));
        return jobs.some((j) => j.status === 'failed') ? EXIT.FAILURE : EXIT.OK;
      }

      case 'jobs': {
        const action = args[0] || 'list';
        if (action === 'get') {
          const id = args[1];
          if (!id) throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances jobs get <job-id>');
          const job = flags.wait ? await api.waitForFinanceJob(client, id, { onProgress: (j) => progress(describeJob(j)) }) : await api.getFinanceJob(client, id);
          emit({ job }, describeJob(job));
          return job.status === 'failed' ? EXIT.FAILURE : EXIT.OK;
        }
        if (action === 'cancel') {
          const id = args[1];
          if (!id) throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances jobs cancel <job-id>');
          const job = await api.cancelFinanceJob(client, id);
          emit({ job }, describeJob(job));
          return EXIT.OK;
        }
        if (action === 'list') {
          const jobs = await api.listFinanceJobs(client, { limit: flags.limit ? Number(flags.limit) : undefined, connectionId: typeof flags.connection === 'string' ? flags.connection : undefined });
          emit({ jobs }, jobs.length ? jobs.map(describeJob).join('\n') : 'No jobs yet.');
          return EXIT.OK;
        }
        throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances jobs [list|get <id>|cancel <id>]');
      }

      case 'coverage': {
        const sel = periodSelection(flags);
        const data = await api.getFinanceCoverage(client, { ...sel, accountIds: listFlag(flags.account), includeHidden: flags.hidden === true });
        emit(
          data,
          [`${data.period.label} (${data.period.timezone}) · provider coverage: ${data.provider_coverage}`]
            .concat(data.accounts.map((a) => `  ${a.name || a.accountId}  ${a.coverage}  ${Math.round(a.fraction * 100)}%${a.capped ? '  capped' : ''}${a.gaps.length ? `  ${a.gaps.length} gap(s)` : ''}`))
            .join('\n'),
        );
        return EXIT.OK;
      }

      case 'report': {
        const sel = periodSelection(flags);
        const format = typeof flags.format === 'string' ? flags.format.toLowerCase() : 'pdf';
        if (!['pdf', 'html', 'csv', 'json'].includes(format)) throw new CliExit(EXIT.INVALID, '--format must be pdf, html, csv or json');
        const scope = typeof flags.scope === 'string' ? flags.scope : 'all';
        if (!['all', 'business', 'personal'].includes(scope)) throw new CliExit(EXIT.INVALID, '--scope must be all, business or personal');
        const output = typeof flags.output === 'string' ? flags.output : null;
        const wait = flags.wait === true || output !== null;
        const strict = flags.strict === true;

        const created = await api.createFinanceReport(client, {
          ...sel,
          accountIds: listFlag(flags.account),
          scope,
          includeHidden: flags.hidden === true,
          includePendingAppendix: flags['no-pending'] ? false : true,
          formats: [format, 'json'],
          strict,
          estimateGaps: flags['estimate-gaps'] === true,
          idempotencyKey: typeof flags['idempotency-key'] === 'string' ? flags['idempotency-key'] : undefined,
        });
        let report = created.report;
        progress(`Queued ${describeReport(report)}`);
        if (!wait) {
          emit({ report, job: created.job }, `${describeReport(report)}\nCheck with: coinpay finances jobs get ${created.job.id}`);
          return EXIT.OK;
        }
        const finished = await api.waitForFinanceReport(client, report.id, { onProgress: (d) => progress(describeReport(d.report)) });
        report = finished.report;
        if (report.status !== 'ready') {
          if (finished.job && finished.job.status === 'waiting_for_budget') {
            emit({ report, job: finished.job }, `Report generation is waiting for the provider request budget; next attempt ${finished.job.nextAttemptAt}`);
            return EXIT.FAILURE;
          }
          const code = COVERAGE_CODES.has(report.errorCode) ? EXIT.STRICT : EXIT.FAILURE;
          emit({ report, job: finished.job }, `Report ${report.status}: ${report.errorMessage || report.errorCode || 'unknown'}`);
          return code;
        }
        for (const w of report.warnings || []) warn(w);
        if (report.local_export_complete !== true) {
          emit({ report }, 'Report is missing part of its local export; refusing to present it as complete');
          return EXIT.STRICT;
        }
        if (strict && report.provider_coverage !== 'available_window_fetched') {
          emit({ report }, `--strict: provider coverage is ${report.provider_coverage}`);
          return EXIT.STRICT;
        }
        if (report.provider_coverage !== 'available_window_fetched') {
          warn(`History may be incomplete: provider coverage is ${report.provider_coverage}. ${report.notice}`);
        }
        if (output) {
          const file = await api.downloadFinanceReport(client, report.id, { format });
          const path = writeDownload(output, Buffer.from(file.bytes), { overwrite: flags.overwrite === true });
          emit({ report, output: path, bytes: file.bytes.length, sha256: file.sha256 }, `Wrote ${path} (${file.bytes.length} bytes, ${format}). ${report.notice}`);
        } else {
          emit({ report }, describeReport(report));
        }
        return EXIT.OK;
      }

      case 'reports': {
        const action = args[0] || 'list';
        if (action === 'list') {
          const data = await api.listFinanceReports(client, { limit: flags.limit ? Number(flags.limit) : undefined });
          emit(data, data.reports.length ? data.reports.map(describeReport).join('\n') : 'No reports yet.');
          return EXIT.OK;
        }
        if (action === 'send') {
          const id = args[1];
          if (!id || typeof flags.to !== 'string') throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances reports send <report-id> --to cpa@x.com,me@x.com [--format pdf,csv] [--message "…"] [--no-attach]');
          const data = await api.sendFinanceReportEmail(client, id, {
            to: listFlag(flags.to),
            formats: flags.format ? listFlag(flags.format) : undefined,
            message: typeof flags.message === 'string' ? flags.message : null,
            attach: flags['no-attach'] ? false : true,
          });
          emit(data, `Sent to ${data.sent.join(', ') || 'nobody'}${data.failed.length ? `; failed: ${data.failed.map((f) => `${f.to} (${f.error})`).join(', ')}` : ''}. Attached: ${data.attached.join(', ') || 'none'}. Link (expires ${data.linkExpiresAt.slice(0, 10)}): ${data.linkUrl}`);
          return data.sent.length > 0 ? EXIT.OK : EXIT.FAILURE;
        }
        if (action === 'get' || action === 'download' || action === 'delete') {
          const id = args[1];
          if (!id) throw new CliExit(EXIT.INVALID, `Usage: coinpay finances reports ${action} <report-id>`);
          if (action === 'delete') {
            if (!flags.yes) throw new CliExit(EXIT.INVALID, 'Deleting removes the report and its files (not bank data). Re-run with --yes.');
            const data = await api.deleteFinanceReport(client, id);
            emit(data, data.note);
            return EXIT.OK;
          }
          const data = await api.getFinanceReport(client, id);
          if (action === 'get') {
            emit(data, describeReport(data.report));
            return EXIT.OK;
          }
          const format = typeof flags.format === 'string' ? flags.format.toLowerCase() : 'pdf';
          const output = typeof flags.output === 'string' ? flags.output : `${data.report.period.selector}.${format}`;
          const file = await api.downloadFinanceReport(client, id, { format });
          const path = writeDownload(output, Buffer.from(file.bytes), { overwrite: flags.overwrite === true });
          emit({ report: data.report, output: path, bytes: file.bytes.length, sha256: file.sha256 }, `Wrote ${path} (${file.bytes.length} bytes)`);
          return EXIT.OK;
        }
        throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances reports [list|get <id>|download <id>|send <id>|delete <id>]');
      }

      case 'statements': {
        const action = args[0];
        if (action === 'import') {
          const path = args[1];
          if (!path) throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances statements import <file.pdf> --account <id> --period 2026-08 (or --from/--to) [--timezone …]');
          const accountId = typeof flags.account === 'string' ? flags.account : null;
          if (!accountId) throw new CliExit(EXIT.INVALID, '--account <account-id> is required');
          const sel = periodSelection(flags);
          let bytes;
          try {
            bytes = readFileSync(path);
          } catch (e) {
            throw new CliExit(EXIT.INVALID, `Could not read ${path}: ${e.message}`);
          }
          const data = await api.importFinanceStatement(client, {
            file: bytes,
            filename: basename(path),
            accountId,
            ...sel,
            institutionLabel: typeof flags.institution === 'string' ? flags.institution : undefined,
            cycle: typeof flags.cycle === 'string' ? flags.cycle : undefined,
            notes: typeof flags.notes === 'string' ? flags.notes : undefined,
          });
          emit(data, `${data.duplicateOf === data.statement.id ? 'Already imported' : 'Imported'} statement ${data.statement.id} for ${data.statement.periodStart}..${data.statement.periodEnd}. ${data.note}`);
          return EXIT.OK;
        }
        if (action === 'list') {
          const sel = flags.period || (flags.from && flags.to) ? periodSelection(flags) : {};
          const statements = await api.listFinanceStatements(client, { ...sel, accountId: typeof flags.account === 'string' ? flags.account : undefined, limit: flags.limit ? Number(flags.limit) : undefined });
          emit(
            { statements },
            statements.length
              ? statements.map((s) => `${s.id}  ${s.periodStart}..${s.periodEnd}  ${s.institutionLabel || ''}  ${s.bytes} bytes  ${s.reconciliation ? s.reconciliation.state : 'not reconciled'}  (user supplied)`).join('\n')
              : 'No statements imported.',
          );
          return EXIT.OK;
        }
        if (action === 'get') {
          const id = args[1];
          if (!id) throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances statements get <statement-id>');
          const data = await api.getFinanceStatement(client, id);
          emit(data, `${data.statement.id}  ${data.statement.periodStart}..${data.statement.periodEnd}  ${data.statement.label}  ${data.statement.reconciliation ? data.statement.reconciliation.state : 'not reconciled'}`);
          return EXIT.OK;
        }
        if (action === 'download') {
          const id = args[1];
          if (!id) throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances statements download <statement-id> --output <file.pdf>');
          const file = await api.downloadFinanceStatement(client, id);
          const output = typeof flags.output === 'string' ? flags.output : file.filename || `${id}.pdf`;
          const path = writeDownload(output, Buffer.from(file.bytes), { overwrite: flags.overwrite === true });
          emit({ output: path, bytes: file.bytes.length, sha256: file.sha256 }, `Wrote ${path} (${file.bytes.length} bytes; original bytes, user supplied)`);
          return EXIT.OK;
        }
        if (action === 'reconcile') {
          const id = args[1];
          if (!id) throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances statements reconcile <statement-id> --report <report-id> --opening <n> --closing <n> --currency USD');
          const reportId = typeof flags.report === 'string' ? flags.report : null;
          if (!reportId) throw new CliExit(EXIT.INVALID, '--report <report-id> is required');
          for (const name of ['opening', 'closing', 'currency']) {
            if (typeof flags[name] !== 'string' && typeof flags[name] !== 'number') throw new CliExit(EXIT.INVALID, `--${name} is required`);
          }
          const rec = await api.reconcileFinanceStatement(client, id, {
            reportId,
            opening: String(flags.opening),
            closing: String(flags.closing),
            credits: flags.credits !== undefined ? String(flags.credits) : undefined,
            debits: flags.debits !== undefined ? String(flags.debits) : undefined,
            currency: String(flags.currency),
            signConvention: flags['liability-positive'] ? 'liability_positive' : 'as_stated',
            acknowledge: flags.acknowledge === true,
          });
          emit({ reconciliation: rec }, `${rec.state}: expected closing ${rec.expectedClosing}, entered ${rec.normalized.closing}, difference ${rec.difference} ${rec.currency}`);
          return rec.state === 'mismatch' ? EXIT.STRICT : EXIT.OK;
        }
        if (action === 'delete') {
          const id = args[1];
          if (!id) throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances statements delete <statement-id> --yes');
          if (!flags.yes) throw new CliExit(EXIT.INVALID, 'Deleting removes the document, not bank activity. Re-run with --yes.');
          const data = await api.deleteFinanceStatement(client, id);
          emit(data, data.note);
          return EXIT.OK;
        }
        throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances statements [import <file>|list|get <id>|download <id>|reconcile <id>|delete <id>]');
      }

      case 'books': {
        const action = args[0] || 'queue';
        if (action === 'queue' || action === 'list') {
          const scope = typeof flags.scope === 'string' ? flags.scope : undefined;
          const data = await api.listBooksQueue(client, {
            status: typeof flags.status === 'string' ? flags.status : 'unreviewed',
            scope,
            accountId: typeof flags.account === 'string' ? flags.account : undefined,
            search: typeof flags.search === 'string' ? flags.search : undefined,
            limit: flags.limit ? Number(flags.limit) : undefined,
            offset: flags.offset ? Number(flags.offset) : undefined,
          });
          emit(
            data,
            [`${data.unreviewed} row(s) awaiting review${data.modelEnabled ? '' : ' (model pass off: no ANTHROPIC_API_KEY on the server)'}`]
              .concat(data.rows.map((r) => `${r.id}  ${(r.posted || '').slice(0, 10)}  ${r.amount} ${r.currency}  ${(r.payee || r.description || '').slice(0, 40).padEnd(40)}  ${r.category || '-'} / ${r.taxCategoryLabel} / ${r.scope}  [${r.suggestion ? r.suggestion.by : r.categorySource} ${Math.round(((r.categoryConfidence ?? (r.suggestion && r.suggestion.confidence) ?? 0)) * 100)}%]`))
              .join('\n'),
          );
          return EXIT.OK;
        }
        if (action === 'confirm') {
          const id = args[1];
          if (!id) throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances books confirm <transaction-id> [--category c] [--tax t] [--scope business|personal] [--note …] [--always]');
          const row = await api.reviewBooksTransaction(client, id, {
            category: typeof flags.category === 'string' ? flags.category : undefined,
            taxCategory: typeof flags.tax === 'string' ? flags.tax : undefined,
            scope: typeof flags.scope === 'string' ? flags.scope : undefined,
            note: typeof flags.note === 'string' ? flags.note : undefined,
            createRule: flags.always === true,
          });
          emit({ transaction: row }, `Confirmed ${row.id}: ${row.category || '-'} / ${row.taxCategoryLabel} / ${row.scope}${flags.always ? ' (rule created)' : ''}`);
          return EXIT.OK;
        }
        if (action === 'confirm-all') {
          const data = await api.listBooksQueue(client, { status: 'unreviewed', limit: 500 });
          if (!data.rows.length) { emit({ reviewed: 0 }, 'Nothing to confirm.'); return EXIT.OK; }
          if (!flags.yes) throw new CliExit(EXIT.INVALID, `This accepts the suggestion on ${data.rows.length} row(s). Re-run with --yes.`);
          const result = await api.bulkReviewBooks(client, data.rows.map((r) => r.id));
          emit(result, `Confirmed ${result.reviewed} row(s) as suggested.`);
          return EXIT.OK;
        }
        if (action === 'categorize') {
          const data = await api.categorizeBooks(client, { useModel: flags['no-model'] ? false : true, onlyUncategorized: flags['only-uncategorized'] === true });
          progress(`Queued ${describeJob(data.job)}${data.modelEnabled ? '' : ' (model pass off: no ANTHROPIC_API_KEY on the server)'}`);
          let job = data.job;
          if (flags.wait) job = await api.waitForFinanceJob(client, job.id, { onProgress: (j) => progress(describeJob(j)) });
          const r = job.result || {};
          emit({ job }, job.status === 'completed' ? `Examined ${r.examined ?? 0}: ${r.fromRules ?? 0} by rule, ${r.fromModel ?? 0} by model, ${r.autoAccepted ?? 0} accepted, ${r.queued ?? 0} for review` : describeJob(job));
          return job.status === 'failed' ? EXIT.FAILURE : EXIT.OK;
        }
        if (action === 'rules') {
          const sub = args[1];
          if (sub === 'add') {
            const pattern = args[2];
            if (!pattern || typeof flags.category !== 'string') throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances books rules add "<pattern>" --category c [--tax t] [--scope s] [--field payee|description] [--match exact|contains]');
            const rule = await api.createBooksRule(client, { pattern, category: flags.category, taxCategory: typeof flags.tax === 'string' ? flags.tax : undefined, scope: typeof flags.scope === 'string' ? flags.scope : undefined, matchField: typeof flags.field === 'string' ? flags.field : 'payee', matchType: typeof flags.match === 'string' ? flags.match : 'exact' });
            emit({ rule }, `Rule ${rule.id}: ${rule.match_field} ${rule.match_type} "${rule.pattern}" → ${rule.category}`);
            return EXIT.OK;
          }
          if (sub === 'delete') {
            if (!args[2]) throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances books rules delete <rule-id>');
            const data = await api.deleteBooksRule(client, args[2]);
            emit(data, 'Rule deleted.');
            return EXIT.OK;
          }
          const rules = await api.listBooksRules(client);
          emit({ rules }, rules.length ? rules.map((r) => `${r.id}  ${r.match_field} ${r.match_type} "${r.pattern}" → ${r.category}${r.tax_category ? ' / ' + r.tax_category : ''}${r.scope ? ' / ' + r.scope : ''}`).join('\n') : 'No rules.');
          return EXIT.OK;
        }
        if (action === 'send') {
          if (typeof flags.to !== 'string') throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances books send --to cpa@x.com,me@x.com --period 2026 [--scope business] [--format pdf,csv] [--message "…"]');
          const period = typeof flags.period === 'string' ? flags.period : null;
          const from = typeof flags.from === 'string' ? flags.from : undefined;
          const toDate = typeof flags['to-date'] === 'string' ? flags['to-date'] : undefined;
          if (!period && !(from && toDate)) throw new CliExit(EXIT.INVALID, 'Pass --period 2026 (or 2026-Q3, 2026-08) or --from/--to-date');
          const data = await api.sendBooksEmail(client, {
            to: listFlag(flags.to), period: period || undefined, from, toDate,
            timezone: typeof flags.timezone === 'string' ? flags.timezone : undefined,
            scope: typeof flags.scope === 'string' ? flags.scope : 'business',
            formats: flags.format ? listFlag(flags.format) : undefined,
            message: typeof flags.message === 'string' ? flags.message : null,
            attach: flags['no-attach'] ? false : true,
          });
          emit(data, `Sent to ${data.sent.join(', ') || 'nobody'}${data.failed.length ? `; failed: ${data.failed.map((f) => `${f.to} (${f.error})`).join(', ')}` : ''}. ${data.rows} rows, ${data.unreviewed} unreviewed. Link (expires ${data.linkExpiresAt.slice(0, 10)}): ${data.linkUrl}`);
          return data.sent.length > 0 ? EXIT.OK : EXIT.FAILURE;
        }
        if (action === 'summary' || action === 'export') {
          const period = typeof flags.period === 'string' ? flags.period : typeof flags.year === 'string' || typeof flags.year === 'number' ? String(flags.year) : null;
          const from = typeof flags.from === 'string' ? flags.from : undefined;
          const to = typeof flags.to === 'string' ? flags.to : undefined;
          if (!period && !(from && to)) throw new CliExit(EXIT.INVALID, 'Pass --period 2026 (or 2026-Q3, 2026-08) or --from/--to');
          const scope = typeof flags.scope === 'string' ? flags.scope : 'business';
          const timezone = typeof flags.timezone === 'string' ? flags.timezone : undefined;
          if (action === 'summary') {
            const data = await api.getBooksSummary(client, { period: period || undefined, from, to, timezone, scope });
            emit(
              data,
              [`${data.period.label} · ${scope} · ${data.rows} rows (${data.unreviewed} unreviewed, ${data.uncategorized} uncategorised)`]
                .concat(data.totals.map((t) => `${t.currency}: income ${t.income} · expenses ${t.expenses} · net ${t.net} · excluded ${t.excluded}`))
                .concat(data.lines.map((l) => `  ${l.label.padEnd(32)} ${l.currency} ${l.total.padStart(14)}  (${l.rows})${l.excluded ? '  excluded' : ''}`))
                .concat([data.notice])
                .join('\n'),
            );
            return EXIT.OK;
          }
          const format = typeof flags.format === 'string' ? flags.format.toLowerCase() : 'csv';
          const file = await api.exportBooks(client, { period: period || undefined, from, to, timezone, scope, format });
          const output = typeof flags.output === 'string' ? flags.output : file.filename || `books-${period || 'range'}.${format}`;
          const path = writeDownload(output, Buffer.from(file.bytes), { overwrite: flags.overwrite === true });
          emit({ output: path, bytes: file.bytes.length, unreviewed: Number(file.headers['x-unreviewed-rows'] || 0) }, `Wrote ${path} (${file.bytes.length} bytes; ${file.headers['x-unreviewed-rows'] || 0} unreviewed rows)`);
          return EXIT.OK;
        }
        throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances books [queue|confirm <id>|confirm-all --yes|categorize|rules [add|delete]|summary|export|send]');
      }

      case 'digest': {
        const action = args[0] || 'show';
        const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const describe = (s) => s
          ? `${s.active ? 'on' : 'off'} · ${s.weekdays.map((d) => DAY_NAMES[d]).join(',')} at ${String(s.hour).padStart(2, '0')}:00 ${s.timezone} · ${s.scope} · to ${s.recipients.join(', ')}${s.nextRunAt ? ` · next ${s.nextRunAt}` : ''}${s.lastSentAt ? ` · last ${s.lastSentAt}` : ''}`
          : 'No weekly digest configured. Set one with: coinpay finances digest set --days mon,fri --hour 8 --to you@example.com';
        if (action === 'show') {
          const s = await api.getWeeklyDigest(client);
          emit({ schedule: s }, describe(s));
          return EXIT.OK;
        }
        if (action === 'set' || action === 'on') {
          const days = flags.days ? listFlag(flags.days).map((d) => { const i = DAY_NAMES.indexOf(d.toLowerCase().slice(0, 3)); return i === -1 ? Number(d) : i; }) : undefined;
          if (days && days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new CliExit(EXIT.INVALID, '--days takes names like mon,fri or numbers 0 (Sunday) to 6');
          const s = await api.setWeeklyDigest(client, {
            weekdays: days,
            hour: flags.hour !== undefined ? Number(flags.hour) : undefined,
            timezone: typeof flags.timezone === 'string' ? flags.timezone : undefined,
            recipients: flags.to ? listFlag(flags.to) : undefined,
            scope: typeof flags.scope === 'string' ? flags.scope : undefined,
            formats: flags.format ? listFlag(flags.format) : undefined,
            active: true,
          });
          emit({ schedule: s }, describe(s));
          return EXIT.OK;
        }
        if (action === 'off' || action === 'pause') {
          const s = await api.setWeeklyDigest(client, { active: false });
          emit({ schedule: s }, describe(s));
          return EXIT.OK;
        }
        if (action === 'delete') {
          const data = await api.deleteWeeklyDigest(client);
          emit(data, 'Weekly digest removed.');
          return EXIT.OK;
        }
        if (action === 'send-now') {
          const data = await api.sendWeeklyDigestNow(client);
          emit(data, `Sent to ${data.sent.join(', ') || 'nobody'}${data.failed.length ? `; failed: ${data.failed.map((f) => `${f.to} (${f.error})`).join(', ')}` : ''}`);
          return data.sent.length > 0 ? EXIT.OK : EXIT.FAILURE;
        }
        throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances digest [show|set --days mon,fri --hour 8 --to a@x,b@y [--scope business]|off|delete|send-now]');
      }

      case 'payloads': {
        const action = args[0] || 'list';
        if (action === 'list') {
          const data = await api.listFinancePayloads(client, { connectionId: typeof flags.connection === 'string' ? flags.connection : undefined, limit: flags.limit ? Number(flags.limit) : undefined });
          emit(data, data.payloads.length ? data.payloads.map((p) => `${p.id}  ${p.fetchedAt}  ${p.provider}  ${p.requestClass}  ${p.accounts} accounts / ${p.transactions} tx / ${p.errors} errors  ${p.bytes} bytes`).join('\n') : 'No archived payloads yet.');
          return EXIT.OK;
        }
        if (action === 'download') {
          const id = args[1];
          if (!id) throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances payloads download <payload-id> --output <file.json>');
          const file = await api.downloadFinancePayload(client, id);
          const output = typeof flags.output === 'string' ? flags.output : file.filename || `${id}.json`;
          const path = writeDownload(output, Buffer.from(file.bytes), { overwrite: flags.overwrite === true });
          emit({ output: path, bytes: file.bytes.length, sha256: file.sha256 }, `Wrote ${path} (${file.bytes.length} bytes, as received from the provider)`);
          return EXIT.OK;
        }
        throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances payloads [list|download <id>]');
      }

      default:
        return null;
    }
  } catch (err) {
    if (err instanceof CliExit) {
      if (err.message) errOut(err.message);
      return err.exitCode;
    }
    const code = exitCodeFor(err);
    const detail = err && err.code ? ` (${err.code})` : '';
    errOut(`${err && err.message ? err.message : String(err)}${detail}`);
    if (json) out(JSON.stringify({ error: { code: err && err.code ? err.code : 'error', message: err && err.message ? err.message : String(err) } }));
    return code;
  }
}

export const EXTENDED_SUBCOMMANDS = ['connect', 'disconnect', 'consent', 'backfill', 'jobs', 'coverage', 'report', 'reports', 'statements', 'books', 'payloads', 'digest'];
