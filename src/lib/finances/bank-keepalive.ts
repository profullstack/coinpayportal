import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';
import { sendEmail } from '../email';
import { BrowserBusyError, launchCloudBrowser, loadEngine } from './cloud-browser';
import { checkSiteThrottle } from './site-attempts';
import { captureState, getBankSession, loadSessionState, nextTouchAt, saveSession, updateBankSession, type BankSessionRow, type SessionState } from './bank-sessions';

/**
 * Keeping cloud bank sessions alive.
 *
 * A bank ends a web session after some minutes without activity. The saved
 * cookies keep CoinPay's browser trusted as a device, so the bank does not ask
 * for MFA again, but not signed in. So every connected bank is *touched* on a
 * short interval (FINANCES_BANK_KEEPALIVE_MINUTES, default 10, with jitter):
 * refresh the statements page in the bank's own long-running browser,
 * and save the cookies the bank just rotated. A touch takes seconds and holds
 * one of the server's browser slots only that long.
 *
 * When a bank ends the session anyway (most cap a session at some hours), the
 * page asks for a password; the bank becomes "needs sign-in" and the merchant
 * gets one email with a link to reconnect.
 */

type Browser = Awaited<ReturnType<typeof launchCloudBrowser>>['browser'];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The core of a touch, in the bank's own long-running browser: open
 * `startUrl` in its main tab and decide whether the bank still has us signed
 * in. Watches for a password field or a sign-in URL for up to `watchMs`, since
 * banks bounce a lapsed session to their sign-in page from JavaScript. On
 * success, captures the cookies for the sealed copy.
 */
export async function refreshSession(
  browser: Browser,
  page: string,
  { startUrl, watchMs = 15_000 }: { startUrl: string; watchMs?: number },
): Promise<{ signedIn: true; state: SessionState; url: string } | { signedIn: false; url: string }> {
  const sf = await loadEngine();
  await browser.cdp.send('Page.navigate', { url: startUrl }, page);
  const evaluate = async (expression: string) => {
    try {
      const { result } = (await browser.cdp.send('Runtime.evaluate', { expression, returnByValue: true }, page)) as { result: { value?: unknown } };
      return result.value;
    } catch {
      return null;
    }
  };
  const deadline = Date.now() + watchMs;
  let url = startUrl;
  while (Date.now() < deadline) {
    await sleep(1500);
    url = String((await evaluate('location.href')) ?? url);
    if ((await evaluate(sf.SIGNED_OUT)) === true || sf.isSignInUrl(url)) return { signedIn: false, url };
  }
  return { signedIn: true, state: await captureState(browser.cdp, page), url };
}

