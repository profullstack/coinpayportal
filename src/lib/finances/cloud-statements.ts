import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';
import { isPaidTier } from '../entitlements/service';
import { listAccounts } from './summary';
import { importStatement, StatementError } from './statements';
import { resolveFinanceTimezone } from './settings';
import { recordFetchRun } from './statement-fetch';
import { createJob, heartbeat, releaseWithStatus, type FinanceJobRow } from './jobs';
import { BrowserBusyError, launchCloudBrowser, loadEngine } from './cloud-browser';
import { installRequestGuard } from './bank-guard';
import { captureState, getBankSession, loadSessionState, restoreState, saveSession, updateBankSession, type BankSessionRow } from './bank-sessions';
import { createDocument, DocumentError } from './documents';
import { recordSiteLockout, takeSiteAttempt } from './site-attempts';

/**
 * CoinPay cloud statement fetching: the server signs in to the bank with the
 * session the merchant saved (bank-sessions.ts) and downloads every new PDF
 * statement into the statement library, on a weekly schedule or on demand.
 *
 * A paid feature: an active Professional plan, or free for CoinPay admins.
 */

/** True for a site's front page: path "/" whatever the query says. */
export function isSiteRoot(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname === '/' || u.pathname === '';
  } catch {
    return false;
  }
}

/**
 * Where a fetch or a keep-alive starts: the page saved at sign-in, unless it
 * is the bank's front page and a statements page is known for that bank.
 * (American Express was saved on www.americanexpress.com/?inav=…, whose
 * login box shows even while signed in.)
 */
export function effectiveStartUrl(institutionKey: string, saved: string | null | undefined, drivers: ReadonlyArray<{ key: string; statements?: string }>): string | null {
  const known = drivers.find((d) => d.key === institutionKey)?.statements ?? null;
  if (saved && known && isSiteRoot(saved)) return known;
  return saved ?? known;
}

export class CloudStatementsError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export interface CloudAccess {
  allowed: boolean;
  reason: 'admin' | 'professional' | 'not_paid' | 'disabled';
  message: string;
}

/** Who may use cloud fetching: admins always, otherwise an active Professional plan on the books' owner. */
export async function cloudStatementsAccess(access: { id: string; actorId: string }): Promise<CloudAccess> {
  if (process.env.FINANCES_CLOUD_STATEMENTS_ENABLED === 'false') {
    return { allowed: false, reason: 'disabled', message: 'Cloud statement fetching is turned off on this deployment.' };
  }
  const supabase = getSupabaseAdmin();
  const ids = [...new Set([access.id, access.actorId])];
  const { data } = await supabase.from('merchants').select('id, is_admin').in('id', ids);
  if ((data ?? []).some((m: { is_admin?: boolean }) => m.is_admin)) {
    return { allowed: true, reason: 'admin', message: 'Included for CoinPay admins.' };
  }
  if (await isPaidTier(supabase, access.id)) {
    return { allowed: true, reason: 'professional', message: 'Included in your Professional plan.' };
  }
  return {
    allowed: false,
    reason: 'not_paid',
    message: 'Cloud statement fetching is part of the Professional plan. The local fetcher (coinpay finances statements fetch) stays free.',
  };
}

export async function requireCloudStatements(access: { id: string; actorId: string }): Promise<CloudAccess> {
  const verdict = await cloudStatementsAccess(access);
  if (!verdict.allowed) throw new CloudStatementsError('payment_required', verdict.message, 402);
  return verdict;
}

/**
 * The merchant's banks, from their linked accounts, keyed the way the fetcher
 * keys them, plus the tax sources (FTB, IRS), which need no linked account.
 */
export async function merchantInstitutions(merchantId: string) {
  const sf = await loadEngine();
  return sf.withStandaloneSources(sf.groupInstitutions(await listAccounts(merchantId)));
}

export async function institutionFor(merchantId: string, key: string) {
  const institutions = await merchantInstitutions(merchantId);
  const institution = institutions.find((i) => i.key === key);
  if (!institution) throw new CloudStatementsError('not_found', `No linked bank or tax source "${key}"`, 404);
  return institution;
}

/** A tax source's throttle verdict as the cloud routes' error. */
export function throttledError(verdict: { reason?: string; retryAt?: string; message?: string }): CloudStatementsError {
  return new CloudStatementsError(verdict.reason === 'locked' ? 'site_locked' : 'site_throttled', `Not now: ${verdict.message ?? 'too many attempts'}`, 429);
}

