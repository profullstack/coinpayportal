import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getFeePercentage } from '@/lib/payments/fees';
import { isBusinessPaidTier } from '@/lib/entitlements/service';
import { resolveMerchant } from '@/lib/auth/merchant';
import { authorizeBusiness, listAccessibleBusinessIds } from '@/lib/auth/authz';
import { resolvePayee } from '@/lib/payments/payee';

/**
 * GET /api/invoices
 * List all invoices for authenticated merchant.
 * Accepts either a JWT Bearer token or a CoinPay API key.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const authResult = await resolveMerchant(supabase, request);

    if ('error' in authResult) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const { merchantId, apiKeyBusinessId } = authResult;

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
      .order('created_at', { ascending: false });

    // Scope to the businesses the caller may read. API keys are locked to their own
    // business; team members see invoices for every business they can access.
    if (apiKeyBusinessId) {
      query = query.eq('business_id', apiKeyBusinessId);
    } else if (businessId) {
      const authz = await authorizeBusiness(supabase, merchantId, businessId, 'business.read');
      if (!authz.ok) {
        return NextResponse.json({ success: false, error: authz.error }, { status: authz.status });
      }
      query = query.eq('business_id', businessId);
    } else {
      const ids = await listAccessibleBusinessIds(supabase, merchantId);
      if (ids.length === 0) {
        return NextResponse.json({ success: true, invoices: [] });
      }
      query = query.in('business_id', ids);
    }
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
 * Create a new invoice.
 * Accepts either a JWT Bearer token or a CoinPay API key.
 * When authenticated via API key the business is already resolved from the key;
 * the caller may still pass business_id but it must match the key's business.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const authResult = await resolveMerchant(supabase, request);

    if ('error' in authResult) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const { merchantId, apiKeyBusinessId } = authResult;

    const body = await request.json();
    const {
      business_id, client_id, currency, amount, crypto_currency,
      due_date, notes, wallet_id, merchant_wallet_address,
      schedule, // optional: { recurrence, custom_interval_days, end_date, max_occurrences }
    } = body;

    // For API key auth, derive business_id from the key when not supplied in body.
    // If supplied, it must match the key's business to prevent cross-business abuse.
    const resolvedBusinessId: string | undefined = (() => {
      if (apiKeyBusinessId) {
        if (business_id && business_id !== apiKeyBusinessId) return undefined; // mismatch
        return apiKeyBusinessId;
      }
      return business_id;
    })();

    if (!resolvedBusinessId || !amount || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'business_id and positive amount are required' },
        { status: 400 }
      );
    }

    // Authorize. API keys are already scoped to their business; JWT/team callers must
    // hold invoice.write on the target business (writer/admin/owner).
    if (!(apiKeyBusinessId && apiKeyBusinessId === resolvedBusinessId)) {
      const authz = await authorizeBusiness(supabase, merchantId, resolvedBusinessId, 'invoice.write');
      if (!authz.ok) {
        return NextResponse.json({ success: false, error: authz.error }, { status: authz.status });
      }
    }

    // Resolve the business + its owner. The owner's id is used as the invoice user_id so
    // owner-scoped views still surface invoices a team member created.
    const { data: business } = await supabase
      .from('businesses')
      .select('id, merchant_id')
      .eq('id', resolvedBusinessId)
      .single();

    if (!business) {
      return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });
    }
    const invoiceOwnerId = business.merchant_id ?? merchantId;

    // An invoice must always name the address its net settles to. When a coin is
    // chosen we resolve one now (explicit > business wallet > account-global >
    // linked web wallet) and refuse the create if nothing is determinable, so the
    // caller is told to supply one manually rather than ending up with a
    // payee-less invoice. Coin choice may still be deferred to send time; the
    // send route runs the same check.
    let payeeAddress: string | null = null;
    let payeeSource: string | null = null;
    if (crypto_currency) {
      const payee = await resolvePayee(supabase, {
        businessId: resolvedBusinessId,
        merchantId: invoiceOwnerId,
        cryptocurrency: crypto_currency,
        requestedAddress: merchant_wallet_address,
      });
      if (!payee.ok) {
        return NextResponse.json(
          { success: false, error: payee.error, code: payee.code },
          { status: payee.status }
        );
      }
      payeeAddress = payee.address;
      payeeSource = payee.source;
    } else if (merchant_wallet_address) {
      // No coin yet, but the caller named a payee — keep it for send time.
      payeeAddress = String(merchant_wallet_address).trim() || null;
      payeeSource = payeeAddress ? 'manual' : null;
    }

    // Invoice number: highest existing + 1, per business.
    //
    // This is a read-then-write, so two invoices created at the same moment
    // both read the same maximum and both claim the same number. There is no
    // way to make it atomic from here, so the guarantee lives in the database:
    // a UNIQUE (business_id, invoice_number) constraint makes a collision an
    // error instead of a silent duplicate, and the insert below retries on it.
    //
    // Ordering by created_at was also wrong for the lookup — it returns the
    // most RECENTLY CREATED number, which is not the highest once any invoice
    // is deleted or backdated. Ordering by the parsed number is what was meant.
    const nextInvoiceNumber = async (): Promise<string> => {
      const { data: rows } = await supabase
        .from('invoices')
        .select('invoice_number')
        .eq('business_id', resolvedBusinessId)
        .not('invoice_number', 'is', null);

      let highest = 0;
      for (const row of rows || []) {
        const match = String(row.invoice_number).match(/INV-(\d+)/);
        if (match) {
          const n = parseInt(match[1], 10);
          if (Number.isFinite(n) && n > highest) highest = n;
        }
      }
      return `INV-${String(highest + 1).padStart(3, '0')}`;
    };

    let invoiceNumber = await nextInvoiceNumber();

    // Determine fee rate
    const isPaidTier = await isBusinessPaidTier(supabase, resolvedBusinessId);
    const feeRate = getFeePercentage(isPaidTier);

    // Insert, retrying on the unique (business_id, invoice_number) violation
    // that a concurrent create produces. Each retry re-reads the maximum, so
    // two racing requests end up with consecutive numbers rather than one
    // silently overwriting the other's.
    const MAX_NUMBER_ATTEMPTS = 5;
    let invoice: any = null;
    let error: { message: string; code?: string } | null = null;

    for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
      const result = await supabase
        .from('invoices')
        .insert({
          user_id: invoiceOwnerId,
          business_id: resolvedBusinessId,
          client_id: client_id || null,
          invoice_number: invoiceNumber,
          status: 'draft',
          currency: currency || 'USD',
          amount,
          crypto_currency: crypto_currency || null,
          merchant_wallet_address: payeeAddress,
          wallet_id: wallet_id || null,
          fee_rate: feeRate,
          due_date: due_date || null,
          notes: notes || null,
          metadata: payeeSource ? { payee_source: payeeSource } : {},
        })
        .select(`
          *,
          clients (id, name, email, company_name),
          businesses (id, name)
        `)
        .single();

      invoice = result.data;
      error = result.error;

      // 23505 = unique_violation. Anything else is a real failure.
      if (!error || error.code !== '23505') break;

      invoiceNumber = await nextInvoiceNumber();
    }

    if (error) {
      console.error('Create invoice error:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }

    if (!invoice) {
      return NextResponse.json(
        { success: false, error: 'Could not allocate an invoice number; please retry.' },
        { status: 409 }
      );
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
