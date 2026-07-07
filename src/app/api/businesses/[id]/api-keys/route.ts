import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { authorizeBusinessOwner } from '@/lib/auth/authz';
import { getJwtSecret } from '@/lib/secrets';
import { createScopedApiKey, listScopedApiKeys, API_SCOPES } from '@/lib/auth/scoped-keys';

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
 * GET /api/businesses/[id]/api-keys
 * List scoped API keys (metadata only — never the raw key).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await verifyAuth(request);
    if (auth.error) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const supabase = createSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const authz = await authorizeBusinessOwner(supabase, auth.merchantId!, id, 'apikey.manage');
    if (!authz.ok) {
      return NextResponse.json({ success: false, error: authz.error }, { status: authz.status });
    }

    const result = await listScopedApiKeys(supabase, id);
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, keys: result.keys }, { status: 200 });
  } catch (error) {
    console.error('List API keys error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/businesses/[id]/api-keys
 * Mint a new scoped API key. Returns the raw key ONCE.
 * Body: { name: string, scopes: string[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await verifyAuth(request);
    if (auth.error) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const supabase = createSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const authz = await authorizeBusinessOwner(supabase, auth.merchantId!, id, 'apikey.manage');
    if (!authz.ok) {
      return NextResponse.json({ success: false, error: authz.error }, { status: authz.status });
    }

    let body: { name?: string; scopes?: string[] };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const result = await createScopedApiKey(supabase, id, {
      name: body.name ?? '',
      scopes: body.scopes ?? [],
      createdBy: authz.ownerId,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error, validScopes: API_SCOPES },
        { status: 400 }
      );
    }

    // Raw key is returned exactly once — the client must store it now.
    return NextResponse.json(
      { success: true, apiKey: result.apiKey, key: result.record },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create API key error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
