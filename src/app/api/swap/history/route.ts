/**
 * GET /api/swap/history
 * Get swap history for a wallet
 * 
 * Query params:
 *   walletId: wallet ID (required)
 *   status: filter by status (optional)
 *   limit: max results (default 50, max 100)
 *   offset: pagination offset (default 0)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeWallet, stripProviderSecrets } from '@/lib/swap/auth';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';

function getSupabase() {
  return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function parsePaginationInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum?: number
) {
  if (value === null || !/^\d+$/.test(value)) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    return fallback;
  }

  return maximum === undefined ? parsed : Math.min(parsed, maximum);
}

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = parsePaginationInteger(searchParams.get('limit'), 50, 1, 100);
    const offset = parsePaginationInteger(searchParams.get('offset'), 0, 0);

    // The wallet id comes from the signed request, never from the query
    // string. Taking it from `?walletId=` meant any caller could read any
    // wallet's swap history — including the Boltz key material that used to be
    // stored in provider_data.
    const auth = await authorizeWallet(supabase, request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const walletId = auth.walletId;

    const rateCheck = await checkRateLimitAsync(walletId, 'swap_read');
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // Build query
    let query = supabase
      .from('swaps')
      .select('*', { count: 'exact' })
      .eq('wallet_id', walletId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Filter by status if provided
    if (status) {
      query = query.eq('status', status);
    }

    const { data: swaps, error, count } = await query;

    if (error) {
      console.error('[Swap History] DB error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch swap history' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      // Key material never travels in a listing, even to the owner — the
      // refund/claim key is handed out once at creation and nowhere else.
      swaps: (swaps || []).map((swap: Record<string, unknown>) => ({
        ...swap,
        provider_data: swap.provider_data
          ? stripProviderSecrets(swap.provider_data as Record<string, unknown>)
          : swap.provider_data,
      })),
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: (count || 0) > offset + limit,
      },
    });
  } catch (error) {
    console.error('[Swap History] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
