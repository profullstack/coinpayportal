/**
 * OAuth2 Client Management — single client
 * GET    — get client details
 * PATCH  — update client
 * DELETE — delete client
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getAuthUser(request: NextRequest): { id: string } | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    const decoded = verifyToken(token, secret);
    if (decoded?.userId) return { id: decoded.userId };
  } catch {
    // invalid
  }

  return null;
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 }
    );
  }

  const { id } = await context.params;
  const supabase = getSupabase();

  const { data: client, error } = await supabase
    .from('oauth_clients')
    .select('*')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single();

  if (error || !client) {
    return NextResponse.json(
      { success: false, error: 'Client not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, client });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 }
    );
  }

  const { id } = await context.params;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const allowedFields = ['name', 'description', 'redirect_uris', 'scopes', 'is_active'];
  const updates: Record<string, any> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }
  updates.updated_at = new Date().toISOString();

  const supabase = getSupabase();

  const { data: client, error } = await supabase
    .from('oauth_clients')
    .update(updates)
    .eq('id', id)
    .eq('owner_id', user.id)
    .select('*')
    .single();

  if (error || !client) {
    return NextResponse.json(
      { success: false, error: 'Client not found or update failed' },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, client });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 }
    );
  }

  const { id } = await context.params;
  const supabase = getSupabase();

  const { error } = await supabase
    .from('oauth_clients')
    .delete()
    .eq('id', id)
    .eq('owner_id', user.id);

  if (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to delete client' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
