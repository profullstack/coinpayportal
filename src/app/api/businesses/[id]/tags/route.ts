import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getBusinessTags, mutateBusinessTags } from '@/lib/business/service';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import { authorizeBusiness } from '@/lib/auth/authz';

function createSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;
  return createClient(supabaseUrl, supabaseKey);
}

function verifyAuth(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing authorization header', status: 401 as const };
  }

  const jwtSecret = getJwtSecret();
  if (!jwtSecret) {
    return { error: 'Server configuration error', status: 500 as const };
  }

  try {
    const decoded = verifyToken(authHeader.substring(7), jwtSecret);
    return { merchantId: decoded.userId };
  } catch {
    return { error: 'Invalid or expired token', status: 401 as const };
  }
}

/**
 * Shared setup: authenticate, then check the caller may act on this business.
 * Reads need `business.read`, writes need `business.update`.
 */
async function setup(request: NextRequest, businessId: string, permission: 'business.read' | 'business.update') {
  const auth = verifyAuth(request);
  if ('error' in auth) {
    return { response: NextResponse.json({ success: false, error: auth.error }, { status: auth.status }) };
  }

  const supabase = createSupabaseClient();
  if (!supabase) {
    return {
      response: NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 }),
    };
  }

  const authz = await authorizeBusiness(supabase, auth.merchantId!, businessId, permission);
  if (!authz.ok) {
    return { response: NextResponse.json({ success: false, error: authz.error }, { status: authz.status }) };
  }

  return { supabase };
}

/** Accept either `{ tags: [...] }` or a single `{ tag: "iptv" }`. */
function tagsFromBody(body: any): string[] {
  if (Array.isArray(body?.tags)) return body.tags;
  if (typeof body?.tag === 'string') return [body.tag];
  return [];
}

/**
 * GET /api/businesses/[id]/tags — list the keyword tags.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await setup(request, id, 'business.read');
  if (ctx.response) return ctx.response;

  const result = await getBusinessTags(ctx.supabase!, id);
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 404 });
  }
  return NextResponse.json({ success: true, tags: result.tags });
}

/**
 * POST /api/businesses/[id]/tags — add tags, keeping the existing ones.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await setup(request, id, 'business.update');
  if (ctx.response) return ctx.response;

  const body = await request.json().catch(() => ({}));
  const tags = tagsFromBody(body);
  if (tags.length === 0) {
    return NextResponse.json({ success: false, error: 'Provide tag or tags' }, { status: 400 });
  }

  const result = await mutateBusinessTags(ctx.supabase!, id, 'add', tags);
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ success: true, tags: result.tags, classification: result.classification });
}

/**
 * PUT /api/businesses/[id]/tags — replace the whole set.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await setup(request, id, 'business.update');
  if (ctx.response) return ctx.response;

  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body?.tags)) {
    return NextResponse.json({ success: false, error: 'tags must be an array' }, { status: 400 });
  }

  const result = await mutateBusinessTags(ctx.supabase!, id, 'replace', body.tags);
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ success: true, tags: result.tags, classification: result.classification });
}

/**
 * DELETE /api/businesses/[id]/tags?tag=iptv — remove one or more tags.
 * Also accepts a JSON body for removing several at once.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await setup(request, id, 'business.update');
  if (ctx.response) return ctx.response;

  const queryTags = request.nextUrl.searchParams.getAll('tag');
  const body = queryTags.length > 0 ? {} : await request.json().catch(() => ({}));
  const tags = queryTags.length > 0 ? queryTags : tagsFromBody(body);

  if (tags.length === 0) {
    return NextResponse.json({ success: false, error: 'Provide tag or tags' }, { status: 400 });
  }

  const result = await mutateBusinessTags(ctx.supabase!, id, 'remove', tags);
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ success: true, tags: result.tags, classification: result.classification });
}
