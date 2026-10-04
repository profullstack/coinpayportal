/**
 * POST /api/reputation/attest — Submit a mutual attestation
 * GET  /api/reputation/attest?receipt_id=... — Check attestation status
 *
 * After a successful transaction, both agent and buyer attest each other.
 * Builds a verifiable trust graph.
 */

import { authenticateRequest } from '@/lib/auth/middleware';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { NextRequest, NextResponse } from 'next/server';
import { submitAttestation, getAttestationStatus } from '@/lib/reputation/mutual-attestation';
import { createServiceClient } from '@/lib/supabase/service-client';

function getSupabase() {
  return createServiceClient();
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const body = await request.json();

    // Prove the caller controls `attester_did` before recording anything.
    //
    // This route was completely unauthenticated and took `attester_did` from
    // the body. `submitAttestation` does check that the attester is a party to
    // the receipt, so it was never *unbounded* forgery — but knowing a receipt
    // id and the two DIDs on it was enough to attest as either party, and the
    // receipts endpoint used to hand out exactly that (CP-014). The trust graph
    // is consumed by `web-bot-auth/verify` for real decisions, so an
    // attestation nobody had to own an identity to make is worth nothing.
    //
    // Control is established through the existing DID-to-merchant link rather
    // than a new signature scheme: `merchant_dids` already records which
    // merchant owns which DID.
    const auth = await authenticateRequest(supabase, request.headers.get('authorization'));
    if (!auth.success || !auth.context) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const attesterDid = typeof body?.attester_did === 'string' ? body.attester_did : null;
    if (!attesterDid) {
      return NextResponse.json(
        { success: false, error: 'attester_did is required' },
        { status: 400 }
      );
    }

    const rate = await checkRateLimitAsync(auth.context.merchantId, 'reputation_attest');
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many attestations. Please try again shortly.' },
        { status: 429 }
      );
    }

    const { data: ownsDid } = await supabase
      .from('merchant_dids')
      .select('did')
      .eq('did', attesterDid)
      .eq('merchant_id', auth.context.merchantId)
      .maybeSingle();

    if (!ownsDid) {
      return NextResponse.json(
        { success: false, error: 'You do not control that attester DID' },
        { status: 403 }
      );
    }

    const result = await submitAttestation(supabase, body);

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, attestation: result.attestation }, { status: 201 });
  } catch (error) {
    console.error('Attestation error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const receiptId = request.nextUrl.searchParams.get('receipt_id');

    if (!receiptId) {
      return NextResponse.json({ success: false, error: 'receipt_id required' }, { status: 400 });
    }

    const status = await getAttestationStatus(supabase, receiptId);
    return NextResponse.json({ success: true, ...status });
  } catch (error) {
    console.error('Attestation status error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
