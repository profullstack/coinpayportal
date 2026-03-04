import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import { getFeePercentage } from '@/lib/payments/fees';
import { isBusinessPaidTier } from '@/lib/entitlements/service';

/**
 * GET /api/invoices
 * List all invoices for authenticated merchant
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Missing authorization header' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    const decoded = verifyToken(token, jwtSecret);
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const status = searchParams.get('status');
    const clientId = searchParams.get('client_id');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    let query = supabase
      .from('invoices')
      .select(`
        *,
        clients (id, name, email, company_name),
        businesses (id, name)
      `)
      .eq('user_id', decoded.userId)
      .order('created_at', { ascending: false });

    if (businessId) query = query.eq('business_id', businessId);
    if (status) query = query.eq('status', status);
    if (clientId) query = query.eq('client_id', clientId);
    if (dateFrom) query = query.gte('created_at', new Date(dateFrom).toISOString());
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setDate(endDate.getDate() + 1);
      query = query.lt('created_at', endDate.toISOString());
    }

    const { data: invoices, error } = await query;

    if (error) {
      console.error('Error fetching invoices:', error);
      return NextResponse.json({ success: false, error: 'Failed to fetch invoices' }, { status: 500 });
    }

    return NextResponse.json({ success: true, invoices: invoices || [] });
  } catch (error) {
    console.error('List invoices error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/invoices
 * Create a new invoice
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Missing authorization header' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    const decoded = verifyToken(token, jwtSecret);
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const body = await request.json();
    const {
      business_id, client_id, currency, amount, crypto_currency,
      due_date, notes, wallet_id, merchant_wallet_address,
      schedule, // optional: { recurrence, custom_interval_days, end_date, max_occurrences }
    } = body;

    if (!business_id || !amount || amount <= 0) {
      return NextResponse.json({ success: false, error: 'business_id and positive amount are required' }, { status: 400 });
    }

    // Verify business belongs to user
    const { data: business } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', business_id)
      .eq('merchant_id', decoded.userId)
      .single();

    if (!business) {
      return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });
    }

    // Generate invoice number
    const { data: maxInvoice } = await supabase
      .from('invoices')
      .select('invoice_number')
      .eq('business_id', business_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let nextNum = 1;
    if (maxInvoice?.invoice_number) {
      const match = maxInvoice.invoice_number.match(/INV-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    const invoiceNumber = `INV-${String(nextNum).padStart(3, '0')}`;

    // Determine fee rate
    const isPaidTier = await isBusinessPaidTier(supabase, business_id);
    const feeRate = getFeePercentage(isPaidTier);

    const { data: invoice, error } = await supabase
      .from('invoices')
      .insert({
        user_id: decoded.userId,
        business_id,
        client_id: client_id || null,
        invoice_number: invoiceNumber,
        status: 'draft',
        currency: currency || 'USD',
        amount,
        crypto_currency: crypto_currency || null,
        merchant_wallet_address: merchant_wallet_address || null,
        wallet_id: wallet_id || null,
        fee_rate: feeRate,
        due_date: due_date || null,
        notes: notes || null,
      })
      .select(`
        *,
        clients (id, name, email, company_name),
        businesses (id, name)
      `)
      .single();

    if (error) {
      console.error('Create invoice error:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }

    // Create schedule if provided
    if (schedule && schedule.recurrence) {
      const { error: schedError } = await supabase
        .from('invoice_schedules')
        .insert({
          invoice_id: invoice.id,
          recurrence: schedule.recurrence,
          custom_interval_days: schedule.custom_interval_days || null,
          next_due_date: due_date || new Date().toISOString(),
          end_date: schedule.end_date || null,
          max_occurrences: schedule.max_occurrences || null,
        });

      if (schedError) {
        console.error('Create schedule error:', schedError);
      }
    }

    return NextResponse.json({ success: true, invoice }, { status: 201 });
  } catch (error) {
    console.error('Create invoice error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
