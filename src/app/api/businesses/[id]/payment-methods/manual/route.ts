import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant, keyMayActOnBusiness } from '@/lib/auth/merchant';
import { verifyBusinessAccess } from '@/lib/wallets/supported-coins';
import { configureManualMethod } from '@/lib/payment-methods/policy';
import type { Capability } from '@/lib/auth/permissions';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * The capability argument is not optional here.
 *
 * `verifyBusinessAccess` defaults to `business.read`, which every team member
 * has including `readonly`. Calling it with no capability therefore gated the
 * WRITE below at read level: a read-only member could rewrite the Venmo, Cash
 * App or Zelle handle that customers are told to pay. That is a funds
 * destination, and the project's own invariant is that moving funds is
 * owner-only — so the write asks for `funds.move`, the owner-only capability,
 * rather than a management one.
 */
async function authorize(
  supabase: ReturnType<typeof getSupabase>,
  request: NextRequest,
  businessId: string,
  capability: Capability,
) {
  const authResult = await resolveMerchant(supabase, request);
  if ('error' in authResult) return { error: authResult.error, status: authResult.status } as const;

  // A key issued for one business must not act on another, even within the same
  // merchant account: `verifyBusinessAccess` checks the MERCHANT's access, which
  // a scoped key passes for every business its owner has.
  if (!keyMayActOnBusiness(authResult, businessId)) {
    return { error: 'This API key cannot act on that business', status: 403 } as const;
  }

  const access = await verifyBusinessAccess(supabase, businessId, authResult.merchantId, capability);
  if (!access.ok) return { error: access.error, status: access.status ?? 404 } as const;
  return { ok: true } as const;
}

/**
 * GET /api/businesses/[id]/payment-methods/manual
 * The 3rd-party manual methods (Venmo/Cash App/Zelle) and this business's setup
 * for each (handle + enabled). Everything is OFF until a handle is saved.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = getSupabase();
  try {
    const { id } = await params;
    const auth = await authorize(supabase, request, id, 'business.read');
    if ('error' in auth) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

    const [{ data: catalog }, { data: settings }] = await Promise.all([
      supabase
        .from('payment_method_catalog')
        .select('method_id, display_name, sort_order')
        .eq('integration_type', 'manual')
        .eq('published', true)
        .eq('force_disabled', false)
        .order('sort_order'),
      supabase
        .from('merchant_payment_settings')
        .select('method_id, enabled, config')
        .eq('business_id', id),
    ]);

    const byMethod = new Map((settings || []).map((s) => [s.method_id, s]));
    const methods = (catalog || []).map((m) => {
      const s = byMethod.get(m.method_id);
      const config = (s?.config || {}) as { handle?: string; instructions?: string };
      return {
        method_id: m.method_id,
        display_name: m.display_name,
        enabled: !!s?.enabled,
        handle: config.handle || '',
        instructions: config.instructions || '',
      };
    });

    return NextResponse.json({ success: true, methods });
  } catch (error) {
    console.error('Manual methods GET error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/businesses/[id]/payment-methods/manual
 * Body: { method_id, handle?, instructions?, enabled }
 * Saves the merchant's handle and turns the method on/off. Enabling requires a handle.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = getSupabase();
  try {
    const { id } = await params;
    const auth = await authorize(supabase, request, id, 'funds.move');
    if ('error' in auth) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

    const body = await request.json();
    const methodId = body.method_id || body.methodId;
    if (!methodId) return NextResponse.json({ success: false, error: 'method_id is required' }, { status: 400 });

    const result = await configureManualMethod(supabase, id, methodId, {
      handle: body.handle,
      instructions: body.instructions,
      enabled: body.enabled !== false,
    });
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status ?? 400 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Manual methods POST error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
