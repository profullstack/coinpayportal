import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';
import { sendEmail } from '../email';
import { BrowserBusyError, launchCloudBrowser, loadEngine } from './cloud-browser';
import { installRequestGuard } from './bank-guard';
import { captureState, getBankSession, loadSessionState, nextTouchAt, restoreState, saveSession, updateBankSession, type BankSessionRow, type SessionState } from './bank-sessions';

/**
 * Keeping cloud bank sessions alive.
 *
 * A bank ends a web session after some minutes without activity. The saved
 * cookies keep CoinPay's browser trusted as a device, so the bank does not ask
 * for MFA again, but not signed in. So every connected bank is *touched* on a
 * short interval (FINANCES_BANK_KEEPALIVE_MINUTES, default 10, with jitter):
 * restore the session in a fresh fenced browser, open the statements page,
 * and save the cookies the bank just rotated. A touch takes seconds and holds
 * one of the server's browser slots only that long.
 *
 * When a bank ends the session anyway (most cap a session at some hours), the
 * page asks for a password; the bank becomes "needs sign-in" and the merchant
 * gets one email with a link to reconnect.
 */

type Browser = Awaited<ReturnType<typeof launchCloudBrowser>>['browser'];
type Check = (url: string) => Promise<{ ok: true } | { ok: false; reason: string }>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The core of a touch, on a browser it is handed: restore `state`, open
 * `startUrl`, and decide whether the bank still has us signed in. Watches for
 * a password field or a sign-in URL for up to `watchMs`, since banks bounce a
 * lapsed session to their sign-in page from JavaScript.
 */
export async function touchSession(
  browser: Browser,
  { state, startUrl, watchMs = 15_000, check }: { state: SessionState; startUrl: string; watchMs?: number; check?: Check },
): Promise<{ signedIn: true; state: SessionState; url: string } | { signedIn: false; url: string }> {
  const sf = await loadEngine();
  let page: string | null = null;
  const stop = await installRequestGuard(browser.cdp, {
    ...(check ? { check } : {}),
    onTarget: (t) => {
      if (t.type === 'page' && !t.url.startsWith('chrome') && !page) page = t.sessionId;
    },
  });
  try {
    for (let i = 0; i < 50 && !page; i += 1) await sleep(100);
    if (!page) throw new Error('The cloud browser opened no tab');
    const session: string = page;
    const { userAgent } = (await browser.cdp.send('Browser.getVersion')) as { userAgent: string };
    await browser.cdp.send('Network.setUserAgentOverride', { userAgent: userAgent.replace('HeadlessChrome', 'Chrome') }, session).catch(() => undefined);
    await restoreState(browser.cdp, session, state);
    await browser.cdp.send('Page.enable', {}, session).catch(() => undefined);
    await browser.cdp.send('Page.navigate', { url: startUrl }, session);

    const evaluate = async (expression: string) => {
      try {
        const { result } = (await browser.cdp.send('Runtime.evaluate', { expression, returnByValue: true }, session)) as { result: { value?: unknown } };
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
    return { signedIn: true, state: await captureState(browser.cdp, session), url };
  } finally {
    stop();
  }
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

  const state = await loadSessionState(row);
  if (!state) return 'skipped';
  const sf = await loadEngine();
  const startUrl = row.start_url ?? sf.startUrls({ key: row.institution_key, url: null }, null).fetch;
  if (!startUrl) return 'skipped';

  let handle: Awaited<ReturnType<typeof launchCloudBrowser>>;
  try {
    handle = await launchCloudBrowser();
  } catch (err) {
    if (err instanceof BrowserBusyError) return 'busy';
    throw err;
  }
  const now = new Date().toISOString();
  try {
    const result = await touchSession(handle.browser, { state, startUrl });
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
    await updateBankSession(row.merchant_id, row.institution_key, { state: 'login_needed', last_status: 'needs sign-in', last_touch_at: now, next_touch_at: null });
    await notifyNeedsSignIn(row);
    return 'login_needed';
  } catch (err) {
    console.error(`[bank-keepalive] ${row.institution_key}:`, err instanceof Error ? err.message : err);
    await updateBankSession(row.merchant_id, row.institution_key, { next_touch_at: nextTouchAt() }).catch(() => undefined);
    return 'error';
  } finally {
    await handle.release();
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
