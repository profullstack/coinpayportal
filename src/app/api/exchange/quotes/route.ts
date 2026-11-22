/**
 * POST /api/exchange/quotes
 *
 * Body: { from, to, amount, destinationAddress?, refundAddress? }
 * Returns every eligible provider's quote, best delivered amount first, each
 * with an id to pass to POST /api/exchange/orders. Anonymous, rate limited.
 */

import { NextRequest } from 'next/server';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getClientIp } from '@/lib/web-wallet/client-ip';
import { errorResponse, exchangeSupabase, guardEnabled, json, requestCountry } from '@/lib/exchange/http';
import { parseQuoteRequest, quoteAndStore } from '@/lib/exchange/orders';

export async function POST(request: NextRequest) {
  const off = guardEnabled();
  if (off) return off;

  const rate = await checkRateLimitAsync(getClientIp(request) || 'unknown', 'exchange_quote');
  if (!rate.allowed) return json({ error: 'Too many quote requests. Try again shortly.', code: 'rate_limited' }, 429);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_request' }, 400);
  }

  try {
    const req = parseQuoteRequest(body ?? {}, requestCountry(request));
    const result = await quoteAndStore(exchangeSupabase(), req);
    return json({
      requestId: result.requestId,
      policyVersion: result.policyVersion,
      quotes: result.quotes.map((q) => ({
        id: q.id,
        provider: q.provider,
        from: q.from,
        to: q.to,
        amountIn: q.amountIn,
        expectedAmountOut: q.expectedAmountOut,
        fees: q.fees,
        minAmountIn: q.minAmountIn ?? null,
        expiresAt: q.expiresAt ? new Date(q.expiresAt).toISOString() : null,
        etaSeconds: q.etaSeconds,
        verification: q.verification,
        warnings: q.warnings,
      })),
      unavailable: result.unavailable,
      disclosure:
        'CoinPay does not collect identity documents for this flow. The selected provider may require verification under its own policy.',
    });
  } catch (e) {
    return errorResponse(e, 'quotes');
  }
}
