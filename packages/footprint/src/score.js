/**
 * Turning signals into a verdict.
 *
 * Three verdicts, because two is not enough to act well:
 *
 *   human       nothing suggests automation. Serve it.
 *   automated   something the request cannot fake says machine.
 *   unclear     signals are thin. The caller decides, and on a page that
 *               costs real money to render, charging is a fair default —
 *               a reader who is wrongly charged sees a price, not a wall.
 *
 * The scores are ordered by how hard the signal is to forge, NOT by how
 * suspicious it feels. `spoofedBrowser` is decisive because a request cannot
 * both claim Chromium and suppress a forbidden header by accident. Hosting is
 * strong but not decisive on its own: corporate VPNs, university egress and
 * privacy relays all resolve to infrastructure while carrying real readers
 * behind them, so hosting alone must never be enough to convict.
 */

/** Score at or above which a request is called automated. */
export const AUTOMATED_AT = 70;

/** Score below which a request is called human. */
export const HUMAN_BELOW = 30;

/**
 * Combine header signals (always present) with address facts (optional).
 *
 * `ip` may be omitted entirely — the header signals stand on their own, which
 * is what lets a caller decide without ever making a network call.
 */
export function score(signals, ip = null) {
  const reasons = [];
  let points = 0;

  const add = (n, why) => {
    points += n;
    reasons.push(`${why} (+${n})`);
  };

  if (signals.missingUserAgent) add(60, 'no user agent');

  // Decisive: a forbidden header cannot be dropped by a real Chromium.
  if (signals.spoofedBrowser) add(80, 'claims Chromium but sends no Sec-Fetch-Mode');

  // Honest automation. Named separately so a caller can price it differently
  // from something actively lying about what it is.
  if (signals.obviousTool) add(70, 'self-identified HTTP client');
  else if (signals.declaresItself) add(50, 'self-identified bot');

  // Corroborating only. A browser sends several of these; scoring the absence
  // of all of them catches bare HTTP clients without punishing odd browsers.
  if (signals.browserHeaderCount === 0) add(30, 'no browser headers at all');
  else if (signals.browserHeaderCount <= 2) add(10, 'few browser headers');

  if (ip && !ip.unknown) {
    if (ip.isTor) add(40, 'Tor exit');
    if (ip.isVpn) add(15, 'VPN egress');
    if (ip.isProxy) add(30, 'known proxy');
    // Hosting is strong corroboration, never a conviction on its own: see the
    // header comment on corporate and university egress.
    if (ip.isHosting) add(35, 'hosting/datacenter address');
  }

  points = Math.max(0, Math.min(100, points));

  let verdict;
  if (points >= AUTOMATED_AT) verdict = 'automated';
  else if (points < HUMAN_BELOW) verdict = 'human';
  else verdict = 'unclear';

  return { verdict, score: points, reasons };
}

/**
 * Whether this should be treated as non-human for a pay-or-leave gate.
 *
 * `unclear` counts as non-human when `chargeUnclear` is set, which is the
 * right default for an expensive page: the caller is choosing to charge, not
 * to block, so the cost of being wrong is a price tag rather than a locked door.
 */
export function isNonHuman(result, { chargeUnclear = true } = {}) {
  if (result.verdict === 'automated') return true;
  return chargeUnclear && result.verdict === 'unclear';
}
