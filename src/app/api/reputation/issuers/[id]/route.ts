/**
 * Platform Issuer Management — Single Issuer
 * DELETE /api/reputation/issuers/[id] — Deactivate an issuer
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await authenticateRequest(supabase, request.headers.get('authorization'));
    if (!authResult.success || !authResult.context) {
      return NextResponse.json({ success: false, error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    if (!isMerchantAuth(authResult.context)) {
      return NextResponse.json({ success: false, error: 'Merchant authentication required' }, { status: 403 });
    }

    const { data, error } = await supabase
      .from('reputation_issuers')
      .update({ active: false })
      .eq('id', id)
      .eq('merchant_id', authResult.context.merchantId)
      .select('id, did, name, domain, active')
      .single();

    if (error || !data) {
      return NextResponse.json({ success: false, error: 'Issuer not found or not owned by you' }, { status: 404 });
    }

    return NextResponse.json({ success: true, issuer: data });
  } catch (error) {
    console.error('[issuers] Delete error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
