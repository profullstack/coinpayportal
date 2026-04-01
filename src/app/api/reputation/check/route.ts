/**
 * POST /api/reputation/check — Pre-transaction identity verification
 * Verifies an agent's DID exists, is not revoked, and returns trust tier
 * Use before accepting a gig to prevent impersonation
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isValidDid } from '@/lib/reputation/crypto';
import { computeTrustVector } from '@/lib/reputation/trust-engine';
import { computeTrustTier } from '@/lib/reputation/trust-tiers';
import { getAttestationScore } from '@/lib/reputation/mutual-attestation';

function getSupabase() {
  return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const body = await request.json();
    const { did } = body;

    if (!did || !isValidDid(did)) {
      return NextResponse.json({ verified: false, reason: 'Invalid or missing DID' }, { status: 400 });
    }

    // Check if DID is registered
    const { data: identity } = await supabase
      .from('did_identities')
      .select('did, user_id, created_at, revoked')
      .eq('did', did)
      .single();

    if (!identity) {
      return NextResponse.json({
        verified: false,
        reason: 'DID not registered',
        did,
      });
    }

    if (identity.revoked) {
      return NextResponse.json({
        verified: false,
        reason: 'DID has been revoked',
        did,
      });
    }

    // Compute trust tier
    const trustProfile = await computeTrustVector(supabase, did);
    const tier = computeTrustTier(trustProfile.trust_vector);

    // Get attestation score
    const attestationScore = await getAttestationScore(supabase, did);

    return NextResponse.json({
      verified: true,
      did,
      registered_at: identity.created_at,
      trust: {
        tier: tier.tier,
        score: tier.score,
        label: tier.label,
        risk_level: tier.risk_level,
      },
      attestations: {
        avg_rating: attestationScore.avg_rating,
        total: attestationScore.total_attestations,
      },
    });
  } catch (error) {
    console.error('Identity check error:', error);
    return NextResponse.json({ verified: false, reason: 'Internal server error' }, { status: 500 });
  }
}