/** Queue a cloud fetch for one bank; one in flight per bank. */
export async function enqueueStatementFetch(merchantId: string, institutionKey: string, { reason = 'manual' }: { reason?: string } = {}): Promise<FinanceJobRow> {
  const supabase = getSupabaseAdmin();
  const { data: active } = await supabase
    .from('finance_jobs')
    .select('*')
    .eq('merchant_id', merchantId)
    .eq('kind', 'statement_fetch')
    .in('status', ['queued', 'running', 'waiting_for_budget'])
    .contains('params', { institutionKey })
    .limit(1)
    .maybeSingle();
  if (active) return active as FinanceJobRow;
  return createJob({ merchantId, kind: 'statement_fetch', params: { institutionKey, reason } });
}

/** Weekly: every active bank session whose next fetch is due gets one job. */
export async function enqueueScheduledStatementFetches(now: Date = new Date()): Promise<number> {
  if (process.env.FINANCES_CLOUD_STATEMENTS_ENABLED === 'false') return 0;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_bank_sessions')
    .select('merchant_id, institution_key, next_fetch_at')
    .eq('state', 'active')
    .neq('schedule', 'off')
    .lte('next_fetch_at', now.toISOString())
    .limit(50);
  if (error) throw new Error(`Could not read due bank sessions: ${error.message}`);
  let created = 0;
  for (const row of (data ?? []) as Pick<BankSessionRow, 'merchant_id' | 'institution_key'>[]) {
    // Entitlement is checked at run time too; a lapsed plan just stops the schedule.
    await enqueueStatementFetch(row.merchant_id, row.institution_key, { reason: 'schedule' });
    await updateBankSession(row.merchant_id, row.institution_key, { next_fetch_at: new Date(now.getTime() + 7 * 86_400_000).toISOString() });
    created += 1;
  }
  return created;
}

const MAX_PER_RUN = 12;

/**
 * One bank, one run: restore the saved session in a fenced headless Chrome,
 * let the shared fetcher find and click every new statement, import each PDF
 * with its account and period, record the run, and save the session again
 * (banks rotate cookies, so the copy that worked is the one to keep).
 */
