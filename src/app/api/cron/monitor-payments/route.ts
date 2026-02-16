/**
 * Monitor Payments Cron Route
 *
 * GET/POST /api/cron/monitor-payments
 *
 * Background job to monitor pending payments and escrows.
 * Should be called by an external cron service every 15 seconds.
 *
 * Authentication: CRON_SECRET or INTERNAL_API_KEY in Authorization header,
 * or x-vercel-cron header for Vercel Cron.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { monitorPayments } from './payment-monitor';
import { monitorEscrows } from './escrow-monitor';
import { monitorLightningPayments } from './lightning-monitor';
import { monitorSeries } from './series-monitor';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Get cron secret for authentication
 */
function getCronSecret(): string | undefined {
  return process.env.CRON_SECRET || process.env.INTERNAL_API_KEY;
}

/**
 * Authenticate the cron request
 */
function authenticateRequest(request: NextRequest): boolean {
  // Allow Vercel Cron requests
  if (request.headers.get('x-vercel-cron') === '1') {
    return true;
  }

  const cronSecret = getCronSecret();
  if (!cronSecret) {
    console.error('CRON_SECRET or INTERNAL_API_KEY not configured');
    return false;
  }

  const authHeader = request.headers.get('authorization');
  const providedSecret = authHeader?.replace('Bearer ', '');
  return providedSecret === cronSecret;
}

export async function GET(request: NextRequest) {
  try {
    if (!authenticateRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const now = new Date();

    // Monitor payments
    const stats = await monitorPayments(supabase, now);

    // Monitor escrows
    const escrowStats = await monitorEscrows(supabase, now);

    // Monitor Lightning payments
    const lightningStats = await monitorLightningPayments(supabase, now);

    // Process recurring escrow series
    const seriesStats = await monitorSeries(supabase, now);

    const response = {
      success: true,
      timestamp: now.toISOString(),
      stats,
      escrow: escrowStats,
      lightning: lightningStats,
      series: seriesStats,
    };

    console.log('Monitor complete:', response);
    return NextResponse.json(response);
  } catch (error) {
    console.error('Monitor error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Monitor failed' },
      { status: 500 }
    );
  }
}

// Also support POST for flexibility
export async function POST(request: NextRequest) {
  return GET(request);
}
