import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createBusiness, listAccessibleBusinesses } from '@/lib/business/service';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import { withoutApiKeyForOAuth, type AuthVia } from '@/lib/auth/oauth-funds';

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
): Promise<{
  merchantId?: string;
  via?: AuthVia;
  /** Set when a business API key authenticated: the key's own business. */
  businessId?: string;
  /** That key's scopes ('*' for a legacy single key). */
  scopes?: string[];
  error?: string;
}> {
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
        return { merchantId: authResult.context.merchantId, via: authResult.context.via ?? 'session' };
      }
      // API key auth — get merchant_id from the business that owns this key
      if ('businessId' in authResult.context) {
        const { data: business } = await supabase
          .from('businesses')
          .select('merchant_id')
          .eq('id', (authResult.context as any).businessId)
          .single();
        if (business?.merchant_id) {
          return {
            merchantId: business.merchant_id,
            via: 'api_key',
            businessId: (authResult.context as any).businessId,
            scopes: (authResult.context as any).scopes ?? [],
          };
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

/** Never hand a business's credentials to a caller holding only an API key. */
function withoutSecrets<T extends Record<string, unknown>>(b: T): T {
  const { api_key: _k, webhook_secret: _w, ...rest } = b as any;
  return rest as T;
}

/**
 * GET /api/businesses
 * List all businesses for authenticated merchant
 * Supports: JWT (dashboard) or API key (AI agents)
 *
 * A business API key sees ONLY its own business, without api_key or
 * webhook_secret. It used to be widened to its merchant and list every
 * business with their keys, so one site's x402 key (payments scopes) could
 * read every other business's credentials.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const { merchantId, via, businessId, error: authError } = await getMerchantId(request, supabase);

    if (!merchantId) {
      return NextResponse.json(
        { success: false, error: authError || 'Unauthorized' },
        { status: 401 }
      );
    }

    if (via === 'api_key' && businessId) {
      const { data: own, error: ownError } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', businessId)
        .single();
      if (ownError || !own) {
        return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });
      }
      return NextResponse.json(
        { success: true, businesses: [withoutSecrets(own as Record<string, unknown>)] },
        { status: 200 }
      );
    }

    // Search and facets: ?search=&tag=iptv&tag=streaming&category=&risk=&review=
    const params = request.nextUrl.searchParams;
    const result = await listAccessibleBusinesses(supabase, merchantId, {
      search: params.get('search'),
      tags: params.getAll('tag'),
      category: params.get('category'),
      riskLevel: params.get('risk'),
      reviewStatus: params.get('review'),
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json(
      // An app signed in with CoinPay never sees a business API key: the key
      // can send payouts, which such an app may not.
      { success: true, businesses: (result.businesses ?? []).map((b) => withoutApiKeyForOAuth(b, { via })) },
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
    const { merchantId, via, scopes, error: authError } = await getMerchantId(request, supabase);

    if (!merchantId) {
      return NextResponse.json(
        { success: false, error: authError || 'Unauthorized' },
        { status: 401 }
      );
    }

    // A scoped key (payments, webhooks, ...) may not create businesses for its
    // merchant. Legacy all-scope keys keep the agent onboarding flow.
    if (via === 'api_key' && !(scopes ?? []).includes('*')) {
      return NextResponse.json(
        { success: false, error: 'API key may not create businesses' },
        { status: 403 }
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
      { success: true, business: withoutApiKeyForOAuth(result.business, { via }), classification: result.classification },
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
