import { NextRequest, NextResponse } from 'next/server';
import { submitReceipt } from '@/lib/reputation/receipt-service';
import { authenticateIssuer, issuerOwnsDid } from '@/lib/reputation/issuer-auth';
import { createServiceClient } from '@/lib/supabase/service-client';

function getSupabase() {
  return createServiceClient();
}

/**
 * POST /api/reputation/receipt
 *
 * Auth: `Authorization: Bearer <issuer api key>` resolving to an ACTIVE
 * reputation_issuers row. An issuer may only submit receipts as itself:
 * `platform_did` must match the issuer's DID (it defaults to it when omitted).
 *
 * This endpoint used to accept receipts from anyone — the only "signature"
 * check is that `signatures.escrow_sig` is a non-empty string — so any caller
 * could write reputation for any agent DID.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const issuer = await authenticateIssuer(supabase, request.headers.get('authorization'));
    if (!issuer) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing issuer API key' },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: 'Receipt must be a JSON object' }, { status: 400 });
    }

    const receipt = body as Record<string, unknown>;
    const claimed = receipt.platform_did;
    if (claimed === undefined || claimed === null || claimed === '') {
      receipt.platform_did = issuer.did;
    } else if (typeof claimed !== 'string' || !issuerOwnsDid(issuer.did, claimed)) {
      return NextResponse.json(
        { success: false, error: 'platform_did does not match the authenticated issuer' },
        { status: 403 },
      );
    }

    const result = await submitReceipt(supabase, receipt);

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, receipt: result.receipt }, { status: 201 });
  } catch (error) {
    console.error('Receipt submission error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
