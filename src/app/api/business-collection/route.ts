import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { verifyToken } from '@/lib/auth/jwt';
import {
  createBusinessCollectionPayment,
  listBusinessCollectionPayments,
  type BusinessCollectionInput,
} from '@/lib/payments/business-collection';
import {
  withTransactionLimit,
  EntitlementError,
  createEntitlementErrorResponse,
} from '@/lib/entitlements/middleware';
import { incrementTransactionCount } from '@/lib/entitlements/service';

/**
 * Get JWT secret from environment
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
}

/**
 * POST /api/business-collection
 * Create a new business collection payment
 * 
 * This creates a payment that forwards 100% of received funds
 * to the platform's collection wallet.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.slice(7);
    let payload: any;
    try {
      payload = verifyToken(token, getJwtSecret());
    } catch {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const merchantId = payload.sub || payload.userId;
    if (!merchantId) {
      return NextResponse.json(
        { error: 'Invalid token payload' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { business_id, amount, currency, blockchain, description, metadata } = body;

    // Validate required fields
    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: 'amount must be greater than zero' },
        { status: 400 }
      );
    }

    if (!blockchain) {
      return NextResponse.json(
        { error: 'blockchain is required' },
        { status: 400 }
      );
    }

    // Create Supabase client
    const supabase = await createServerClient();

    // Check transaction limit before creating payment
    const limitCheck = await withTransactionLimit(supabase, merchantId);
    if (!limitCheck.allowed) {
      if (limitCheck.error) {
        return createEntitlementErrorResponse(limitCheck.error);
      }
      return NextResponse.json(
        { error: 'Transaction limit exceeded' },
        { status: 429 }
      );
    }

    // Create the collection payment
    const input: BusinessCollectionInput = {
      businessId: business_id,
      merchantId,
      amount,
      currency: currency || 'USD',
      blockchain,
      description,
      metadata,
    };

    const result = await createBusinessCollectionPayment(supabase, input);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    // Increment transaction count after successful payment creation
    await incrementTransactionCount(supabase, merchantId);

    return NextResponse.json({
      success: true,
      payment: {
        id: result.payment!.id,
        payment_address: result.payment!.paymentAddress,
        amount: result.payment!.amount,
        currency: result.payment!.currency,
        blockchain: result.payment!.blockchain,
        destination_wallet: result.payment!.destinationWallet,
        status: result.payment!.status,
        description: result.payment!.description,
        expires_at: result.payment!.expiresAt,
        created_at: result.payment!.createdAt,
      },
    });
  } catch (error) {
    console.error('Error creating business collection payment:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/business-collection
 * List business collection payments for the authenticated merchant
 */
export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.slice(7);
    let payload: any;
    try {
      payload = verifyToken(token, getJwtSecret());
    } catch {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const merchantId = payload.sub || payload.userId;
    if (!merchantId) {
      return NextResponse.json(
        { error: 'Invalid token payload' },
        { status: 401 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id') || undefined;
    const status = searchParams.get('status') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Create Supabase client
    const supabase = await createServerClient();

    // List payments
    const result = await listBusinessCollectionPayments(supabase, merchantId, {
      businessId,
      status,
      limit,
      offset,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      payments: result.payments?.map((p) => ({
        id: p.id,
        business_id: p.businessId,
        payment_address: p.paymentAddress,
        amount: p.amount,
        currency: p.currency,
        blockchain: p.blockchain,
        destination_wallet: p.destinationWallet,
        status: p.status,
        description: p.description,
        expires_at: p.expiresAt,
        created_at: p.createdAt,
      })),
      total: result.total,
    });
  } catch (error) {
    console.error('Error listing business collection payments:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}