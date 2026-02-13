/**
 * GET /api/reputation/agent/[did]/reputation — Aggregated reputation for an agent
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getMultiWindowReputation } from '@/lib/reputation/attestation-engine';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ did: string }> }
) {
  try {
    const { did } = await params;
    const agentDid = decodeURIComponent(did);

    if (!agentDid) {
      return NextResponse.json({ error: 'Missing agent DID' }, { status: 400 });
    }

    const supabase = getSupabase();
    const reputation = await getMultiWindowReputation(supabase, agentDid);

    return NextResponse.json(reputation);
  } catch (error) {
    console.error('Reputation query error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
