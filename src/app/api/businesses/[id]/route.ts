import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getBusiness, updateBusiness, deleteBusiness } from '@/lib/business/service';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import { authorizeBusiness } from '@/lib/auth/authz';
import { can } from '@/lib/auth/permissions';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Resolve the owning merchant id for a business (needed for webhook-secret key derivation). */
async function getOwnerId(supabase: SupabaseClient, businessId: string): Promise<string | null> {
  const { data } = await supabase
    .from('businesses')
    .select('merchant_id')
    .eq('id', businessId)
    .maybeSingle();
  return data?.merchant_id ?? null;
}

/**
 * Helper to verify auth and get merchant ID
 */
async function verifyAuth(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing authorization header', status: 401 };
  }

  const token = authHeader.substring(7);
  const jwtSecret = getJwtSecret();
  
  if (!jwtSecret) {
    return { error: 'Server configuration error', status: 500 };
  }

  try {
    const decoded = verifyToken(token, jwtSecret);
    return { merchantId: decoded.userId };
  } catch (error) {
    return { error: 'Invalid or expired token', status: 401 };
  }
}

/**
 * Helper to create Supabase client
 */
function createSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

/**
 * GET /api/businesses/[id]
 * Get a specific business
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await verifyAuth(request);
    if (auth.error) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status }
      );
    }

    const supabase = createSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const authz = await authorizeBusiness(supabase, auth.merchantId!, id, 'business.read');
    if (!authz.ok) {
      return NextResponse.json({ success: false, error: authz.error }, { status: authz.status });
    }

    const ownerId = await getOwnerId(supabase, id);
    const result = await getBusiness(supabase, id, ownerId!);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 404 }
      );
    }

    // Redact secrets from members who cannot manage them (a readonly/writer member
    // must not be able to read the API key or webhook secret).
    const business: any = { ...result.business };
    if (!can(authz.role, 'apikey.manage')) delete business.api_key;
    if (!can(authz.role, 'webhook.manage')) delete business.webhook_secret;

    return NextResponse.json(
      { success: true, business },
      { status: 200 }
    );
  } catch (error) {
    console.error('Get business error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/businesses/[id]
 * Update a business
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await verifyAuth(request);
    if (auth.error) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status }
      );
    }

    const body = await request.json();

    const supabase = createSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const authz = await authorizeBusiness(supabase, auth.merchantId!, id, 'business.update');
    if (!authz.ok) {
      return NextResponse.json({ success: false, error: authz.error }, { status: authz.status });
    }
    const ownerId = await getOwnerId(supabase, id);
    const result = await updateBusiness(supabase, id, ownerId!, body);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: true, business: result.business },
      { status: 200 }
    );
  } catch (error) {
    console.error('Update business error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/businesses/[id]
 * Delete a business
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await verifyAuth(request);
    if (auth.error) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status }
      );
    }

    const supabase = createSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const authz = await authorizeBusiness(supabase, auth.merchantId!, id, 'business.delete');
    if (!authz.ok) {
      return NextResponse.json({ success: false, error: authz.error }, { status: authz.status });
    }
    const ownerId = await getOwnerId(supabase, id);
    const result = await deleteBusiness(supabase, id, ownerId!);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: true },
      { status: 200 }
    );
  } catch (error) {
    console.error('Delete business error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}