import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth, isBusinessAuth, hasScope } from '@/lib/auth/middleware';
import { authorizeBusinessOwner } from '@/lib/auth/authz';
import { refuseOAuthFundsMove } from '@/lib/auth/oauth-funds';
import { ensurePayoutWallet, getPayoutWallet, EVM_PAYOUT_TOKENS } from '@/lib/payouts/payout-wallet';
import { vaultErrorBody } from '@/lib/vault/vault-service';

/**
 * GET  /api/businesses/:id/payout-wallet   the business's payout wallet, if any
 * POST /api/businesses/:id/payout-wallet   create it (idempotent; never rotates)
 *
 * The payout wallet is the hot wallet /api/payouts/create sends from: CoinPay
 * generates it and holds the encrypted key; the merchant funds it with the
 * payout token plus native gas (POL on Polygon, ETH on Ethereum/Base). One EVM
 * address serves every EVM payout coin.
 *
 * Auth: a business API key with payouts:create (for its own business) or a
 * dashboard session with funds.move on the business. OAuth tokens are refused.
 */
const EVM_COINS = ['POL', 'ETH', 'BNB', ...Object.keys(EVM_PAYOUT_TOKENS)];

async function authorize(request: NextRequest, businessId: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { error: NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 }) };
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  const auth = await authenticateRequest(supabase, request.headers.get('authorization'));
  if (!auth.success || !auth.context) {
    return { error: NextResponse.json({ success: false, error: auth.error || 'Authentication required' }, { status: 401 }) };
  }
  const refusal = refuseOAuthFundsMove(auth.context);
  if (refusal) return { error: refusal };

  if (isBusinessAuth(auth.context)) {
    if (auth.context.businessId !== businessId) {
      return { error: NextResponse.json({ success: false, error: 'API key belongs to another business' }, { status: 403 }) };
    }
    if (!hasScope(auth.context, 'payouts:create')) {
      return { error: NextResponse.json({ success: false, error: 'API key missing required scope: payouts:create' }, { status: 403 }) };
    }
    return { supabase, actor: `api_key:${businessId}` };
  }
  if (isMerchantAuth(auth.context)) {
    const authz = await authorizeBusinessOwner(supabase, auth.context, businessId, 'funds.move');
    if (!authz.ok) {
      return { error: NextResponse.json({ success: false, error: authz.error }, { status: authz.status }) };
    }
    return { supabase, actor: `merchant:${auth.context.merchantId}` };
  }
  return { error: NextResponse.json({ success: false, error: 'Invalid authentication context' }, { status: 401 }) };
}

function body(address: string, extra: Record<string, unknown> = {}) {
  return {
    success: true,
    payout_wallet: {
      family: 'evm',
      address,
      coins: EVM_COINS,
      fund_with: 'the payout token plus a little native gas (POL on Polygon, ETH on Ethereum and Base)',
      ...extra,
    },
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const a = await authorize(request, id);
    if (a.error) return a.error;
    const row = await getPayoutWallet(a.supabase, id, 'evm');
    if (!row) {
      return NextResponse.json({ success: false, error: 'No payout wallet yet: POST to create one' }, { status: 404 });
    }
    return NextResponse.json(body(row.address, { created_at: row.created_at }));
  } catch (error) {
    console.error('Get payout wallet error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const a = await authorize(request, id);
    if (a.error) return a.error;
    const out = await ensurePayoutWallet(a.supabase, id, 'evm', a.actor);
    return NextResponse.json(body(out.address, { created: out.created }), { status: out.created ? 201 : 200 });
  } catch (error) {
    const v = vaultErrorBody(error);
    if (v) return NextResponse.json(v.body, { status: v.status });
    console.error('Create payout wallet error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
