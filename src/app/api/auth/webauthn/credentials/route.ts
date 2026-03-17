/**
 * WebAuthn Credential Management
 * GET    — list user's passkeys
 * DELETE — remove a passkey by id
 * PATCH  — rename a passkey
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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

  const { data: credentials, error } = await supabase
    .from('webauthn_credentials')
    .select('id, name, device_type, transports, created_at, last_used_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch credentials' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, credentials });
}

export async function DELETE(request: NextRequest) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json(
      { success: false, error: 'Missing credential id' },
      { status: 400 }
    );
  }

  const supabase = getSupabase();

  const { error } = await supabase
    .from('webauthn_credentials')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to delete credential' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest) {
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

  const { id, name } = body;
  if (!id || !name) {
    return NextResponse.json(
      { success: false, error: 'Missing id or name' },
      { status: 400 }
    );
  }

  const supabase = getSupabase();

  const { data: credential, error } = await supabase
    .from('webauthn_credentials')
    .update({ name })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, name, device_type, transports, created_at, last_used_at')
    .single();

  if (error || !credential) {
    return NextResponse.json(
      { success: false, error: 'Failed to update credential' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, credential });
}
