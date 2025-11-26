import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getWebhookLogs } from '@/lib/webhooks/service';
import { verifySession } from '@/lib/auth/service';

/**
 * GET /api/webhooks
 * Get webhook logs for the authenticated merchant's businesses
 */
export async function GET(request: NextRequest) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing or invalid authorization header',
        },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);

    // Create Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error',
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify session
    const sessionResult = await verifySession(supabase, token);
    if (!sessionResult.success || !sessionResult.merchant) {
      return NextResponse.json(
        {
          success: false,
          error: sessionResult.error || 'Authentication failed',
        },
        { status: 401 }
      );
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const paymentId = searchParams.get('payment_id');
    const limit = searchParams.get('limit');
    const offset = searchParams.get('offset');

    if (!businessId) {
      return NextResponse.json(
        {
          success: false,
          error: 'business_id is required',
        },
        { status: 400 }
      );
    }

    // Verify the business belongs to the merchant
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .eq('merchant_id', sessionResult.merchant.id)
      .single();

    if (businessError || !business) {
      return NextResponse.json(
        {
          success: false,
          error: 'Business not found or access denied',
        },
        { status: 404 }
      );
    }

    // Get webhook logs
    const result = await getWebhookLogs(supabase, businessId, {
      payment_id: paymentId || undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        logs: result.logs,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Webhook logs error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}