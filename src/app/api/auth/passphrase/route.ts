/**
 * Manage the signed-in merchant's passphrase.
 *   GET    → { enabled, created_at, last_used_at, source }
 *   POST   { password, publicKey, salt, kdf, source } → set or replace
 *   DELETE { password } → remove
 *
 * Changing a sign-in method needs the current password: getAuthUser also
 * accepts API keys and bearer tokens, and none of those should be able to
 * mint themselves a permanent login.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getAuthUser } from '@/lib/oauth/auth';
import { verifyPassword } from '@/lib/crypto/encryption';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { isAcceptablePublicKey, isValidKdf } from '@/lib/passphrase';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const setSchema = z.object({
  password: z.string().min(1).max(1024),
  publicKey: z.string().regex(/^[0-9a-f]{64}$/),
  salt: z.string().regex(/^[0-9a-f]{32}$/),
  kdf: z.unknown(),
  source: z.enum(['generated', 'custom']).default('generated'),
});
const deleteSchema = z.object({ password: z.string().min(1).max(1024) });

async function checkPassword(merchantId: string, password: string): Promise<NextResponse | null> {
  const rate = await checkRateLimitAsync(`passphrase-pw:${merchantId}`, 'merchant_login_email');
  if (!rate.allowed) {
    return NextResponse.json({ success: false, error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }
  const { data: merchant } = await getSupabase().from('merchants').select('password_hash').eq('id', merchantId).maybeSingle();
  if (!merchant?.password_hash || !(await verifyPassword(password, merchant.password_hash))) {
    return NextResponse.json({ success: false, error: 'Current password is wrong' }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  // Keys allowed here only because every write below needs the account password.
  const user = await getAuthUser(request, { allowApiKey: true });
  if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  const { data } = await getSupabase()
    .from('passphrase_credentials')
    .select('created_at, last_used_at, source')
    .eq('merchant_id', user.id)
    .maybeSingle();
  return NextResponse.json({ success: true, enabled: !!data, ...(data || {}) });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request, { allowApiKey: true });
  if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = setSchema.safeParse(body);
  if (!parsed.success || !isValidKdf(parsed.data.kdf) || !isAcceptablePublicKey(parsed.data.publicKey)) {
    return NextResponse.json({ success: false, error: 'Invalid passphrase key' }, { status: 400 });
  }

  const denied = await checkPassword(user.id, parsed.data.password);
  if (denied) return denied;

  const { error } = await getSupabase()
    .from('passphrase_credentials')
    .upsert(
      {
        merchant_id: user.id,
        public_key: parsed.data.publicKey,
        salt: parsed.data.salt,
        kdf: parsed.data.kdf,
        source: parsed.data.source,
        created_at: new Date().toISOString(),
        last_used_at: null,
      },
      { onConflict: 'merchant_id' }
    );
  if (error) {
    console.error('[Passphrase] save failed:', error.message);
    return NextResponse.json({ success: false, error: 'Could not save the passphrase' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const user = await getAuthUser(request, { allowApiKey: true });
  if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Current password is required' }, { status: 400 });

  const denied = await checkPassword(user.id, parsed.data.password);
  if (denied) return denied;

  await getSupabase().from('passphrase_credentials').delete().eq('merchant_id', user.id);
  return NextResponse.json({ success: true });
}
