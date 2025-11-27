import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { verifyToken } from '@/lib/auth/jwt';
import {
  processConfirmedPayment,
  retryFailedForwarding,
  getForwardingStatus,
} from '@/lib/payments/forwarding';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

/**
 * POST /api/payments/[id]/forward
 * Manually trigger payment forwarding (admin only)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token, JWT_SECRET);

    if (!payload) {
      return NextResponse.json(
        { success: false, error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Get request body
    const body = await request.json().catch(() => ({}));
    const { privateKey, retry } = body;

    if (!privateKey) {
      return NextResponse.json(
        { success: false, error: 'Private key is required for forwarding' },
        { status: 400 }
      );
    }

    const { id: paymentId } = await params;

    // Check if this is a retry request
    let result;
    if (retry) {
      result = await retryFailedForwarding(supabaseAdmin, paymentId, privateKey);
    } else {
      result = await processConfirmedPayment(supabaseAdmin, paymentId, privateKey);
    }

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        merchantTxHash: result.merchantTxHash,
        platformTxHash: result.platformTxHash,
        merchantAmount: result.merchantAmount,
        platformFee: result.platformFee,
      },
    });
  } catch (error) {
    console.error('Payment forwarding error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Forwarding failed',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/payments/[id]/forward
 * Get forwarding status for a payment
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
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token, JWT_SECRET);

    if (!payload) {
      return NextResponse.json(
        { success: false, error: 'Invalid token' },
        { status: 401 }
      );
    }

    const { id: paymentId } = await params;

    const status = await getForwardingStatus(supabaseAdmin, paymentId);

    if (status.error) {
      return NextResponse.json(
        { success: false, error: status.error },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('Get forwarding status error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get status',
      },
      { status: 500 }
    );
  }
}