/**
 * An attempt ledger for sites that punish repeated sign-ins.
 *
 * Tax agencies lock an account after a few attempts and restart the lock on
 * any attempt made inside it (MyFTB: "Account Locked ... exceeded the allowed
 * number of attempts", a 30-minute block that starts over). A retry loop turns
 * one lockout into an open-ended one, so every visit to a throttled source is
 * counted BEFORE it is made, and:
 *
 * - at most `perWindow` attempts per `windowMs` (2 per 30 minutes) and
 *   `perDay` per 24 hours (4);
 * - a lockout the site shows is recorded and respected until it ends, with no
 *   override (not even --force);
 * - nothing here ever re-submits a credential or a code: the person types
 *   those, once, in a window they drive.
 *
 * The pure functions take the ledger as data so the CLI (a JSON file under
 * ~/.coinpay/statements) and the server (rows in finance_site_attempts) share
 * the same rules.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const TAX_THROTTLE = Object.freeze({
  windowMs: 30 * 60_000,
  perWindow: 2,
  perDay: 4,
  /** When the lockout page names no duration. */
  defaultLockoutMinutes: 60,
  /** Added to a duration the site names, because its clock and ours differ. */
  marginMinutes: 5,
});

const DAY_MS = 24 * 60 * 60_000;

/**
 * Whether one more attempt is allowed now.
 * `attempts` is a list of ISO timestamps (or {at}), `lockedUntil` an ISO time or null.
 * Returns `{ok: true}` or `{ok: false, reason, retryAt, message}`.
 */
export function evaluateThrottle({ attempts = [], lockedUntil = null, lockReason = null } = {}, now = new Date(), limits = TAX_THROTTLE) {
  const t = now.getTime();
  if (lockedUntil && Date.parse(lockedUntil) > t) {
    return {
      ok: false,
      reason: 'locked',
      retryAt: new Date(Date.parse(lockedUntil)).toISOString(),
      message: `the site locked this account${lockReason ? ` (${lockReason})` : ''}; CoinPay will not try again before ${new Date(Date.parse(lockedUntil)).toISOString()}`,
    };
  }
  const times = attempts
    .map((a) => Date.parse(typeof a === 'string' ? a : a && a.at))
    .filter((v) => Number.isFinite(v) && v <= t)
    .sort((a, b) => a - b);
  const inDay = times.filter((v) => t - v < DAY_MS);
  if (inDay.length >= limits.perDay) {
    const retryAt = new Date(inDay[inDay.length - limits.perDay] + DAY_MS).toISOString();
    return { ok: false, reason: 'daily_limit', retryAt, message: `${limits.perDay} attempts in the last 24 hours already; next allowed at ${retryAt}` };
  }
  const inWindow = times.filter((v) => t - v < limits.windowMs);
  if (inWindow.length >= limits.perWindow) {
    const retryAt = new Date(inWindow[inWindow.length - limits.perWindow] + limits.windowMs).toISOString();
    return { ok: false, reason: 'window_limit', retryAt, message: `${limits.perWindow} attempts in the last ${Math.round(limits.windowMs / 60_000)} minutes already; next allowed at ${retryAt}` };
  }
  return { ok: true };
}

/**
 * A lockout page, from its visible text: `{minutes}` (null when it names no
 * duration) or null when the page is not one. Generic on purpose: FTB, IRS and
 * ID.me word it differently, and none publishes the markup.
 */
export function detectLockout(text) {
  const body = String(text || '').replace(/\s+/g, ' ');
  if (!body) return null;
  const locked =
    /\baccount (?:is |has been |was )?(?:temporarily )?(?:locked|disabled|suspended)\b/i.test(body) ||
    /\b(?:exceeded|reached) the (?:allowed|maximum|max) (?:number of )?(?:login |sign-?in |failed )?(?:attempts|tries)\b/i.test(body) ||
    /\btoo many (?:failed |unsuccessful |login |sign-?in )?(?:attempts|tries|requests)\b/i.test(body) ||
    /\b(?:temporarily|currently) (?:locked out|blocked)\b/i.test(body) ||
    /\blocked out\b/i.test(body);
  if (!locked) return null;
  const minutes = /(\d{1,4})\s*(?:-\s*)?(minutes?|mins?|hours?|hrs?)\b/i.exec(body);
  if (!minutes) return { minutes: null };
  const n = Number(minutes[1]);
  return { minutes: /^h/i.test(minutes[2]) ? n * 60 : n };
}

/** How long to stay away after a lockout: the site's own duration plus a margin, or the default. */
export function lockoutUntil(found, now = new Date(), limits = TAX_THROTTLE, defaultMinutes = limits.defaultLockoutMinutes) {
  const minutes = found && found.minutes ? found.minutes + limits.marginMinutes : defaultMinutes;
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

// ---------------------------------------------------------------------------
// The local ledger: ~/.coinpay/statements/throttle.json
// ---------------------------------------------------------------------------

export function throttlePath(home) {
  return join(home, 'throttle.json');
}

/** `{sources: {key: {attempts: [{at, kind}], lockedUntil, lockReason}}}` */
export function loadThrottle(home) {
  const path = throttlePath(home);
  if (!existsSync(path)) return { sources: {} };
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return { sources: data && typeof data.sources === 'object' && data.sources ? data.sources : {} };
  } catch {
    // A corrupt ledger must not become "no attempts made": refuse until it is fixed.
    throw new Error(`${path} is not valid JSON; fix or remove it (it records sign-in attempts so CoinPay does not lock your account)`);
  }
}

export function saveThrottle(ledger, home) {
  const path = throttlePath(home);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
  chmodSync(path, 0o600);
}

function entry(ledger, key) {
  ledger.sources[key] ||= { attempts: [], lockedUntil: null, lockReason: null };
  return ledger.sources[key];
}

export function checkLocalThrottle(home, key, now = new Date(), limits = TAX_THROTTLE) {
  const source = loadThrottle(home).sources[key];
  return evaluateThrottle(source || {}, now, limits);
}

/**
 * Check, and when allowed record the attempt in the same step, so the visit
 * is counted before it is made. Returns the verdict.
 */
export function takeLocalAttempt(home, key, kind, now = new Date(), limits = TAX_THROTTLE) {
  const ledger = loadThrottle(home);
  const source = entry(ledger, key);
  const verdict = evaluateThrottle(source, now, limits);
  if (!verdict.ok) return verdict;
  source.attempts = source.attempts.filter((a) => now.getTime() - Date.parse(a.at) < DAY_MS);
  source.attempts.push({ at: now.toISOString(), kind });
  saveThrottle(ledger, home);
  return verdict;
}

export function recordLocalLockout(home, key, until, reason = 'lockout page') {
  const ledger = loadThrottle(home);
  const source = entry(ledger, key);
  if (!source.lockedUntil || Date.parse(until) > Date.parse(source.lockedUntil)) source.lockedUntil = until;
  source.lockReason = String(reason).slice(0, 200);
  saveThrottle(ledger, home);
  return source;
}
