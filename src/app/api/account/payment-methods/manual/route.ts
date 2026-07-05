import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';
import { getAccountManualDefaults, setAccountManualDefault } from '@/lib/payment-methods/account-defaults';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * GET /api/account/payment-methods/manual
 * The merchant's account-level (global) manual-method handles.
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const authResult = await resolveMerchant(supabase, request);
    if ('error' in authResult) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }
    const methods = await getAccountManualDefaults(supabase, authResult.merchantId);
    return NextResponse.json({ success: true, methods });
  } catch (error) {
    console.error('Account manual defaults GET error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/account/payment-methods/manual
 * Body: { method_id, handle?, instructions? } — save a global default handle.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const authResult = await resolveMerchant(supabase, request);
    if ('error' in authResult) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }
    const body = await request.json();
    const methodId = body.method_id || body.methodId;
    if (!methodId) return NextResponse.json({ success: false, error: 'method_id is required' }, { status: 400 });

    const result = await setAccountManualDefault(supabase, authResult.merchantId, methodId, {
      handle: body.handle,
      instructions: body.instructions,
    });
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status ?? 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Account manual defaults POST error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
