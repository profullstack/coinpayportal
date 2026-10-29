/**
 * OAuth2 Client Management — single client
 * GET    — get client details
 * PATCH  — update client
 * DELETE — delete client
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthUser } from '@/lib/oauth/auth';
import { checkRedirectUris, isPublicClient } from '@/lib/oauth/client';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const user = await getAuthUser(request);
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
  const user = await getAuthUser(request);
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

  // New redirect URIs follow the OAuth 2.1 registration rules for this client's
  // type. A pre-2.1 client keeps the redirects it already had.
  if (updates.redirect_uris !== undefined) {
    const { data: existing } = await supabase
      .from('oauth_clients')
      .select('client_secret, token_endpoint_auth_method, redirect_uris, legacy_oauth2')
      .eq('id', id)
      .eq('owner_id', user.id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Client not found or update failed' }, { status: 404 });
    }
    const added = Array.isArray(updates.redirect_uris)
      ? updates.redirect_uris.filter((u: unknown) => !(existing.legacy_oauth2 && (existing.redirect_uris || []).includes(u)))
      : updates.redirect_uris;
    const uriError = Array.isArray(updates.redirect_uris) && updates.redirect_uris.length === 0
      ? 'redirect_uris must be a non-empty array'
      : Array.isArray(added) && added.length === 0
        ? null
        : checkRedirectUris(added, isPublicClient(existing as any));
    if (uriError) return NextResponse.json({ success: false, error: uriError }, { status: 400 });
  }

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
  const user = await getAuthUser(request);
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
