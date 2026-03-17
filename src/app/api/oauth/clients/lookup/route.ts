/**
 * Public OAuth2 Client Lookup
 * GET /api/oauth/clients/lookup?client_id=...
 * Returns public client info (name, description, scopes) — no secrets.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id');

  if (!clientId) {
    return NextResponse.json(
      { error: 'client_id query parameter is required' },
      { status: 400 }
    );
  }

  const supabase = getSupabase();
  const { data: client, error } = await supabase
    .from('oauth_clients')
    .select('name, description, scopes')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .single();

  if (error || !client) {
    return NextResponse.json(
      { error: 'Client not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    name: client.name,
    description: client.description,
    scopes: client.scopes,
  });
}
