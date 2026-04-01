/**
 * POST /api/reputation/attest — Submit a mutual attestation
 * GET  /api/reputation/attest?receipt_id=... — Check attestation status
 *
 * After a successful transaction, both agent and buyer attest each other.
 * Builds a verifiable trust graph.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { submitAttestation, getAttestationStatus } from '@/lib/reputation/mutual-attestation';

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
