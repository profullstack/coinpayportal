import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant, requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { refuseOAuthFundsMove } from '@/lib/auth/oauth-funds';
import { usdAccountsEnabled } from '@/lib/usd-accounts/providers';
import { getStatus, requestAccount } from '@/lib/usd-accounts/service';
import { NO_STORE, usdAccountsDeps, usdAccountsErrorResponse } from '@/lib/usd-accounts/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/usd-accounts — whether Global USD accounts are available, and the
 * merchant's application, account and recent deposits if so.
 *
 * `available: false` is the normal answer while the feature is dark
 * (USD_ACCOUNTS_ENABLED unset, or no partner configured). The full account
 * number in the response is read live from the partner and never stored.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;

  if (!usdAccountsEnabled()) {
    return NextResponse.json({ available: false }, NO_STORE);
  }

  try {
    return NextResponse.json(await getStatus(guard.id, usdAccountsDeps()), NO_STORE);
  } catch (err) {
    return usdAccountsErrorResponse(err, 'usd-accounts');
  }
}

/**
 * POST /api/usd-accounts — request a US account.
 *
 * Body: `{ country, destination: { asset: 'USDC', chain, address }, firstName?, lastName? }`.
 * Idempotent per merchant: repeating it returns the same application and a
 * fresh onboarding link. KYC happens on the partner's hosted page.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;
  // Setting where a user's dollars are delivered is a funds-routing decision;
  // apps signed in with CoinPay cannot make it.
  const oauthRefusal = refuseOAuthFundsMove(guard);
  if (oauthRefusal) return oauthRefusal;

  if (!usdAccountsEnabled()) {
    return NextResponse.json({ available: false, error: 'Global USD accounts are not available' }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);
  const destination = (body.destination && typeof body.destination === 'object' ? body.destination : null) as
    | Record<string, unknown>
    | null;

  try {
    const deps = usdAccountsDeps();
    await requestAccount(
      {
        merchantId: guard.id,
        email: guard.email,
        country: body.country,
        firstName: str(body.firstName)?.slice(0, 100),
        lastName: str(body.lastName)?.slice(0, 100),
        destination: destination
          ? {
              asset: str(destination.asset) as 'USDC' | undefined,
              chain: str(destination.chain) as never,
              address: str(destination.address),
            }
          : null,
      },
      deps,
    );
    return NextResponse.json(await getStatus(guard.id, deps), { status: 201, ...NO_STORE });
  } catch (err) {
    return usdAccountsErrorResponse(err, 'usd-accounts');
  }
}
