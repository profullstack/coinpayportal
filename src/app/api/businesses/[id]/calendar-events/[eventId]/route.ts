import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';

async function verifyAuth(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing authorization header', status: 401 };
  }

  const token = authHeader.substring(7);
  const jwtSecret = getJwtSecret();

  if (!jwtSecret) {
    return { error: 'Server configuration error', status: 500 };
  }

  try {
    const decoded = verifyToken(token, jwtSecret);
    return { merchantId: decoded.userId };
  } catch {
    return { error: 'Invalid or expired token', status: 401 };
  }
}

function createSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;
  return createClient(supabaseUrl, supabaseKey);
}

/**
 * PUT /api/businesses/[id]/calendar-events/[eventId]
 * Update a calendar event (supports drag-and-drop reschedule)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> }
) {
  try {
    const { id: businessId, eventId } = await params;
    const auth = await verifyAuth(request);
    if (auth.error) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const supabase = createSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    // Verify ownership
    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .eq('merchant_id', auth.merchantId)
      .single();

    if (bizError || !business) {
      return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.start_at !== undefined) updates.start_at = body.start_at;
    if (body.end_at !== undefined) updates.end_at = body.end_at;
    if (body.all_day !== undefined) updates.all_day = body.all_day;
    if (body.color !== undefined) updates.color = body.color;

    const { data: event, error } = await supabase
      .from('calendar_events')
      .update(updates)
      .eq('id', eventId)
      .eq('business_id', businessId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, event });
  } catch (error) {
    console.error('Update calendar event error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/businesses/[id]/calendar-events/[eventId]
 * Delete a calendar event
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> }
) {
  try {
    const { id: businessId, eventId } = await params;
    const auth = await verifyAuth(request);
    if (auth.error) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const supabase = createSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    // Verify ownership
    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .eq('merchant_id', auth.merchantId)
      .single();

    if (bizError || !business) {
      return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });
    }

    const { error } = await supabase
      .from('calendar_events')
      .delete()
      .eq('id', eventId)
      .eq('business_id', businessId);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete calendar event error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
