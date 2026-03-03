/**
 * GET /api/reputation/trust?did=... — Trust tier lookup
 * Returns credit-style tier (A/B/C/D/F) with composite score
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isValidDid } from '@/lib/reputation/crypto';
import { computeTrustVector } from '@/lib/reputation/trust-engine';
import { computeTrustTier } from '@/lib/reputation/trust-tiers';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const did = request.nextUrl.searchParams.get('did');

    if (!did || !isValidDid(did)) {
      return NextResponse.json({ success: false, error: 'Invalid or missing DID' }, { status: 400 });
    }

    const trustProfile = await computeTrustVector(supabase, did);
    const tier = computeTrustTier(trustProfile.trust_vector);

    return NextResponse.json({
      success: true,
      did,
      tier: tier.tier,
      score: tier.score,
      label: tier.label,
      description: tier.description,
      risk_level: tier.risk_level,
      trust_vector: trustProfile.trust_vector,
      computed_at: trustProfile.computed_at,
    });
  } catch (error) {
    console.error('Trust tier error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
