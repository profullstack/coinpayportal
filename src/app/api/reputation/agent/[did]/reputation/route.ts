import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { computeReputation } from '@/lib/reputation/attestation-engine';
import { computeTrustVector } from '@/lib/reputation/trust-engine';
import { computeTrustTier } from '@/lib/reputation/trust-tiers';
import { getAttestationScore } from '@/lib/reputation/mutual-attestation';
import { isValidDid } from '@/lib/reputation/crypto';

function getSupabase() {
  return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'public-anon-key'
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ did: string }> }
) {
  const supabase = getSupabase();
  try {
    const { did } = await params;
    const agentDid = decodeURIComponent(did);

    if (!isValidDid(agentDid)) {
      return NextResponse.json({ success: false, error: 'Invalid DID format' }, { status: 400 });
    }

    const [reputation, trustProfile, attestationScore, didRow, credCount] = await Promise.all([
      computeReputation(supabase, agentDid),
      computeTrustVector(supabase, agentDid),
      getAttestationScore(supabase, agentDid),
      supabase
        .from('merchant_dids')
        .select('did_kind, lifetime, label, verified, created_at')
        .eq('did', agentDid)
        .maybeSingle(),
      supabase
        .from('reputation_credentials')
        .select('id', { count: 'exact', head: true })
        .eq('subject_did', agentDid),
    ]);

    const tier = computeTrustTier(trustProfile.trust_vector);

    return NextResponse.json({
      success: true,
      reputation,
      trust_vector: trustProfile.trust_vector,
      trust_tier: {
        tier: tier.tier,
        score: tier.score,
        label: tier.label,
        risk_level: tier.risk_level,
      },
      attestations: {
        avg_rating: attestationScore.avg_rating,
        total: attestationScore.total_attestations,
        by_role: attestationScore.by_role,
      },
      did_info: didRow?.data
        ? {
            did_kind: didRow.data.did_kind as 'human' | 'agent' | 'service',
            lifetime: didRow.data.lifetime as 'persistent' | 'ephemeral',
            label: didRow.data.label as string | null,
            verified: !!didRow.data.verified,
            created_at: didRow.data.created_at as string,
          }
        : null,
      credentials_count: credCount?.count ?? 0,
      computed_at: trustProfile.computed_at,
    });
  } catch (error) {
    console.error('Reputation query error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
