import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeInvoice } from '@/lib/auth/invoice-access';

/**
 * Manage the recurring schedule(s) attached to an invoice.
 *
 * Schedules could previously be created (POST /api/invoices with `schedule`)
 * but never read back, paused, or removed: there was no endpoint at all, the
 * invoice page rendered them read-only, and the only exits the scheduler
 * honoured — `max_occurrences` and `end_date` — are settable exclusively at
 * creation time. Deleting the template was no escape either, since DELETE
 * refuses anything that is not still a draft. A merchant who wanted a series
 * stopped had no way to do it from the product.
 *
 * Authorization matches the rest of the `/api/invoices/[id]/*` family: the
 * caller is checked against the invoice's owning business, so team members and
 * business-scoped API keys work the same way here as everywhere else.
 */

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * GET /api/invoices/[id]/schedule
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = serviceClient();

    const access = await authorizeInvoice(supabase, request, id, 'business.read', 'id, business_id');
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    const { data: schedules, error } = await supabase
      .from('invoice_schedules')
      .select('*')
      .eq('invoice_id', id)
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ success: false, error: 'Failed to load schedules' }, { status: 500 });
    }

    return NextResponse.json({ success: true, schedules: schedules ?? [] });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/invoices/[id]/schedule
 *
 * Body: { active?: boolean, end_date?: string | null, max_occurrences?: number | null,
 *         schedule_id?: string }
 *
 * `schedule_id` narrows the change to one schedule; omitting it applies to every
 * schedule on the invoice, which is the common case since invoices carry one.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = serviceClient();
    const body = await request.json().catch(() => ({}));

    const access = await authorizeInvoice(supabase, request, id, 'invoice.write', 'id, business_id');
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    const updates: Record<string, unknown> = {};

    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') {
        return NextResponse.json({ success: false, error: '`active` must be a boolean' }, { status: 400 });
      }
      updates.active = body.active;
    }

    if (body.end_date !== undefined) {
      if (body.end_date === null) {
        updates.end_date = null;
      } else if (typeof body.end_date === 'string' && !Number.isNaN(Date.parse(body.end_date))) {
        updates.end_date = new Date(body.end_date).toISOString();
      } else {
        return NextResponse.json({ success: false, error: '`end_date` must be an ISO date or null' }, { status: 400 });
      }
    }

    if (body.max_occurrences !== undefined) {
      if (body.max_occurrences === null) {
        updates.max_occurrences = null;
      } else if (Number.isInteger(body.max_occurrences) && body.max_occurrences > 0) {
        updates.max_occurrences = body.max_occurrences;
      } else {
        return NextResponse.json(
          { success: false, error: '`max_occurrences` must be a positive integer or null' },
          { status: 400 },
        );
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: 'No supported fields to update' }, { status: 400 });
    }

    // Scope the write to this invoice's schedules so a caller authorized for one
    // invoice cannot reach another's by passing a foreign schedule_id.
    let query = supabase.from('invoice_schedules').update(updates).eq('invoice_id', id);
    if (typeof body.schedule_id === 'string' && body.schedule_id) {
      query = query.eq('id', body.schedule_id);
    }

    const { data: schedules, error } = await query.select('*');

    if (error) {
      return NextResponse.json({ success: false, error: 'Failed to update schedule' }, { status: 500 });
    }
    if (!schedules || schedules.length === 0) {
      return NextResponse.json({ success: false, error: 'Schedule not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, schedules });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/invoices/[id]/schedule
 *
 * Removes the recurrence outright. Pausing via PATCH is the reversible option;
 * this is for series that should not exist at all.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = serviceClient();

    const access = await authorizeInvoice(supabase, request, id, 'invoice.write', 'id, business_id');
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    const { error } = await supabase.from('invoice_schedules').delete().eq('invoice_id', id);

    if (error) {
      return NextResponse.json({ success: false, error: 'Failed to delete schedule' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
