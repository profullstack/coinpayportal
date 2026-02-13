/**
 * Platform Issuer Management API
 * POST /api/reputation/issuers — Register a new platform issuer
 * GET /api/reputation/issuers — List merchant's registered platform issuers
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';
import { z } from 'zod';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const registerSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/, 'Name must be alphanumeric with dots, hyphens, underscores'),
  domain: z.string().min(1).max(255),
  did: z.string().optional(),
});

function generateApiKey(name: string): string {
  const hex = randomBytes(24).toString('hex');
  return `cprt_${name}_${hex}`;
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(supabase, request.headers.get('authorization'));
    if (!authResult.success || !authResult.context) {
      return NextResponse.json({ success: false, error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    if (!isMerchantAuth(authResult.context)) {
      return NextResponse.json({ success: false, error: 'Merchant authentication required' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues.map(i => i.message).join(', ') },
        { status: 400 }
      );
    }

    const { name, domain, did } = parsed.data;
    const resolvedDid = did || `did:web:${domain}`;
    const apiKey = generateApiKey(name);

    const { data, error } = await supabase
      .from('reputation_issuers')
      .insert({
        did: resolvedDid,
        name,
        domain,
        active: true,
        api_key: apiKey,
        merchant_id: authResult.context.merchantId,
      })
      .select('id, did, name, domain, active, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ success: false, error: 'An issuer with this DID or domain already exists' }, { status: 409 });
      }
      console.error('[issuers] Insert error:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      issuer: data,
      api_key: apiKey, // Only shown once
    }, { status: 201 });
  } catch (error) {
    console.error('[issuers] Error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(supabase, request.headers.get('authorization'));
    if (!authResult.success || !authResult.context) {
      return NextResponse.json({ success: false, error: authResult.error || 'Unauthorized' }, { status: 401 });
    }

    if (!isMerchantAuth(authResult.context)) {
      return NextResponse.json({ success: false, error: 'Merchant authentication required' }, { status: 403 });
    }

    const { data, error } = await supabase
      .from('reputation_issuers')
      .select('id, did, name, domain, active, api_key, created_at')
      .eq('merchant_id', authResult.context.merchantId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[issuers] List error:', error);
      return NextResponse.json({ success: false, error: 'Failed to fetch issuers' }, { status: 500 });
    }

    // Mask API keys — show only last 8 chars
    const issuers = (data || []).map(issuer => ({
      ...issuer,
      api_key: issuer.api_key ? `...${issuer.api_key.slice(-8)}` : null,
    }));

    return NextResponse.json({ success: true, issuers });
  } catch (error) {
    console.error('[issuers] Error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
