/**
 * OAuth2 Client Management
 * GET  — list my clients
 * POST — register a new client
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { hashClientSecret } from '@/lib/oauth/client';
import { getAuthUser } from '@/lib/oauth/auth';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 }
    );
  }

  const supabase = getSupabase();
  const { data: clients, error } = await supabase
    .from('oauth_clients')
    .select('id, client_id, name, description, redirect_uris, scopes, is_active, created_at, updated_at')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch clients' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, clients });
}

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const { name, description, redirect_uris, scopes } = body;

  if (!name || !redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return NextResponse.json(
      { success: false, error: 'name and redirect_uris (non-empty array) are required' },
      { status: 400 }
    );
  }

  // Generate client_id and client_secret at application layer
  const clientId = 'cp_' + randomBytes(12).toString('hex');
  const plaintextSecret = 'cps_' + randomBytes(24).toString('hex');
  const hashedSecret = await hashClientSecret(plaintextSecret);

  const supabase = getSupabase();
  const { data: client, error } = await supabase
    .from('oauth_clients')
    .insert({
      client_id: clientId,
      client_secret: hashedSecret,
      name,
      description: description || null,
      redirect_uris,
      scopes: scopes || ['openid', 'profile', 'email'],
      owner_id: user.id,
    })
    .select('id, client_id, name, description, redirect_uris, scopes, is_active, created_at, updated_at')
    .single();

  if (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to create client' },
      { status: 500 }
    );
  }

  // Return the plaintext secret once — it cannot be retrieved again
  return NextResponse.json(
    {
      success: true,
      client: {
        ...client,
        client_secret: plaintextSecret,
      },
      warning: 'Store the client_secret securely. It will not be shown again.',
    },
    { status: 201 }
  );
}
