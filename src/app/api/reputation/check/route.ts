/**
 * POST /api/reputation/check — Pre-transaction identity verification
 * Verifies an agent's DID exists, is not revoked, and returns trust tier
 * Use before accepting a gig to prevent impersonation
 */

import { NextRequest, NextResponse } from 'next/server';
import { isValidDid } from '@/lib/reputation/crypto';
import { computeTrustVector } from '@/lib/reputation/trust-engine';
import { computeTrustTier } from '@/lib/reputation/trust-tiers';
import { getAttestationScore } from '@/lib/reputation/mutual-attestation';
import { createServiceClient } from '@/lib/supabase/service-client';

function getSupabase() {
  return createServiceClient();
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const body = await request.json();
    const { did } = body;

    if (!did || !isValidDid(did)) {
      return NextResponse.json({ verified: false, reason: 'Invalid or missing DID' }, { status: 400 });
    }

    // L7A-04: this queried `did_identities`, which does not exist — confirmed
    // against the live schema. PostgREST answers an unknown relation with an
    // error, `identity` came back undefined, and every DID on the platform was
    // reported "not registered", including legitimate ones. This endpoint is
    // documented as the pre-transaction impersonation check, so it was
    // answering "unverified" to every honest caller.
    //
    // The real registry is `merchant_dids`, which the sibling route
    // /api/reputation/agent/[did]/reputation has been querying all along.
    const { data: identity, error: identityError } = await supabase
      .from('merchant_dids')
      .select('did, merchant_id, created_at, verified')
      .eq('did', did)
      .maybeSingle();

    if (identityError) {
      // A lookup failure is not an answer. Reporting `verified: false` on a
      // database error is what made the original bug invisible: the caller
      // cannot tell "this DID is not registered" from "we could not check".
      console.error('[Reputation] DID lookup failed:', identityError);
      return NextResponse.json(
        { verified: false, reason: 'Could not verify DID registration', did },
        { status: 503 }
      );
    }

    if (!identity) {
      return NextResponse.json({
        verified: false,
        reason: 'DID not registered',
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
      // The registry's own flag, reported rather than inferred.
      registration_verified: Boolean(identity.verified),
      // Said out loud rather than implied. The route used to test a `revoked`
      // column; neither that column nor any revocation table exists, so DID
      // revocation is not modelled anywhere in this system. A caller using this
      // to decide whether to trust a counterparty must know that a compromised
      // DID cannot currently be turned off — silently dropping the check would
      // leave them believing it had passed.
      revocation_checked: false,
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
