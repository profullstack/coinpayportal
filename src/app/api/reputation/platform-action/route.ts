/**
 * Platform Action Receipt API
 * Lightweight endpoint for external platforms (ugig.net, etc.) to submit
 * non-escrow reputation signals (profile updates, posts, hires, etc.)
 * 
 * Auth: Bearer token matching a registered platform_issuers API key
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { isValidDid, sign } from '@/lib/reputation/crypto';
import { isValidActionCategory } from '@/lib/reputation/trust-engine';
import { z } from 'zod';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const platformActionSchema = z.object({
  agent_did: z.string().refine(isValidDid, 'Invalid agent DID'),
  action_category: z.string().refine(isValidActionCategory as (v: string) => boolean, 'Invalid action_category'),
  action_type: z.string().max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
  value_usd: z.number().min(0).optional(),
});

/**
 * Authenticate platform by API key → returns platform DID if valid
 */
async function authenticatePlatform(request: NextRequest): Promise<{ did: string; name: string } | null> {
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
    // Auth
    const platform = await authenticatePlatform(request);
    if (!platform) {
      return NextResponse.json({ success: false, error: 'Invalid or missing API key' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = platformActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues.map(i => i.message).join(', ') },
        { status: 400 }
      );
    }

    const { agent_did, action_category, action_type, metadata, value_usd } = parsed.data;

    const receiptId = randomUUID();
    const taskId = randomUUID();
    const now = new Date().toISOString();

    // Platform-signed receipt (no escrow signature needed)
    const platformSig = sign(JSON.stringify({
      receipt_id: receiptId,
      agent_did,
      platform_did: platform.did,
      action_category,
      finalized_at: now,
    }));

    const { data: receipt, error } = await supabase
      .from('reputation_receipts')
      .insert({
        receipt_id: receiptId,
        task_id: taskId,
        agent_did,
        buyer_did: platform.did, // platform acts as the "buyer" for non-economic actions
        platform_did: platform.did,
        action_category,
        action_type: action_type || action_category.split('.')[1],
        category: action_category.split('.')[0],
        amount: value_usd || 0,
        currency: 'USD',
        outcome: 'accepted',
        dispute: false,
        sla: metadata || {},
        signatures: { platform_sig: platformSig },
        finalized_at: now,
      })
      .select()
      .single();

    if (error) {
      console.error('[platform-action] Insert error:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, receipt_id: receiptId }, { status: 201 });
  } catch (error) {
    console.error('[platform-action] Error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
