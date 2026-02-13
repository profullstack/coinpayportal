import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';

/**
 * GET /api/stripe/disputes/[id]
 * Get detailed information about a single dispute
 */
export async function GET(request: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  try {
    const { id } = params;

    // Get token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    
    // Verify token
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    let decoded;
    try {
      decoded = verifyToken(token, jwtSecret);
    } catch (error) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const merchantId = decoded.userId;

    // Create Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch dispute
    const { data: dispute, error } = await supabase
      .from('stripe_disputes')
      .select(`
        id,
        stripe_dispute_id,
        stripe_charge_id,
        amount,
        currency,
        status,
        reason,
        evidence_due_by,
        created_at,
        updated_at
      `)
      .eq('id', id)
      .eq('merchant_id', merchantId)
      .single();

    if (error || !dispute) {
      return NextResponse.json(
        { success: false, error: 'Dispute not found' },
        { status: 404 }
      );
    }

    // Try to get related transaction info
    let transactionInfo = null;
    if (dispute.stripe_charge_id) {
      const { data: transaction } = await supabase
        .from('stripe_transactions')
        .select(`
          id,
          business_id,
          stripe_payment_intent_id,
          businesses (
            name
          )
        `)
        .eq('stripe_charge_id', dispute.stripe_charge_id)
        .eq('merchant_id', merchantId)
        .single();

      if (transaction) {
        const businesses = transaction.businesses;
        let businessName = 'Unknown';
        if (businesses) {
          if (Array.isArray(businesses) && businesses.length > 0) {
            businessName = businesses[0]?.name || 'Unknown';
          } else if (typeof businesses === 'object' && 'name' in businesses) {
            businessName = (businesses as { name: string }).name || 'Unknown';
          }
        }

        transactionInfo = {
          id: transaction.id,
          business_id: transaction.business_id,
          business_name: businessName,
          stripe_payment_intent_id: transaction.stripe_payment_intent_id,
        };
      }
    }

    const transformedDispute = {
      id: dispute.id,
      stripe_dispute_id: dispute.stripe_dispute_id,
      stripe_charge_id: dispute.stripe_charge_id,
      amount_cents: dispute.amount || 0,
      amount_usd: ((dispute.amount || 0) / 100).toFixed(2), // Convert cents to dollars
      currency: dispute.currency || 'usd',
      status: dispute.status,
      reason: dispute.reason,
      evidence_due_by: dispute.evidence_due_by,
      created_at: dispute.created_at,
      updated_at: dispute.updated_at,
      related_transaction: transactionInfo,
    };

    return NextResponse.json(
      { success: true, dispute: transformedDispute },
      { status: 200 }
    );
  } catch (error) {
    console.error('Get dispute error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}