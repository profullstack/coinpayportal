/**
 * GET    /api/escrow/series/[id] — Get series detail with child escrows
 * PATCH  /api/escrow/series/[id] — Update series (pause/resume/cancel, update amount)
 * DELETE /api/escrow/series/[id] — Cancel series
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabase();
    const { id } = await params;

    const authHeader = request.headers.get('authorization');
    const apiKeyHeader = request.headers.get('x-api-key');
    const authResult = await authenticateRequest(supabase, authHeader || apiKeyHeader);
    if (!authResult.success || !authResult.context || !isMerchantAuth(authResult.context)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: series, error } = await supabase
      .from('escrow_series')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    // Fetch linked crypto escrows
    const { data: cryptoEscrows } = await supabase
      .from('escrows')
      .select('*')
      .eq('series_id', id)
      .order('created_at', { ascending: false });

    return NextResponse.json({
      series,
      escrows: cryptoEscrows || [],
    });
  } catch (error) {
    console.error('Failed to get escrow series:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabase();
    const { id } = await params;
    const body = await request.json();

    const authHeader = request.headers.get('authorization');
    const apiKeyHeader = request.headers.get('x-api-key');
    const authResult = await authenticateRequest(supabase, authHeader || apiKeyHeader);
    if (!authResult.success || !authResult.context || !isMerchantAuth(authResult.context)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };

    if (body.status) {
      if (!['active', 'paused', 'cancelled', 'completed'].includes(body.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      updates.status = body.status;
    }

    if (body.amount !== undefined) updates.amount = body.amount;
    if (body.interval) {
      if (!['weekly', 'biweekly', 'monthly'].includes(body.interval)) {
        return NextResponse.json({ error: 'Invalid interval' }, { status: 400 });
      }
      updates.interval = body.interval;
    }

    const { data, error } = await supabase
      .from('escrow_series')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to update escrow series:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabase();
    const { id } = await params;

    const authHeader = request.headers.get('authorization');
    const apiKeyHeader = request.headers.get('x-api-key');
    const authResult = await authenticateRequest(supabase, authHeader || apiKeyHeader);
    if (!authResult.success || !authResult.context || !isMerchantAuth(authResult.context)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('escrow_series')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to cancel escrow series:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
