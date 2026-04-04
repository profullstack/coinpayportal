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
 * GET /api/businesses/[id]/calendar-events
 * Fetch calendar events for a business
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: businessId } = await params;
    const auth = await verifyAuth(request);
    if (auth.error) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const supabase = createSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    // Verify the business belongs to this merchant
    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .eq('merchant_id', auth.merchantId)
      .single();

    if (bizError || !business) {
      return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });
    }

    const { data: events, error } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('business_id', businessId)
      .order('start_at', { ascending: true });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, events: events || [] });
  } catch (error) {
    console.error('List calendar events error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/businesses/[id]/calendar-events
 * Create a new calendar event
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: businessId } = await params;
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
    const { title, description, start_at, end_at, all_day, color } = body;

    if (!title || !start_at) {
      return NextResponse.json({ success: false, error: 'Title and start_at are required' }, { status: 400 });
    }

    const { data: event, error } = await supabase
      .from('calendar_events')
      .insert({
        business_id: businessId,
        user_id: auth.merchantId,
        title,
        description: description || null,
        start_at,
        end_at: end_at || null,
        all_day: all_day || false,
        color: color || '#8b5cf6',
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, event }, { status: 201 });
  } catch (error) {
    console.error('Create calendar event error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
