/**
 * Escape a value for interpolation into an HTML email body.
 *
 * `proposal-templates.ts` had this function and used it on every interpolated
 * field. Its siblings — `invoice-templates.ts`, `templates.ts`, and the
 * `daily-stats-email` script — did not have it and interpolated
 * merchant-controlled strings raw: business name, invoice number, notes, team
 * member names. A merchant account is free and unverified to create, so those
 * strings are attacker-controlled, and the recipients are the merchant's own
 * customers and (for the daily report) the operations team's inbox.
 *
 * Shared rather than copied a fourth time: the reason three of the four lacked
 * it is that it was written once and never propagated.
 *
 * Single quotes are escaped as well as double, because a value can land inside
 * a single-quoted attribute — `style='...'` — as easily as a double-quoted one.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape a URL destined for an `href`.
 *
 * Escaping the characters is not enough on its own: `javascript:` and `data:`
 * URLs survive HTML escaping intact and still execute when clicked. Anything
 * that is not clearly http(s) or mailto is dropped rather than rendered.
 */
export function escapeUrl(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!/^(https?:|mailto:)/i.test(raw)) return '#';
  return escapeHtml(raw);
}
