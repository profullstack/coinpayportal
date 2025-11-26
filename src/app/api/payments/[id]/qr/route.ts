import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPayment } from '@/lib/payments/service';
import { generatePaymentQR } from '@/lib/qr/generator';

/**
 * GET /api/payments/[id]/qr
 * Get payment QR code
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const result = await getPayment(supabase, id);

    if (!result.success || !result.payment) {
      return NextResponse.json(
        { success: false, error: 'Payment not found' },
        { status: 404 }
      );
    }

    const payment = result.payment;

    // Generate QR code
    const qrCode = await generatePaymentQR({
      blockchain: payment.blockchain as any,
      address: payment.payment_address || payment.merchant_wallet_address,
      amount: payment.crypto_amount || 0,
    });

    return NextResponse.json(
      { success: true, qr_code: qrCode },
      { status: 200 }
    );
  } catch (error) {
    console.error('Get payment QR error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}