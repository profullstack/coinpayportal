/**
 * Rotate Platform Issuer API Key
 * POST /api/reputation/issuers/[id]/rotate
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(
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

    // Get current issuer to get the name for key generation
    const { data: issuer, error: fetchError } = await supabase
      .from('reputation_issuers')
      .select('id, name, merchant_id')
      .eq('id', id)
      .eq('merchant_id', authResult.context.merchantId)
      .single();

    if (fetchError || !issuer) {
      return NextResponse.json({ success: false, error: 'Issuer not found or not owned by you' }, { status: 404 });
    }

    const newApiKey = `cprt_${issuer.name}_${randomBytes(24).toString('hex')}`;

    const { data, error } = await supabase
      .from('reputation_issuers')
      .update({ api_key: newApiKey })
      .eq('id', id)
      .select('id, did, name, domain, active, created_at')
      .single();

    if (error) {
      console.error('[issuers] Rotate error:', error);
      return NextResponse.json({ success: false, error: 'Failed to rotate API key' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      issuer: data,
      api_key: newApiKey, // Only shown once
    });
  } catch (error) {
    console.error('[issuers] Rotate error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
