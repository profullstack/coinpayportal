/**
 * POST /api/auth/passphrase/login-options  { email }
 * Returns the salt + KDF params the browser needs to rebuild the key, and a
 * one-time challenge to sign. Public. Answers identically for an unknown email
 * or an account without a passphrase (decoy salt), so it is not an
 * enumeration oracle.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getClientIp } from '@/lib/web-wallet/client-ip';
import { isValidKdf } from '@/lib/passphrase';
import { DECOY_KDF, decoySalt, issueChallenge } from '@/lib/passphrase/server';

const schema = z.object({ email: z.string().email().max(320) });

export async function POST(request: NextRequest) {
  const rate = await checkRateLimitAsync(getClientIp(request) || 'unknown', 'passphrase_options');
  if (!rate.allowed) {
    return NextResponse.json({ success: false, error: 'Too many attempts. Please try again shortly.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'A valid email is required' }, { status: 400 });
  }
  const email = parsed.data.email.trim().toLowerCase();

  let salt = decoySalt(email);
  let kdf: unknown = DECOY_KDF;

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: merchant } = await supabase.from('merchants').select('id').eq('email', email).maybeSingle();
  if (merchant) {
    const { data: cred } = await supabase
      .from('passphrase_credentials')
      .select('salt, kdf')
      .eq('merchant_id', merchant.id)
      .maybeSingle();
    if (cred && isValidKdf(cred.kdf)) {
      salt = cred.salt;
      kdf = cred.kdf;
    }
  }

  const { challengeKey, challenge } = issueChallenge(email);
  return NextResponse.json({ success: true, salt, kdf, challenge, challengeKey });
}
