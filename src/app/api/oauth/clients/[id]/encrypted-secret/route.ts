/**
 * Owner-only endpoints for storing and retrieving the client-side-encrypted
 * copy of an OAuth client's secret. The browser does the encryption (with a
 * user passphrase via WebCrypto PBKDF2 + AES-256-GCM), so the server only
 * ever stores opaque ciphertext.
 *
 * The plaintext is still hashed at creation time and held in
 * `oauth_clients.client_secret` for OAuth token verification — that part is
 * unchanged. This column is purely a convenience so the owner doesn't have
 * to recreate the client when they lose the secret.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthUser } from '@/lib/oauth/auth';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// "v1:<base64 salt>:<base64 iv>:<base64 ciphertext>". We don't try to decrypt
// it server-side; we just sanity-check the structure so we don't accept
// arbitrary blobs that would then break the reveal UI.
const CIPHERTEXT_PATTERN = /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;
const CIPHERTEXT_MAX_LENGTH = 4096;

async function loadOwnedClient(id: string, ownerId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('oauth_clients')
    .select('id, owner_id, client_secret_encrypted')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  if (data.owner_id !== ownerId) return null;
  return data;
}

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteCtx) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }
  const { id } = await params;

  const client = await loadOwnedClient(id, user.id);
  if (!client) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({
    success: true,
    has_encrypted_secret: !!client.client_secret_encrypted,
    encrypted_secret: client.client_secret_encrypted ?? null,
  });
}

export async function PUT(request: NextRequest, { params }: RouteCtx) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }
  const { id } = await params;

  let body: { encrypted_secret?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const ciphertext = body.encrypted_secret;
  if (ciphertext !== null && typeof ciphertext !== 'string') {
    return NextResponse.json(
      { success: false, error: 'encrypted_secret must be a string or null' },
      { status: 400 },
    );
  }
  if (typeof ciphertext === 'string') {
    if (ciphertext.length > CIPHERTEXT_MAX_LENGTH) {
      return NextResponse.json(
        { success: false, error: 'encrypted_secret is too large' },
        { status: 400 },
      );
    }
    if (!CIPHERTEXT_PATTERN.test(ciphertext)) {
      return NextResponse.json(
        { success: false, error: 'encrypted_secret must look like "v1:<b64>:<b64>:<b64>"' },
        { status: 400 },
      );
    }
  }

  const client = await loadOwnedClient(id, user.id);
  if (!client) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from('oauth_clients')
    .update({ client_secret_encrypted: ciphertext })
    .eq('id', id);
  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to save' }, { status: 500 });
  }
  return NextResponse.json({ success: true, has_encrypted_secret: ciphertext !== null });
}

export async function DELETE(request: NextRequest, { params }: RouteCtx) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }
  const { id } = await params;

  const client = await loadOwnedClient(id, user.id);
  if (!client) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from('oauth_clients')
    .update({ client_secret_encrypted: null })
    .eq('id', id);
  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to clear' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
