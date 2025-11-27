import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createPayment } from '@/lib/payments/service';
import { authenticateRequest, isMerchantAuth, isBusinessAuth } from '@/lib/auth/middleware';
import {
  withTransactionLimit,
  createEntitlementErrorResponse,
} from '@/lib/entitlements/middleware';
import { incrementTransactionCount } from '@/lib/entitlements/service';

/**
 * POST /api/payments/create
 * Create a new payment
 * 
 * Requires authentication via JWT token or API key.
 * Enforces transaction limits based on subscription plan.
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate request
    const authHeader = request.headers.get('authorization');
    const authResult = await authenticateRequest(supabase, authHeader);

    if (!authResult.success || !authResult.context) {
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      );
    }

    // Get merchant ID from auth context
    let merchantId: string;
    if (isMerchantAuth(authResult.context)) {
      merchantId = authResult.context.merchantId;
    } else if (isBusinessAuth(authResult.context)) {
      merchantId = authResult.context.merchantId;
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid authentication context' },
        { status: 401 }
      );
    }

    // Check transaction limit before creating payment
    const limitCheck = await withTransactionLimit(supabase, merchantId);
    if (!limitCheck.allowed) {
      if (limitCheck.error) {
        return createEntitlementErrorResponse(limitCheck.error);
      }
      return NextResponse.json(
        { 
          success: false, 
          error: 'Monthly transaction limit exceeded',
          usage: {
            current: limitCheck.currentUsage,
            limit: limitCheck.limit,
            remaining: limitCheck.remaining,
          }
        },
        { status: 429 }
      );
    }

    const body = await request.json();
    const result = await createPayment(supabase, body);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    // Increment transaction count after successful payment creation
    await incrementTransactionCount(supabase, merchantId);

    return NextResponse.json(
      { 
        success: true, 
        payment: result.payment,
        usage: {
          current: limitCheck.currentUsage + 1,
          limit: limitCheck.limit,
          remaining: limitCheck.remaining !== null ? limitCheck.remaining - 1 : null,
        }
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create payment error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}