/** Email the merchant once that a bank needs them to sign in again. */
export async function notifyNeedsSignIn(row: Pick<BankSessionRow, 'merchant_id' | 'institution_key' | 'institution_label' | 'notified_at'>): Promise<void> {
  if (row.notified_at) return;
  const supabase = getSupabaseAdmin();
  const { data: merchant } = await supabase.from('merchants').select('email').eq('id', row.merchant_id).maybeSingle();
  const to = (merchant as { email?: string } | null)?.email;
  if (to) {
    const bank = row.institution_label || row.institution_key;
    const app = (process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com').replace(/\/$/, '');
    const link = `${app}/finances/statements`;
    await sendEmail({
      to,
      subject: `${bank} needs you to sign in again`,
      html: `<p>${bank} ended the session CoinPay keeps for your statements, so new statements cannot be fetched until you sign in again.</p>
<p><a href="${link}">Reconnect ${bank}</a> (Statements, CoinPay cloud, Reconnect), or run <code>coinpay finances statements cloud connect ${row.institution_key}</code>.</p>
<p>Your saved session was kept; signing in again usually skips the security code, because the bank still knows CoinPay's browser.</p>`,
    }).catch((err) => console.error('[bank-keepalive] notify failed', err instanceof Error ? err.message : err));
  }
  await updateBankSession(row.merchant_id, row.institution_key, { notified_at: new Date().toISOString() });
}

/** One touch of one bank, end to end. Returns what happened. */
export async function touchBankSession(row: BankSessionRow): Promise<'alive' | 'login_needed' | 'busy' | 'skipped' | 'error'> {
  const { cloudStatementsAccess } = await import('./cloud-statements');
  const access = { id: row.merchant_id, actorId: row.merchant_id };
  if (!(await cloudStatementsAccess(access)).allowed) {
    await updateBankSession(row.merchant_id, row.institution_key, { next_touch_at: nextTouchAt(Date.now() + 6 * 3_600_000) });
    return 'skipped';
  }
  const supabase = getSupabaseAdmin();
  const { data: running } = await supabase
    .from('finance_jobs')
    .select('id')
    .eq('merchant_id', row.merchant_id)
    .eq('kind', 'statement_fetch')
    .eq('status', 'running')
    .contains('params', { institutionKey: row.institution_key })
    .limit(1);
  if (running && running.length) {
    // The fetch is visiting the bank right now; that counts.
    await updateBankSession(row.merchant_id, row.institution_key, { next_touch_at: nextTouchAt() });
    return 'skipped';
  }

  const sf = await loadEngine();
  if (sf.taxSource(row.institution_key)) {
    // Tax sites have a visit budget (finance_site_attempts); never keep them alive.
    await updateBankSession(row.merchant_id, row.institution_key, { keepalive: false, next_touch_at: null });
    return 'skipped';
  }
  // A bank that locked the account (recorded by the connect lockout watcher)
  // must not be touched again until the lock clears, or the keepalive just
  // keeps re-triggering it. Back off until the recorded lock ends.
  const throttle = await checkSiteThrottle(row.merchant_id, row.institution_key);
  if (!throttle.ok && throttle.reason === 'locked') {
    const until = throttle.retryAt ? Date.parse(throttle.retryAt) : Date.now() + 6 * 3_600_000;
    await updateBankSession(row.merchant_id, row.institution_key, { next_touch_at: nextTouchAt(until) });
    return 'skipped';
  }

  const startUrl = row.start_url ?? sf.startUrls({ key: row.institution_key, url: null }, null).fetch;
  if (!startUrl) return 'skipped';

  const { acquireBankBrowser, closeBankBrowser } = await import('./bank-browsers');
  let held: Awaited<ReturnType<typeof acquireBankBrowser>>;
  try {
    held = await acquireBankBrowser(row.merchant_id, row.institution_key, { restore: () => loadSessionState(row) });
  } catch (err) {
    if (err instanceof BrowserBusyError || (err as { code?: string }).code === 'cloud_browser_busy') return 'busy';
    throw err;
  }
  const now = new Date().toISOString();
  let lapsed = false;
  try {
    const result = await refreshSession(held.bb.browser, held.bb.page, { startUrl });
    if (result.signedIn) {
      await saveSession({
        access,
        institutionKey: row.institution_key,
        institutionLabel: row.institution_label,
        state: result.state,
        status: 'active',
      });
      await updateBankSession(row.merchant_id, row.institution_key, { last_touch_at: now, next_touch_at: nextTouchAt() });
      return 'alive';
    }
    lapsed = true;
    await updateBankSession(row.merchant_id, row.institution_key, { state: 'login_needed', last_status: 'needs sign-in', last_touch_at: now, next_touch_at: null });
    await notifyNeedsSignIn(row);
    return 'login_needed';
  } catch (err) {
    console.error(`[bank-keepalive] ${row.institution_key}:`, err instanceof Error ? err.message : err);
    // A bank that errors (loops, refuses the datacenter, challenges) should not
    // be retried on the normal ~10 minute cadence — back off about an hour so a
    // persistently unhappy bank is not hammered into a lock.
    await updateBankSession(row.merchant_id, row.institution_key, { next_touch_at: nextTouchAt(Date.now() + 60 * 60_000) }).catch(() => undefined);
    return 'error';
  } finally {
    held.release();
    // Nothing left to keep alive: free the memory, keep the profile.
    if (lapsed) await closeBankBrowser(row.merchant_id, row.institution_key).catch(() => undefined);
  }
}

/** Touch the banks that are due, a couple at a time. */
export async function runKeepAliveTick(now: Date = new Date(), limit = 2): Promise<Record<string, number>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_bank_sessions')
    .select('merchant_id, institution_key')
    .eq('state', 'active')
    .eq('keepalive', true)
    .not('object_key', 'is', null)
    .or(`next_touch_at.is.null,next_touch_at.lte.${now.toISOString()}`)
    .order('next_touch_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(`Could not read due bank sessions: ${error.message}`);
  const outcome: Record<string, number> = {};
  for (const due of (data ?? []) as Pick<BankSessionRow, 'merchant_id' | 'institution_key'>[]) {
    const row = await getBankSession(due.merchant_id, due.institution_key);
    if (!row) continue;
    const result = await touchBankSession(row);
    outcome[result] = (outcome[result] ?? 0) + 1;
    if (result === 'busy') break;
  }
  return outcome;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

/** In-process loop beside the finance worker, started from instrumentation. */
export function startBankKeepAliveLoop(intervalMs = 60_000): void {
  if (timer || process.env.FINANCES_CLOUD_STATEMENTS_ENABLED === 'false' || process.env.FINANCES_BANK_KEEPALIVE_ENABLED === 'false') return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const outcome = await runKeepAliveTick();
      if (Object.keys(outcome).length) console.log('[bank-keepalive]', JSON.stringify(outcome));
    } catch (err) {
      console.error('[bank-keepalive] tick failed', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  console.log(`[bank-keepalive] started (every ${intervalMs}ms)`);
}
