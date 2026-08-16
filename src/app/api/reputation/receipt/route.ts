import { NextRequest, NextResponse } from 'next/server';
import { submitReceipt } from '@/lib/reputation/receipt-service';
import { createServiceClient } from '@/lib/supabase/service-client';

function getSupabase() {
  return createServiceClient();
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const body = await request.json();
    const result = await submitReceipt(supabase, body);

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, receipt: result.receipt }, { status: 201 });
  } catch (error) {
    console.error('Receipt submission error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
