import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { computeReputation } from '@/lib/reputation/attestation-engine';
import { computeTrustVector } from '@/lib/reputation/trust-engine';
import { isValidDid } from '@/lib/reputation/crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ did: string }> }
) {
  try {
    const { did } = await params;
    const agentDid = decodeURIComponent(did);

    if (!isValidDid(agentDid)) {
      return NextResponse.json({ success: false, error: 'Invalid DID format' }, { status: 400 });
    }

    const [reputation, trustProfile] = await Promise.all([
      computeReputation(supabase, agentDid),
      computeTrustVector(supabase, agentDid),
    ]);

    return NextResponse.json({
      success: true,
      reputation,
      trust_vector: trustProfile.trust_vector,
      computed_at: trustProfile.computed_at,
    });
  } catch (error) {
    console.error('Reputation query error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
