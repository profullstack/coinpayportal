import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifySession } from '@/lib/auth/service';
import { listBusinesses, regenerateApiKey } from '@/lib/business/service';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;
  return createClient(url, key);
}

async function resolveMerchantAndBusiness(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing authorization header', status: 401 as const };
  }

  const token = authHeader.substring(7);
  const supabase = getSupabase();
  if (!supabase) {
    return { error: 'Server configuration error', status: 500 as const };
  }

  const session = await verifySession(supabase, token);
  if (!session.success || !session.merchant) {
    return { error: session.error || 'Unauthorized', status: 401 as const };
  }

  const businessesResult = await listBusinesses(supabase, session.merchant.id);
  if (!businessesResult.success) {
    return { error: businessesResult.error || 'Failed to load businesses', status: 400 as const };
  }

  const businesses = businessesResult.businesses || [];
  if (businesses.length === 0) {
    return { error: 'No business found. Create a business first at POST /api/businesses', status: 404 as const };
  }

  const { searchParams } = new URL(request.url);
  const requestedBusinessId = searchParams.get('business_id');
  const business = requestedBusinessId
    ? businesses.find((b) => b.id === requestedBusinessId)
    : businesses[0];

  if (!business) {
    return { error: 'Business not found', status: 404 as const };
  }

  return { supabase, merchant: session.merchant, business };
}

/**
 * GET /api/merchant/api-key
 * Returns API key information for the merchant's business.
 */
export async function GET(request: NextRequest) {
  try {
    const resolved = await resolveMerchantAndBusiness(request);
    if ('error' in resolved) {
      return NextResponse.json(
        { success: false, error: resolved.error },
        { status: resolved.status }
      );
    }

    return NextResponse.json({
      success: true,
      business: {
        id: resolved.business.id,
        name: resolved.business.name,
      },
      apiKey: resolved.business.api_key || null,
      apiKeyCreatedAt: resolved.business.api_key_created_at || null,
    });
  } catch (error) {
    console.error('Merchant api-key GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/merchant/api-key
 * Regenerates API key for a merchant business.
 */
export async function POST(request: NextRequest) {
  try {
    const resolved = await resolveMerchantAndBusiness(request);
    if ('error' in resolved) {
      return NextResponse.json(
        { success: false, error: resolved.error },
        { status: resolved.status }
      );
    }

    const result = await regenerateApiKey(
      resolved.supabase,
      resolved.business.id,
      resolved.merchant.id
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to regenerate API key' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      business: {
        id: resolved.business.id,
        name: resolved.business.name,
      },
      apiKey: result.apiKey,
    });
  } catch (error) {
    console.error('Merchant api-key POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
