import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { institutionFor, requireCloudStatements } from '@/lib/finances/cloud-statements';
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
    const live = await startLiveSession({ merchantId: guard.id, actorId: guard.actorId, institutionKey: key, institutionLabel: institution.name, url });
    return financeJson({ live, viewerUrl: `/finances/statements/connect/${live.id}` }, 201);
  } catch (err) {
    return cloudError(err, 'Could not open the bank');
  }
}
