import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifySession } from '@/lib/auth/service';
import { listBusinesses } from '@/lib/business/service';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * GET /api/merchant/profile
 * Backward-compatible merchant profile endpoint used by older SDK/docs.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const supabase = getSupabase();

    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const session = await verifySession(supabase, token);
    if (!session.success || !session.merchant) {
      return NextResponse.json(
        { success: false, error: session.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const businesses = await listBusinesses(supabase, session.merchant.id);

    return NextResponse.json({
      success: true,
      merchant: session.merchant,
      businesses: businesses.success ? businesses.businesses || [] : [],
    });
  } catch (error) {
    console.error('Merchant profile error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
