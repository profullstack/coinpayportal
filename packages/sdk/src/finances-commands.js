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
  if (timezone !== undefined && !/^([A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+|UTC)$/.test(timezone)) {
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
        throw new CliExit(EXIT.INVALID, 'Usage: coinpay finances reports [list|get <id>|download <id>|delete <id>]');
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

export const EXTENDED_SUBCOMMANDS = ['connect', 'disconnect', 'consent', 'backfill', 'jobs', 'coverage', 'report', 'reports', 'statements'];