export async function runStatementFetchJob(job: FinanceJobRow): Promise<void> {
  const institutionKey = String((job.params as { institutionKey?: unknown }).institutionKey ?? '');
  const merchantId = job.merchant_id;
  const access = { id: merchantId, actorId: merchantId };
  const startedAt = new Date().toISOString();

  const verdict = await cloudStatementsAccess(access);
  if (!verdict.allowed) {
    await releaseWithStatus(job, 'cancelled', { error_code: 'payment_required', error_message: verdict.message });
    return;
  }
  const row = await getBankSession(merchantId, institutionKey);
  if (!row || row.state === 'disconnected' || !row.object_key) {
    await releaseWithStatus(job, 'cancelled', { error_code: 'not_connected', error_message: `${institutionKey} is not connected to CoinPay cloud` });
    return;
  }

  const sf = await loadEngine();
  const taxInfo = sf.taxSource(institutionKey);
  const tax = !!taxInfo;

  // A bank fetches inside its own long-running browser (bank-browsers.ts),
  // already fenced and signed in; a tax source gets a throwaway one.
  let browserHandle: { browser: Awaited<ReturnType<typeof launchCloudBrowser>>['browser']; release: () => Promise<void>; page: string | null };
  try {
    if (tax) {
      const handle = await launchCloudBrowser();
      browserHandle = { ...handle, page: null };
    } else {
      const { acquireBankBrowser } = await import('./bank-browsers');
      const held = await acquireBankBrowser(merchantId, institutionKey, { restore: () => loadSessionState(row) });
      browserHandle = { browser: held.bb.browser, release: async () => held.release(), page: held.bb.page };
    }
  } catch (err) {
    if (err instanceof BrowserBusyError || (err as { code?: string }).code === 'cloud_browser_busy') {
      await releaseWithStatus(job, 'queued', { run_after: new Date(Date.now() + 2 * 60_000).toISOString(), error_message: (err as Error).message });
      return;
    }
    throw err;
  }
  if (tax) {
    // Counted before the visit. A refusal waits for the site, it never retries into a lock.
    const verdict = await takeSiteAttempt(merchantId, institutionKey, 'fetch');
    if (!verdict.ok) {
      await browserHandle.release();
      await releaseWithStatus(job, 'queued', { run_after: verdict.retryAt, error_code: 'site_throttled', error_message: verdict.message });
      return;
    }
  }
  const counts = { imported: 0, duplicates: 0, unmatched: 0, refused: 0 };
  const refusedReasons = new Set<string>();
  let status: 'ok' | 'login_needed' | 'no_statements' | 'locked' | 'error' = 'error';
  let message: string | null = null;
  let candidates = 0;
  let silent = 0;
  const seen = new Set<string>(Array.isArray(row.seen_keys) ? row.seen_keys : []);
  let current = job;

  try {
    const { browser } = browserHandle;
    let pageSession: string | null = browserHandle.page;
    // The bank browser was fenced (and restored) when it launched.
    const stopGuard = pageSession
      ? () => undefined
      : await installRequestGuard(browser.cdp, {
          onTarget: (info) => {
            if (info.type === 'page' && !info.url.startsWith('chrome') && !pageSession) pageSession = info.sessionId;
          },
        });
    try {
      for (let i = 0; i < 50 && !pageSession; i += 1) await new Promise((r) => setTimeout(r, 100));
      if (!pageSession) throw new Error('The cloud browser opened no tab');
      if (!browserHandle.page) {
        const state = await loadSessionState(row);
        if (state) await restoreState(browser.cdp, pageSession, state);
      }

      const institution = await institutionFor(merchantId, institutionKey);
      const start = effectiveStartUrl(institutionKey, row.start_url, sf.DRIVERS) ?? sf.startUrls(institution, undefined).fetch;
      if (!start) throw new CloudStatementsError('no_start', 'No page to start from; sign in again');
      const tz = (await resolveFinanceTimezone(merchantId, null, { remember: false }))?.timezone ?? 'UTC';

      const onFile = async (download: { bytes: Buffer; suggestedName: string; label: string; context: string; key: string | null }) => {
          current = await heartbeat(current);
          // A row counts as fetched only once its PDF is in the library. A
          // refused, unmatched or non-PDF download stays retryable, so a fix
          // to the check or the matching picks it up on the next run.
          if (!sf.isPdf(download.bytes)) return;
          if (tax) {
            // Notices, letters and transcripts go to the document library, once per file.
            const info = sf.classifyTaxDocument(download);
            try {
              const doc = await createDocument({
                merchantId,
                uploadedBy: merchantId,
                title: info.title,
                category: 'tax',
                periodLabel: info.periodLabel,
                notes: `Downloaded from ${institution.name} by CoinPay cloud with your saved session.`,
                filename: download.suggestedName || null,
                declaredType: 'application/pdf',
                bytes: Buffer.from(download.bytes),
                source: 'cloud',
                institutionKey,
                taxYear: info.taxYear,
                docType: info.docType,
                dedupe: true,
              });
              if (doc.duplicate) counts.duplicates += 1;
              else counts.imported += 1;
              // Fetched once it is in the library, as for statements (#397).
              if (download.key) seen.add(download.key);
            } catch (err) {
              if (err instanceof DocumentError) {
                counts.refused += 1;
                refusedReasons.add(err.message);
              } else throw err;
            }
            return;
          }
          const account = sf.matchAccount(institution.accounts, download.context, download.suggestedName, download.label);
          const span = sf.importPeriod(sf.periodOf(download.context, download.suggestedName, download.label));
          if (!account || !span) {
            counts.unmatched += 1;
            return;
          }
          try {
            const result = await importStatement({
              merchantId,
              accountId: account.id,
              bytes: Buffer.from(download.bytes),
              originalFilename: download.suggestedName || null,
              institutionLabel: institution.name,
              cycle: span.cycle as 'custom' | undefined,
              period: span.period ?? null,
              from: span.from ?? null,
              to: span.to ?? null,
              timezone: tz,
              notes: 'Downloaded from the bank by CoinPay cloud with your saved session.',
            });
            if (result.duplicateOf && result.duplicateOf === result.statement.id) counts.duplicates += 1;
            else counts.imported += 1;
            if (download.key) seen.add(download.key);
          } catch (err) {
            if (!(err instanceof StatementError)) throw err;
            counts.refused += 1;
            refusedReasons.add(err.message.replace(/^Rejected:\s*/, '').slice(0, 160));
          }
      };
      // Tax sources collect notices and transcripts, watch for a lockout page and go slower.
      const fetchOptions = {
        seen,
        max: MAX_PER_RUN,
        renderMs: 25_000,
        mode: (tax ? 'tax' : 'statements') as 'tax' | 'statements',
        watchLockout: tax,
        pauseMs: tax ? 3000 : 1200,
        onFile,
      };
      let page = await sf.fetchInstitution(browser, { start, ...fetchOptions });
      // Saved on a page without statements (a home page, a dashboard) but the
      // bank has a known statements page: try that, and remember it if it works.
      let learnedStart: string | null = null;
      const known = sf.DRIVERS.find((d) => d.key === institutionKey)?.statements;
      // A home page can show a login box even while signed in (American
      // Express does), so "needs sign-in" there is not believed until the
      // known statements page agrees.
      if ((page.status === 'no_statements' || (page.status === 'login_needed' && !tax)) && known && known !== start) {
        const retry = await sf.fetchInstitution(browser, { start: known, ...fetchOptions });
        if (retry.status !== 'no_statements' || page.status === 'login_needed') {
          page = retry;
          if (retry.status === 'ok') learnedStart = known;
        }
      }
      status = page.status;
      candidates = page.candidates;
      silent = page.silent.length;
      if (status === 'locked') {
        const until = sf.lockoutUntil(page.lockout ?? null, new Date(), undefined, taxInfo?.lockoutMinutes);
        await recordSiteLockout(merchantId, institutionKey, until, 'lockout page during cloud fetch');
        message = `${institution.name} shows a locked account; CoinPay will not try again before ${until}.`;
      } else if (status === 'login_needed') message = tax ? `${institution.name} asked to sign in again. CoinPay never re-enters credentials; reconnect it when you are ready.` : 'The bank asked for a password again. Reconnect it in CoinPay.';
      else if (status === 'no_statements') message = 'No statement links on the saved page. Reconnect and finish on the statements list.';
      else if (counts.refused) message = `${counts.refused} PDF(s) refused by the statement check: ${[...refusedReasons].join('; ')}`.slice(0, 480);

      // Keep the cookies the bank just issued, even after a failed run's partial work.
      if (status !== 'login_needed' && status !== 'locked') {
        const fresh = await captureState(browser.cdp, pageSession);
        await saveSession({
          access,
          institutionKey,
          institutionLabel: institution.name,
          state: fresh,
          status: 'active',
          lastStatus: `${counts.imported} new`,
          seenKeys: [...seen],
          ...(learnedStart ? { startUrl: learnedStart } : {}),
        });
      }
    } finally {
      stopGuard();
    }
  } catch (err) {
    status = 'error';
    message = (err instanceof Error ? err.message : String(err)).slice(0, 400);
  } finally {
    await browserHandle.release();
  }

  const finishedAt = new Date().toISOString();
  await updateBankSession(merchantId, institutionKey, {
    last_fetch_at: finishedAt,
    last_status: status === 'ok' ? `${counts.imported} new` : status,
    ...(status === 'login_needed' ? { state: 'login_needed' as const, next_touch_at: null } : {}),
    seen_keys: [...seen].slice(-1000),
  });
  if (status === 'login_needed') {
    const { notifyNeedsSignIn } = await import('./bank-keepalive');
    await notifyNeedsSignIn(row).catch(() => undefined);
    if (!tax) {
      // No session to keep alive: free the memory, keep the profile (the bank still knows the device).
      const { closeBankBrowser } = await import('./bank-browsers');
      await closeBankBrowser(merchantId, institutionKey).catch(() => undefined);
    }
  }
  await recordFetchRun(access, {
    institutionKey,
    institutionLabel: row.institution_label,
    // Run statuses predate lockouts; a lockout is an error with its message.
    status: status === 'locked' ? 'error' : status,
    candidates,
    filed: counts.imported,
    duplicates: counts.duplicates,
    unmatched: counts.unmatched + counts.refused,
    silent,
    message,
    client: 'coinpay-cloud',
    startedAt,
    finishedAt,
  }).catch(() => undefined);

  const result = { status, candidates, ...counts, silent, refusedReasons: [...refusedReasons] };
  if (status === 'ok' || status === 'login_needed' || status === 'no_statements' || status === 'locked') {
    await releaseWithStatus(current, status === 'ok' ? 'completed' : 'partial', { result, ...(message ? { error_message: message } : {}) });
  } else {
    await releaseWithStatus(current, 'failed', { result, error_code: 'fetch_failed', error_message: message });
  }
}
