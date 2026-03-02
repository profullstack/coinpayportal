/**
 * POST /api/escrow — Create a new escrow
 * GET  /api/escrow — List escrows (requires auth)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createEscrow, listEscrows } from '@/lib/escrow';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { isBusinessPaidTier } from '@/lib/entitlements/service';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/**
 * POST /api/escrow
 * Create a new escrow — requires authentication
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();

    // Rate limit by IP
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateCheck = await checkRateLimitAsync(clientIp, 'escrow_creation');
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again later.' },
        { status: 429 }
      );
    }

    // Authentication required for escrow creation — check before parsing body
    let isPaidTier = false;
    let businessId: string | undefined;

    const authHeader = request.headers.get('authorization');
    const apiKeyHeader = request.headers.get('x-api-key');

    if (!authHeader && !apiKeyHeader) {
      return NextResponse.json(
        { error: 'Authentication required. Provide Authorization header or X-API-Key.' },
        { status: 401 }
      );
    }

    let authContext: any;
    try {
      const authResult = await authenticateRequest(supabase, authHeader || apiKeyHeader);
      if (!authResult.success) {
        return NextResponse.json(
          { error: 'Invalid or expired authentication' },
          { status: 401 }
        );
      }
      authContext = authResult.context;
    } catch {
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 401 }
      );
    }

    const body = await request.json();

    if (authContext && isMerchantAuth(authContext)) {
      if (body.business_id) {
        isPaidTier = await isBusinessPaidTier(supabase, body.business_id);
        businessId = body.business_id;
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
    let merchantId: string | undefined;
    let businessIds: string[] | undefined;
    let scopedWalletAddresses: string[] = [];

    if (authHeader || apiKeyHeader) {
      try {
        const authResult = await authenticateRequest(supabase, authHeader || apiKeyHeader);
        if (authResult.success && authResult.context) {
          if (isMerchantAuth(authResult.context)) {
            merchantId = authResult.context.merchantId;
            filters.business_id = searchParams.get('business_id') || undefined;
          } else {
            // Business API key — scope to that business
            filters.business_id = (authResult.context as any).businessId;
          }
        }
      } catch {
        // Continue — address-based filtering still works
      }
    }

    // Scope to merchant's businesses if authenticated as merchant
    if (merchantId && !filters.business_id) {
      const { data: businesses } = await supabase
        .from('businesses')
        .select('id')
        .eq('merchant_id', merchantId);
      
      if (businesses && businesses.length > 0) {
        businessIds = businesses.map((b: { id: string }) => b.id);
      }

      // Also scope by wallets owned by this merchant (global + business wallets)
      const walletAddressSet = new Set<string>();

      const { data: merchantWallets } = await supabase
        .from('merchant_wallets')
        .select('wallet_address')
        .eq('merchant_id', merchantId)
        .eq('is_active', true);

      for (const row of merchantWallets || []) {
        if (row.wallet_address) walletAddressSet.add(row.wallet_address);
      }

      if (businessIds && businessIds.length > 0) {
        const { data: businessWallets } = await supabase
          .from('business_wallets')
          .select('wallet_address')
          .in('business_id', businessIds)
          .eq('is_active', true);

        for (const row of businessWallets || []) {
          if (row.wallet_address) walletAddressSet.add(row.wallet_address);
        }
      }

      scopedWalletAddresses = Array.from(walletAddressSet);
    }

    // Must have a scoping filter (status alone must NOT allow listing all escrows)
    const hasScope = Boolean(
      filters.depositor_address ||
      filters.beneficiary_address ||
      filters.business_id ||
      (businessIds && businessIds.length > 0) ||
      (scopedWalletAddresses && scopedWalletAddresses.length > 0)
    );
    if (!hasScope) {
      return NextResponse.json(
        { error: 'A scoping filter is required (depositor, beneficiary, business_id, or authenticated account scope)' },
        { status: 400 }
      );
    }

    const offset = Number(filters.offset || 0);
    const limit = Number(filters.limit || 20);

    // If the caller explicitly scopes by depositor/beneficiary/business_id, keep direct behavior.
    const hasExplicitPartyScope = Boolean(filters.depositor_address || filters.beneficiary_address || filters.business_id);
    if (hasExplicitPartyScope) {
      const result = await listEscrows(supabase, { ...filters, business_ids: businessIds } as any);

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      return NextResponse.json({
        escrows: result.escrows,
        total: result.total,
        limit: filters.limit,
        offset: filters.offset,
      });
    }

    // Implicit authenticated account scope: union of business escrows + wallet-party escrows.
    const aggregate = new Map<string, any>();
    const queries: Array<Promise<{ success: boolean; escrows?: any[]; total?: number; error?: string }>> = [];

    if (businessIds && businessIds.length > 0) {
      queries.push(listEscrows(supabase, {
        ...filters,
        business_ids: businessIds,
        limit: 500,
        offset: 0,
      } as any));
    }

    if (scopedWalletAddresses.length > 0) {
      queries.push(listEscrows(supabase, {
        ...filters,
        depositor_addresses: scopedWalletAddresses,
        limit: 500,
        offset: 0,
      } as any));
      queries.push(listEscrows(supabase, {
        ...filters,
        beneficiary_addresses: scopedWalletAddresses,
        limit: 500,
        offset: 0,
      } as any));
    }

    const results = await Promise.all(queries);
    for (const result of results) {
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      for (const escrow of result.escrows || []) {
        aggregate.set(escrow.id, escrow);
      }
    }

    const mergedEscrows = Array.from(aggregate.values()).sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const pagedEscrows = mergedEscrows.slice(offset, offset + limit);

    return NextResponse.json({
      escrows: pagedEscrows,
      total: mergedEscrows.length,
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
