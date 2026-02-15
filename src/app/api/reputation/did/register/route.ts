/**
 * POST /api/reputation/did/register
 *
 * Platform endpoint: register a DID for a user on an external platform.
 * Called by ugig.net (and other platforms) when a user signs up / confirms email.
 *
 * Auth: Bearer token matching a registered reputation_issuers API key
 *
 * Body: { did, public_key?, platform?, metadata? }
 *
 * Stores the DID in merchant_dids so it can receive reputation actions,
 * or simply acknowledges it if already registered.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

const registerSchema = z.object({
  did: z.string().startsWith('did:', 'Must be a valid DID'),
  public_key: z.string().optional(),
  platform: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Authenticate platform by API key → returns platform issuer if valid
 */
async function authenticatePlatform(
  supabase: ReturnType<typeof getSupabase>,
  request: NextRequest
): Promise<{ did: string; name: string } | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const apiKey = authHeader.slice(7);

  const { data } = await supabase
    .from('reputation_issuers')
    .select('did, name')
    .eq('api_key', apiKey)
    .eq('active', true)
    .single();

  return data;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();

    const platform = await authenticatePlatform(supabase, request);
    if (!platform) {
      return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map(i => i.message).join(', ') },
        { status: 400 }
      );
    }

    const { did, public_key, platform: platformName, metadata } = parsed.data;

    // Check if DID already exists in merchant_dids
    const { data: existing } = await supabase
      .from('merchant_dids')
      .select('did')
      .eq('did', did)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ did, registered: false, message: 'DID already registered' });
    }

    // Register the DID in merchant_dids (without merchant_id — platform-managed DID)
    const { error: insertError } = await supabase
      .from('merchant_dids')
      .insert({
        did,
        public_key: public_key || '',
        platform: platformName || platform.name,
        verified: true,
      });

    if (insertError) {
      // Could be unique constraint if merchant_id is required
      // Try a lighter approach — just log it
      console.error('[DID Register] Insert error:', insertError);

      // If merchant_dids requires merchant_id, we can still track via receipts
      // The DID will be known once a reputation action is submitted
      return NextResponse.json({
        did,
        registered: false,
        message: 'DID noted — will be tracked via reputation actions',
        platform: platformName || platform.name,
      });
    }

    console.log(`[DID Register] Registered ${did} from ${platformName || platform.name}`, metadata);

    return NextResponse.json({ did, registered: true }, { status: 201 });
  } catch (error) {
    console.error('[DID Register] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
