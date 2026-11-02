import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';
import { listAccessibleBusinessIds } from '@/lib/auth/authz';
import { parsePaginationParam } from '@/lib/api/pagination';
import { buildBehindReport, PAID_CARD_STATUSES, type CardRow, type InvoiceRow } from '@/lib/payments/behind';

const ROW_CAP = 5000;

/**
 * GET /api/payments/behind
 * Everyone who owes money or whose payment failed, grouped by what to do.
 *
 * Query params:
 *   - business_id: one business (must be accessible; an API key is pinned to its own)
 *   - days: how far back a declined card still counts (default 90, max 365)
 *
 * Read-only. Joins overdue invoices and declined card payments per customer
 * (by email within a business); see src/lib/payments/behind.ts.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const auth = await resolveMerchant(supabase, request);
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const requested = searchParams.get('business_id');
    const days = parsePaginationParam(searchParams.get('days'), 90, { min: 1, max: 365 });

    let businessIds: string[];
    if (auth.apiKeyBusinessId) {
      if (requested && requested !== auth.apiKeyBusinessId) {
        return NextResponse.json({ success: false, error: 'Business not found or access denied' }, { status: 403 });
      }
      businessIds = [auth.apiKeyBusinessId];
    } else {
      const accessible = await listAccessibleBusinessIds(supabase, auth.merchantId);
      if (requested && !accessible.includes(requested)) {
        return NextResponse.json({ success: false, error: 'Business not found or access denied' }, { status: 403 });
      }
      businessIds = requested ? [requested] : accessible;
    }

    if (businessIds.length === 0) {
      return NextResponse.json({ success: true, ...buildBehindReport([], [], { cardWindowDays: days }) });
    }

    // Card rows: failures (what is behind) and payments (the history that says
    // whether this is a first miss). Invoices: open ones plus paid ones for the
    // same reason.
    const [cardsRes, invoicesRes] = await Promise.all([
      supabase
        .from('stripe_transactions')
        .select('id, business_id, amount, currency, status, customer_name, customer_email, failure_reason, failure_code, created_at, businesses (name)')
        .in('business_id', businessIds)
        .in('status', ['failed', ...PAID_CARD_STATUSES])
        .order('created_at', { ascending: false })
        .limit(ROW_CAP),
      supabase
        .from('invoices')
        .select('id, business_id, invoice_number, status, currency, amount, due_date, paid_at, created_at, email_status, email_last_error, client_id, clients (name, company_name, email), businesses (name)')
        .in('business_id', businessIds)
        .in('status', ['sent', 'overdue', 'paid'])
        .order('created_at', { ascending: false })
        .limit(ROW_CAP),
    ]);

    if (cardsRes.error || invoicesRes.error) {
      console.error('[payments/behind] query failed', cardsRes.error || invoicesRes.error);
      return NextResponse.json({ success: false, error: 'Failed to load payments' }, { status: 500 });
    }

    const report = buildBehindReport(
      (cardsRes.data ?? []) as unknown as CardRow[],
      (invoicesRes.data ?? []) as unknown as InvoiceRow[],
      { cardWindowDays: days },
    );
    return NextResponse.json({ success: true, ...report });
  } catch (err) {
    console.error('[payments/behind] error', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
