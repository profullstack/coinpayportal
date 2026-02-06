import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createBusiness, listBusinesses } from '@/lib/business/service';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/**
 * Extract merchant ID from auth header (JWT or API key)
 */
async function getMerchantId(
  request: NextRequest,
  supabase: ReturnType<typeof getSupabase>
): Promise<{ merchantId?: string; error?: string }> {
  const authHeader = request.headers.get('authorization');
  const apiKeyHeader = request.headers.get('x-api-key');
  const token = authHeader || (apiKeyHeader ? `Bearer ${apiKeyHeader}` : null);

  if (!token) {
    return { error: 'Missing authorization header' };
  }

  // Try the unified auth middleware first (handles both JWT and API keys)
  try {
    const authResult = await authenticateRequest(supabase, token);
    if (authResult.success && authResult.context) {
      if (isMerchantAuth(authResult.context)) {
        return { merchantId: authResult.context.merchantId };
      }
      // API key auth — get merchant_id from the business that owns this key
      if ('businessId' in authResult.context) {
        const { data: business } = await supabase
          .from('businesses')
          .select('merchant_id')
          .eq('id', (authResult.context as any).businessId)
          .single();
        if (business?.merchant_id) {
          return { merchantId: business.merchant_id };
        }
      }
    }
  } catch {
    // Fall through to legacy JWT check
  }

  // Legacy JWT auth (dashboard cookies)
  if (authHeader?.startsWith('Bearer ')) {
    const jwtToken = authHeader.substring(7);
    const jwtSecret = getJwtSecret();
    if (jwtSecret) {
      try {
        const decoded = verifyToken(jwtToken, jwtSecret);
        return { merchantId: decoded.userId };
      } catch {
        // Invalid JWT
      }
    }
  }

  return { error: 'Invalid or expired credentials' };
}

/**
 * GET /api/businesses
 * List all businesses for authenticated merchant
 * Supports: JWT (dashboard) or API key (AI agents)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const { merchantId, error: authError } = await getMerchantId(request, supabase);

    if (!merchantId) {
      return NextResponse.json(
        { success: false, error: authError || 'Unauthorized' },
        { status: 401 }
      );
    }

    const result = await listBusinesses(supabase, merchantId);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: true, businesses: result.businesses },
      { status: 200 }
    );
  } catch (error) {
    console.error('List businesses error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/businesses
 * Create a new business
 * Supports: JWT (dashboard) or API key (AI agents)
 * 
 * Body: { name: string, description?: string, webhook_url?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const { merchantId, error: authError } = await getMerchantId(request, supabase);

    if (!merchantId) {
      return NextResponse.json(
        { success: false, error: authError || 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const result = await createBusiness(supabase, merchantId, body);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: true, business: result.business },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create business error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
