import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';

function getAuth(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  const jwtSecret = getJwtSecret();
  if (!jwtSecret) return null;
  try {
    return verifyToken(token, jwtSecret);
  } catch {
    return null;
  }
}

/**
 * GET /api/invoices/[id]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const decoded = getAuth(request);
    if (!decoded) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: invoice, error } = await supabase
      .from('invoices')
      .select(`
        *,
        clients (id, name, email, company_name, phone, address),
        businesses (id, name, description),
        invoice_schedules (*)
      `)
      .eq('id', id)
      .eq('user_id', decoded.userId)
      .single();

    if (error || !invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, invoice });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/invoices/[id]
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const decoded = getAuth(request);
    if (!decoded) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const body = await request.json();

    // Only allow updating certain fields based on status
    const { data: existing } = await supabase
      .from('invoices')
      .select('status')
      .eq('id', id)
      .eq('user_id', decoded.userId)
      .single();

    if (!existing) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }

    const allowedFields: Record<string, unknown> = {};
    const editableFields = ['client_id', 'currency', 'amount', 'crypto_currency', 'due_date', 'notes', 'merchant_wallet_address', 'wallet_id'];

    // Draft invoices: can edit everything
    // Sent invoices: can only cancel or mark paid
    if (existing.status === 'draft') {
      for (const field of editableFields) {
        if (body[field] !== undefined) allowedFields[field] = body[field];
      }
    }

    if (body.status) {
      // Allowed transitions
      const transitions: Record<string, string[]> = {
        draft: ['sent', 'cancelled'],
        sent: ['paid', 'overdue', 'cancelled'],
        overdue: ['paid', 'cancelled'],
      };
      const allowed = transitions[existing.status] || [];
      if (allowed.includes(body.status)) {
        allowedFields.status = body.status;
        if (body.status === 'paid') {
          allowedFields.paid_at = new Date().toISOString();
          if (body.tx_hash) allowedFields.tx_hash = body.tx_hash;
        }
      } else {
        return NextResponse.json(
          { success: false, error: `Cannot transition from ${existing.status} to ${body.status}` },
          { status: 400 }
        );
      }
    }

    allowedFields.updated_at = new Date().toISOString();

    const { data: invoice, error } = await supabase
      .from('invoices')
      .update(allowedFields)
      .eq('id', id)
      .eq('user_id', decoded.userId)
      .select(`*, clients (id, name, email, company_name), businesses (id, name)`)
      .single();

    if (error || !invoice) {
      return NextResponse.json({ success: false, error: 'Update failed' }, { status: 400 });
    }

    return NextResponse.json({ success: true, invoice });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/invoices/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const decoded = getAuth(request);
    if (!decoded) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Only allow deleting draft invoices
    const { data: invoice } = await supabase
      .from('invoices')
      .select('status')
      .eq('id', id)
      .eq('user_id', decoded.userId)
      .single();

    if (!invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }

    if (invoice.status !== 'draft') {
      return NextResponse.json({ success: false, error: 'Only draft invoices can be deleted' }, { status: 400 });
    }

    const { error } = await supabase
      .from('invoices')
      .delete()
      .eq('id', id)
      .eq('user_id', decoded.userId);

    if (error) {
      return NextResponse.json({ success: false, error: 'Failed to delete invoice' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
