import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { verifyToken } from '@/lib/auth/jwt';
import { getForwardingStatus } from '@/lib/payments/forwarding';
import { forwardPaymentSecurely, retryForwardingSecurely } from '@/lib/wallets/secure-forwarding';
import { getJwtSecret, getSecret } from '@/lib/secrets';

/**
 * Verify if the request is from an internal service (monitor function)
 */
function isInternalRequest(authHeader: string | null): boolean {
  const internalApiKey = getSecret('INTERNAL_API_KEY') || process.env.INTERNAL_API_KEY;
  if (!internalApiKey) return false;
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.substring(7) === internalApiKey;
}

/**
 * POST /api/payments/[id]/forward
 * Trigger payment forwarding
 *
 * Authentication:
 * - Internal API key (for automated forwarding from monitor)
 * - Admin JWT token (for manual forwarding)
 *
 * SECURITY: Private keys are NEVER accepted via API.
 * Keys are retrieved from encrypted storage server-side only.
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

    // Check if this is an internal request (from monitor function)
    const isInternal = isInternalRequest(authHeader);
    
    if (!isInternal) {
      // For non-internal requests, verify JWT and admin access
      const token = authHeader.substring(7);
      const payload = verifyToken(token, getJwtSecret());

      if (!payload) {
        return NextResponse.json(
          { success: false, error: 'Invalid token' },
          { status: 401 }
        );
      }

      // Verify admin access
      const { data: merchant, error: merchantError } = await supabaseAdmin
        .from('merchants')
        .select('is_admin')
        .eq('id', payload.sub)
        .single();

      if (merchantError || !merchant?.is_admin) {
        return NextResponse.json(
          { success: false, error: 'Admin access required for manual forwarding' },
          { status: 403 }
        );
      }
    }

    // Get request body (only for retry flag, NO private keys accepted)
    const body = await request.json().catch(() => ({}));
    const { retry } = body;

    // SECURITY: Reject any request that attempts to send a private key
    if (body.privateKey || body.private_key || body.key) {
      console.warn(`Security: Rejected attempt to send private key via API for payment ${(await params).id}`);
      return NextResponse.json(
        {
          success: false,
          error: 'Private keys cannot be sent via API. Keys are managed securely server-side.'
        },
        { status: 400 }
      );
    }

    const { id: paymentId } = await params;

    // Use secure forwarding that retrieves encrypted keys from database
    let result;
    if (retry) {
      result = await retryForwardingSecurely(supabaseAdmin, paymentId);
    } else {
      result = await forwardPaymentSecurely(supabaseAdmin, paymentId);
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
    const payload = verifyToken(token, getJwtSecret());

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