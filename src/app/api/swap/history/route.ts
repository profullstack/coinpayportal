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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const walletId = searchParams.get('walletId');
    const status = searchParams.get('status');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!walletId) {
      return NextResponse.json(
        { error: 'Missing walletId parameter' },
        { status: 400 }
      );
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
      swaps: swaps || [],
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
