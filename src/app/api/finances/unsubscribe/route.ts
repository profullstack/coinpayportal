import { NextRequest, NextResponse } from 'next/server';
import { verifyUnsubscribe } from '@/lib/finances/unsubscribe-token';
import { unsubscribeSchedule } from '@/lib/finances/daily-subscriptions';
import { escapeHtml } from '@/lib/finances/render';

export const dynamic = 'force-dynamic';

/**
 * One-click unsubscribe from a finance default report (the daily summary or
 * the weekly digest), no login: the signed token (`?t=`) names the merchant,
 * the report and the address it was sent to.
 *
 * - POST unsubscribes. Mail clients send it themselves for the
 *   `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header (RFC 8058),
 *   and the button on the page below posts the same.
 * - GET only shows that page. Link scanners and mail previewers fetch every
 *   URL in a message, so a GET that unsubscribed would unsubscribe people who
 *   never clicked.
 */

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>
<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;color:#111;background:#fff">
<h1 style="font-size:20px">${escapeHtml(title)}</h1>${body}</body></html>`;
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

const invalid = () => page('Link not valid', '<p>This unsubscribe link is incomplete or was altered. Use the link from the email itself, or turn it off at <a href="/finances/books#weekly-digest">Finances settings</a>.</p>', 400);

const COPY = {
  daily_summary: { name: 'the daily summary', title: 'Unsubscribe from the daily summary', on: '<code>coinpay finances daily on</code>' },
  weekly_digest: { name: 'the weekly digest', title: 'Turn off the weekly digest', on: '<a href="/finances/books#weekly-digest">Finances settings</a>' },
  weekly_payments: { name: 'the weekly payments report', title: 'Turn off the weekly payments report', on: '<a href="/settings#weekly-payments">Settings</a>' },
} as const;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('t');
  const claim = verifyUnsubscribe(token);
  if (!claim) return invalid();
  const copy = COPY[claim.kind];
  return page(
    copy.title,
    `<p>Stop sending ${copy.name} to <strong>${escapeHtml(claim.email)}</strong>?</p>
<form method="post" action="?t=${encodeURIComponent(token!)}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit" style="font-size:15px;padding:8px 16px">Unsubscribe</button></form>
<p style="font-size:13px;color:#666">It stays off unless you turn it back on (${copy.on}).</p>`,
  );
}

export async function POST(req: NextRequest) {
  const claim = verifyUnsubscribe(req.nextUrl.searchParams.get('t'));
  if (!claim) return invalid();
  try {
    const copy = COPY[claim.kind];
    const outcome = await unsubscribeSchedule(claim.merchantId, claim.kind, claim.email);
    const done = outcome === 'already' ? 'You were already unsubscribed.' : `You will not get ${copy.name} again.`;
    return page('Unsubscribed', `<p>${escapeHtml(done)} (${escapeHtml(claim.email)})</p><p style="font-size:13px;color:#666">Changed your mind? Turn it back on: ${copy.on}.</p>`);
  } catch (err) {
    console.error('[finances/unsubscribe] failed', err instanceof Error ? err.message : err);
    return page('Could not unsubscribe', '<p>Something went wrong on our side. Please try the link again in a minute.</p>', 500);
  }
}
