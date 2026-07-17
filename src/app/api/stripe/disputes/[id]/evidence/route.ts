import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { authorizeBusinessOwner } from '@/lib/auth/authz';
import { getJwtSecret } from '@/lib/secrets';
import { getStripe } from '@/lib/server/optional-deps';

// Only these dispute states accept evidence submissions.
const ACTIONABLE_DISPUTE_STATUSES = new Set([
  'warning_needs_response',
  'warning_under_review',
  'needs_response',
  'under_review',
]);

// Stripe dispute-evidence file constraints.
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_FILE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);

// Free-text evidence fields we accept, mapped 1:1 to Stripe evidence keys.
const TEXT_FIELDS = [
  'product_description',
  'customer_email_address',
  'customer_name',
  'shipping_carrier',
  'shipping_tracking_number',
  'shipping_date',
  'service_date',
  'uncategorized_text',
] as const;

// File fields -> Stripe evidence file keys.
const FILE_FIELDS = [
  'receipt',
  'customer_communication',
  'shipping_documentation',
  'service_documentation',
  'uncategorized_file',
] as const;

/**
 * POST /api/stripe/disputes/[id]/evidence  (multipart/form-data)
 * Contest a card dispute by submitting evidence to Stripe. Uploads any attached
 * files via the Files API (purpose: dispute_evidence), then
 * `disputes.update(id, { evidence, submit: true })`.
 *
 * Owner-only (`funds.move`). Submitting is final — Stripe locks the evidence.
 */
export async function POST(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await paramsPromise;

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Missing authorization header' }, { status: 401 });
    }

    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    let decoded;
    try {
      decoded = verifyToken(authHeader.substring(7), jwtSecret);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid or expired token' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: dispute, error: disputeError } = await supabase
      .from('stripe_disputes')
      .select('id, merchant_id, stripe_dispute_id, stripe_charge_id, status')
      .eq('id', id)
      .single();

    if (disputeError || !dispute) {
      return NextResponse.json({ success: false, error: 'Dispute not found' }, { status: 404 });
    }

    // Authorize: derive the owning business from the disputed charge and require
    // `funds.move` (owner). Fall back to the dispute owner acting on their own records.
    let authorized = false;
    if (dispute.stripe_charge_id) {
      const { data: tx } = await supabase
        .from('stripe_transactions')
        .select('business_id')
        .eq('stripe_charge_id', dispute.stripe_charge_id)
        .maybeSingle();
      if (tx?.business_id) {
        const authz = await authorizeBusinessOwner(supabase, decoded.userId, tx.business_id, 'funds.move');
        if (!authz.ok) {
          return NextResponse.json(
            { success: false, error: authz.status === 404 ? 'Dispute not found' : authz.error },
            { status: authz.status }
          );
        }
        authorized = true;
      }
    }
    if (!authorized && dispute.merchant_id !== decoded.userId) {
      return NextResponse.json({ success: false, error: 'Dispute not found' }, { status: 404 });
    }

    if (!dispute.stripe_dispute_id) {
      return NextResponse.json({ success: false, error: 'Dispute has no Stripe reference' }, { status: 409 });
    }
    if (!ACTIONABLE_DISPUTE_STATUSES.has(String(dispute.status))) {
      return NextResponse.json(
        { success: false, error: `Evidence can no longer be submitted (status: ${dispute.status})` },
        { status: 409 }
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ success: false, error: 'Expected multipart/form-data' }, { status: 400 });
    }

    let stripe;
    try {
      stripe = await getStripe();
    } catch {
      return NextResponse.json({ success: false, error: 'Stripe is not configured' }, { status: 500 });
    }

    const evidence: Record<string, string> = {};
    for (const field of TEXT_FIELDS) {
      const value = form.get(field);
      if (typeof value === 'string' && value.trim()) {
        evidence[field] = value.trim();
      }
    }

    // Upload each attached file to Stripe and reference it in the evidence.
    for (const field of FILE_FIELDS) {
      const entry = form.get(field);
      if (!entry || typeof entry === 'string') continue;
      const file = entry as File;
      if (file.size === 0) continue;
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { success: false, error: `${file.name || field} exceeds the 5 MB limit` },
          { status: 400 }
        );
      }
      if (file.type && !ALLOWED_FILE_TYPES.has(file.type)) {
        return NextResponse.json(
          { success: false, error: `${file.name || field} must be a PDF, PNG, or JPEG` },
          { status: 400 }
        );
      }
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const uploaded = await stripe.files.create({
          purpose: 'dispute_evidence',
          file: {
            data: buffer,
            name: file.name || `${field}.bin`,
            type: file.type || 'application/octet-stream',
          },
        });
        evidence[field] = uploaded.id;
      } catch (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : 'File upload failed';
        console.error('Dispute evidence file upload error:', message);
        return NextResponse.json({ success: false, error: message }, { status: 502 });
      }
    }

    if (Object.keys(evidence).length === 0) {
      return NextResponse.json(
        { success: false, error: 'Provide at least one piece of evidence' },
        { status: 400 }
      );
    }

    // `submit: false` saves a draft; the client sends submit=true to finalize.
    const submit = String(form.get('submit') ?? 'true') !== 'false';

    let updated;
    try {
      updated = await stripe.disputes.update(dispute.stripe_dispute_id, { evidence, submit });
    } catch (stripeError) {
      const message = stripeError instanceof Error ? stripeError.message : 'Stripe evidence submission failed';
      console.error('Stripe dispute evidence error:', message);
      return NextResponse.json({ success: false, error: message }, { status: 502 });
    }

    const newStatus = updated?.status || dispute.status;
    await supabase
      .from('stripe_disputes')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', dispute.id);

    return NextResponse.json({
      success: true,
      dispute: { id: dispute.id, status: newStatus, submitted: submit },
    });
  } catch (error) {
    console.error('Submit dispute evidence error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
