import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { verifyToken } from '@/lib/auth/jwt';
import { getBusinessCollectionPayment } from '@/lib/payments/business-collection';

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
 * GET /api/business-collection/[id]
 * Get a specific business collection payment
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // Get payment ID from params
    const { id: paymentId } = await params;
    if (!paymentId) {
      return NextResponse.json(
        { error: 'Payment ID is required' },
        { status: 400 }
      );
    }

    // Create Supabase client
    const supabase = await createServerClient();

    // Get the payment
    const result = await getBusinessCollectionPayment(supabase, paymentId, merchantId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      payment: {
        id: result.payment!.id,
        business_id: result.payment!.businessId,
        payment_address: result.payment!.paymentAddress,
        amount: result.payment!.amount,
        currency: result.payment!.currency,
        blockchain: result.payment!.blockchain,
        destination_wallet: result.payment!.destinationWallet,
        status: result.payment!.status,
        description: result.payment!.description,
        metadata: result.payment!.metadata,
        expires_at: result.payment!.expiresAt,
        created_at: result.payment!.createdAt,
      },
    });
  } catch (error) {
    console.error('Error getting business collection payment:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}