/**
 * POST /api/escrow/series — Create recurring escrow series
 * GET  /api/escrow/series — List series for a business
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';
import { createEscrow } from '@/lib/escrow';
import { isBusinessPaidTier } from '@/lib/entitlements/service';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      business_id,
      payment_method,
      customer_email,
      description,
      amount,
      currency = 'USD',
      coin,
      interval,
      max_periods,
      beneficiary_address,
      depositor_address,
      beneficiary_email,
    } = body;

    // Validate required fields before touching DB
    if (!business_id || !payment_method || !amount || !interval) {
      return NextResponse.json(
        { error: 'Required: business_id, payment_method, amount, interval' },
        { status: 400 }
      );
    }

    if (payment_method !== 'crypto') {
      return NextResponse.json({ error: 'Only crypto escrow series are supported' }, { status: 400 });
    }

    if (!['weekly', 'biweekly', 'monthly'].includes(interval)) {
      return NextResponse.json({ error: 'interval must be weekly, biweekly, or monthly' }, { status: 400 });
    }

    if (payment_method === 'crypto' && !coin) {
      return NextResponse.json({ error: 'coin is required for crypto payment method' }, { status: 400 });
    }

    const supabase = getSupabase();

    // Auth required
    const authHeader = request.headers.get('authorization');
    const apiKeyHeader = request.headers.get('x-api-key');
    const authResult = await authenticateRequest(supabase, authHeader || apiKeyHeader);
    if (!authResult.success || !authResult.context || !isMerchantAuth(authResult.context)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Calculate next charge based on interval
    const now = new Date();
    const nextCharge = new Date(now);
    if (interval === 'weekly') nextCharge.setDate(now.getDate() + 7);
    else if (interval === 'biweekly') nextCharge.setDate(now.getDate() + 14);
    else nextCharge.setMonth(now.getMonth() + 1);

    const { data: series, error } = await supabase
      .from('escrow_series')
      .insert({
        merchant_id: business_id,
        payment_method,
        customer_email,
        description,
        amount,
        currency,
        coin,
        interval,
        next_charge_at: nextCharge.toISOString(),
        max_periods: max_periods || null,
        beneficiary_address,
        depositor_address,
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to create escrow series:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Create the first escrow in the series
    if (payment_method === 'crypto' && depositor_address && beneficiary_address) {
      const isPaidTier = await isBusinessPaidTier(supabase, business_id).catch(() => false);

      // Map interval to expiry hours: weekly=168h, biweekly=336h, monthly=720h
      const expiresMap: Record<string, number> = { weekly: 168, biweekly: 336, monthly: 720 };

      const escrowInput = {
        chain: coin,
        amount,
        depositor_address,
        beneficiary_address,
        business_id,
        series_id: series.id,
        expires_in_hours: expiresMap[interval] || 168,
        metadata: {
          period: 1,
          description: description || undefined,
        },
        ...(customer_email ? { depositor_email: customer_email } : {}),
        ...(beneficiary_email ? { beneficiary_email } : {}),
      };
      console.log('[Series] Creating first escrow with input:', JSON.stringify(escrowInput));

      const escrowResult = await createEscrow(supabase, escrowInput, isPaidTier);
      console.log('[Series] createEscrow result:', JSON.stringify({
        success: escrowResult.success,
        error: escrowResult.error,
        hasEscrow: !!escrowResult.escrow,
      }));

      if (escrowResult.success && escrowResult.escrow) {
        return NextResponse.json({
          series,
          escrow: escrowResult.escrow,
        }, { status: 201 });
      }

      // Series created but first escrow failed — return series with warning
      return NextResponse.json({
        series,
        escrow: null,
        warning: escrowResult.error || 'Failed to create first escrow payment',
      }, { status: 201 });
    }

    return NextResponse.json({ series, escrow: null }, { status: 201 });
  } catch (error) {
    console.error('Failed to create escrow series:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const businessId = searchParams.get('business_id');

    const supabase = getSupabase();

    const authHeader = request.headers.get('authorization');
    const apiKeyHeader = request.headers.get('x-api-key');
    const authResult = await authenticateRequest(supabase, authHeader || apiKeyHeader);
    if (!authResult.success || !authResult.context || !isMerchantAuth(authResult.context)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let query = supabase
      .from('escrow_series')
      .select('*')
      .order('created_at', { ascending: false });

    // If business_id specified (and not 'all'), filter by it
    // Otherwise list all series for the merchant's businesses
    if (businessId && businessId !== 'all') {
      query = query.eq('merchant_id', businessId);
    } else {
      // Get all businesses for this merchant
      const merchantId = (authResult.context as any).merchantId;
      if (merchantId) {
        const { data: businesses } = await supabase
          .from('businesses')
          .select('id')
          .eq('merchant_id', merchantId);
        if (businesses && businesses.length > 0) {
          query = query.in('merchant_id', businesses.map((b: { id: string }) => b.id));
        }
      }
    }

    const status = searchParams.get('status');
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ series: data });
  } catch (error) {
    console.error('Failed to list escrow series:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
