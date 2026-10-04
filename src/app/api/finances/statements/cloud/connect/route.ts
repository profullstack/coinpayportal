import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { institutionFor, requireCloudStatements, throttledError } from '@/lib/finances/cloud-statements';
import { lockoutWatcher, takeSiteAttempt } from '@/lib/finances/site-attempts';
import { loadEngine, startLiveSession } from '@/lib/finances/cloud-browser';
import { getBankSession } from '@/lib/finances/bank-sessions';
import { cloudError, INSTITUTION_KEY } from '@/lib/finances/cloud-api';
import { financeError, financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finances/statements/cloud/connect — open the bank in a CoinPay
 * cloud browser so the merchant can sign in. JSON `{institutionKey, url?}`.
 * Answers `{live: {id, status}, viewerUrl}`: the PWA page that streams the
 * browser and sends clicks and keys back. Paid feature (free for admins).
 *
 * Tax sources (ftb, irs, irs-business) need no linked bank. They are
 * throttled (2 sign-ins per 30 minutes, 4 per day, none during a lockout the
 * site showed: 429 `site_throttled` / `site_locked`), and IRS answers with a
 * `warning`: ID.me sits behind Cloudflare, which may refuse a datacenter.
 */
export async function POST(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.write', { write: true });
  if (guard instanceof NextResponse) return guard;
  let body: { institutionKey?: unknown; url?: unknown };
  try {
    body = await req.json();
  } catch {
    return financeError('invalid_request', 'Expected a JSON body', 400);
  }
  const key = typeof body.institutionKey === 'string' ? body.institutionKey : '';
  if (!INSTITUTION_KEY.test(key)) return financeError('invalid_request', 'institutionKey must be a bank key such as "chase"', 400);
  try {
    await requireCloudStatements(guard);
    const institution = await institutionFor(guard.id, key);
    const sf = await loadEngine();
    const existing = await getBankSession(guard.id, key);
    const url = typeof body.url === 'string' && body.url ? body.url : sf.startUrls(institution, null).login ?? existing?.start_url ?? institution.url;
    if (!url) return financeError('invalid_request', `CoinPay has no sign-in page for ${institution.name}; pass url`, 400);
    const tax = sf.taxSource(key);
    let onPageText: ((text: string) => void) | undefined;
    if (tax) {
      const verdict = await takeSiteAttempt(guard.id, key, 'connect');
      if (!verdict.ok) throw throttledError(verdict);
      onPageText = await lockoutWatcher(guard.id, key, tax.lockoutMinutes);
    }
    const live = await startLiveSession({ merchantId: guard.id, actorId: guard.actorId, institutionKey: key, institutionLabel: institution.name, url, onPageText });
    return financeJson({ live, viewerUrl: `/finances/statements/connect/${live.id}`, ...(tax?.cloudWarning ? { warning: tax.cloudWarning } : {}) }, 201);
  } catch (err) {
    return cloudError(err, 'Could not open the bank');
  }
}
