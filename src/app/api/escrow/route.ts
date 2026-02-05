/**
 * POST /api/escrow — Create a new escrow
 * GET  /api/escrow — List escrows (requires auth)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createEscrow, listEscrows } from '@/lib/escrow';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';
import { isBusinessPaidTier } from '@/lib/entitlements/service';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/**
 * POST /api/escrow
 * Create a new escrow — anonymous, no auth required
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const body = await request.json();

    // Check if authenticated (optional — for merchant association + paid tier)
    let isPaidTier = false;
    let businessId: string | undefined;

    const authHeader = request.headers.get('authorization');
    const apiKeyHeader = request.headers.get('x-api-key');

    if (authHeader || apiKeyHeader) {
      try {
        const auth = await authenticateRequest(request, supabase);
        if (auth && isMerchantAuth(auth)) {
          // Check if merchant has paid tier
          const merchantId = auth.merchantId;
          if (body.business_id) {
            isPaidTier = await isBusinessPaidTier(supabase, body.business_id);
            businessId = body.business_id;
          }
        }
      } catch {
        // Auth is optional — continue as anonymous
      }
    }

    const result = await createEscrow(supabase, {
      ...body,
      business_id: businessId || body.business_id,
    }, isPaidTier);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.escrow, { status: 201 });
  } catch (error) {
    console.error('Failed to create escrow:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/escrow
 * List escrows — requires auth (merchant) or query by address
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);

    const filters: Record<string, string | number | undefined> = {
      status: searchParams.get('status') || undefined,
      depositor_address: searchParams.get('depositor') || undefined,
      beneficiary_address: searchParams.get('beneficiary') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0,
    };

    // If authenticated, scope to merchant's businesses
    const authHeader = request.headers.get('authorization');
    const apiKeyHeader = request.headers.get('x-api-key');

    if (authHeader || apiKeyHeader) {
      try {
        const auth = await authenticateRequest(request, supabase);
        if (auth && isMerchantAuth(auth)) {
          filters.business_id = searchParams.get('business_id') || undefined;
        }
      } catch {
        // Continue — address-based filtering still works
      }
    }

    // Must have at least one filter (don't allow listing all escrows)
    const hasFilter = filters.status || filters.depositor_address ||
      filters.beneficiary_address || filters.business_id;
    if (!hasFilter) {
      return NextResponse.json(
        { error: 'At least one filter required (status, depositor, beneficiary, or business_id)' },
        { status: 400 }
      );
    }

    const result = await listEscrows(supabase, filters as any);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      escrows: result.escrows,
      total: result.total,
      limit: filters.limit,
      offset: filters.offset,
    });
  } catch (error) {
    console.error('Failed to list escrows:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
