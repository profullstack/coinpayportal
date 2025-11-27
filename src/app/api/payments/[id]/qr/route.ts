import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPayment } from '@/lib/payments/service';
import { generatePaymentQR } from '@/lib/qr/generator';

/**
 * GET /api/payments/[id]/qr
 * Get payment QR code as PNG image
 *
 * Returns the QR code as binary PNG image data.
 * Can be used directly as an <img> src.
 *
 * Example: <img src="/api/payments/abc123/qr" alt="Payment QR" />
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
      return new NextResponse('Server configuration error', { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const result = await getPayment(supabase, id);

    if (!result.success || !result.payment) {
      return new NextResponse('Payment not found', { status: 404 });
    }

    const payment = result.payment;
    
    // Get the address for the QR code
    const address = payment.payment_address || payment.merchant_wallet_address;
    if (!address) {
      return new NextResponse('No payment address available', { status: 400 });
    }

    // Generate QR code
    const qrCode = await generatePaymentQR({
      blockchain: payment.blockchain as any,
      address,
      amount: payment.crypto_amount || 0,
    });

    // Extract base64 data from data URL and return as binary PNG
    const base64Data = qrCode.replace(/^data:image\/png;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': imageBuffer.length.toString(),
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      },
    });
  } catch (error) {
    console.error('Get payment QR error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}