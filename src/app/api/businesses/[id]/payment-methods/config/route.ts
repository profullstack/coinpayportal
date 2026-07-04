import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';
import { verifyBusinessAccess } from '@/lib/wallets/supported-coins';
import { resolveEffectivePaymentMethods } from '@/lib/payment-methods/resolver';
import { setMerchantMethodSetting } from '@/lib/payment-methods/policy';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * GET /api/businesses/[id]/payment-methods/config
 * Merchant-facing view of the W5 cascade for a business: the platform catalog,
 * this business's unlock policy, its store settings, and the resolved effective
 * set. Powers the store's payment-methods settings screen.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabase();
  try {
    const { id } = await params;
    const authResult = await resolveMerchant(supabase, request);
    if ('error' in authResult) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }
    const access = await verifyBusinessAccess(supabase, id, authResult.merchantId);
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status ?? 404 });
    }

    const [{ data: catalog }, { data: policy }, { data: settings }, effective] = await Promise.all([
      supabase
        .from('payment_method_catalog')
        .select('method_id, display_name, integration_type, published, force_disabled, sort_order')
        .order('sort_order'),
      supabase.from('business_payment_policy').select('method_id, status, entity_params').eq('business_id', id),
      supabase
        .from('merchant_payment_settings')
        .select('method_id, enabled, min_order_value, max_order_value, currency_allowlist, display_order')
        .eq('business_id', id),
      resolveEffectivePaymentMethods(supabase, id, { skipCache: true }),
    ]);

    // Only surface methods the platform has actually published.
    const published = (catalog || []).filter((m) => m.published && !m.force_disabled);

    return NextResponse.json({
      success: true,
      catalog: published,
      policy: policy || [],
      settings: settings || [],
      effective,
    });
  } catch (error) {
    console.error('Payment methods config GET error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/businesses/[id]/payment-methods/config
 * Update a single store setting (enable/caps/display). Enabling a method the
 * business hasn't unlocked is rejected (restrict-only).
 * Body: { method_id, enabled?, min_order_value?, max_order_value?, currency_allowlist?, display_order? }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabase();
  try {
    const { id } = await params;
    const authResult = await resolveMerchant(supabase, request);
    if ('error' in authResult) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }
    const access = await verifyBusinessAccess(supabase, id, authResult.merchantId);
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status ?? 404 });
    }

    const body = await request.json();
    const methodId = body.method_id || body.methodId;
    if (!methodId) {
      return NextResponse.json({ success: false, error: 'method_id is required' }, { status: 400 });
    }

    const result = await setMerchantMethodSetting(supabase, id, methodId, {
      enabled: body.enabled,
      minOrderValue: body.min_order_value ?? body.minOrderValue,
      maxOrderValue: body.max_order_value ?? body.maxOrderValue,
      currencyAllowlist: body.currency_allowlist ?? body.currencyAllowlist,
      displayOrder: body.display_order ?? body.displayOrder,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status ?? 400 });
    }

    const effective = await resolveEffectivePaymentMethods(supabase, id, { skipCache: true });
    return NextResponse.json({ success: true, effective });
  } catch (error) {
    console.error('Payment methods config PUT error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
