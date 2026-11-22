import { NextRequest, NextResponse } from 'next/server';
import { getUsdAccountProvider } from '@/lib/usd-accounts/providers';
import { handleWebhook } from '@/lib/usd-accounts/service';
import { usdAccountsDeps } from '@/lib/usd-accounts/http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/usd-accounts/[provider]
 *
 * A Global USD account partner's webhook. The body is read with
 * `request.text()` and the signature is verified over those exact bytes before
 * anything is parsed. Events are deduped by (provider, event id), so the
 * partner's retries are safe.
 *
 * Nothing here credits anyone: a deposit event is recorded as the partner
 * reported it. The partner holds the money and delivers it to the user's own
 * wallet; see docs/USD-ACCOUNTS.md.
 *
 * 503 when the feature is off or the partner is not configured, so an
 * unconfigured endpoint can never be used to inject events.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await params;
  const provider = getUsdAccountProvider(providerId);
  if (!provider) {
    return NextResponse.json({ available: false, error: 'Global USD accounts are not available' }, { status: 503 });
  }

  const raw = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });

  try {
    const outcome = await handleWebhook(providerId, raw, headers, { ...usdAccountsDeps(), provider });
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err) {
    // 500 so the partner retries; dedupe makes the retry safe.
    console.error(`[usd-accounts] ${providerId} webhook failed`, err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
