import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSwapStatus } from '@/lib/swap/boltz';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'
);

const BOLTZ_TO_DB_STATUS: Record<string, string> = {
  'swap.created': 'pending',
  'transaction.mempool': 'processing',
  'transaction.confirmed': 'processing',
  'invoice.paid': 'processing',
  'invoice.pending': 'processing',
  'transaction.claimed': 'settled',
  'invoice.settled': 'settled',
  'swap.expired': 'expired',
  'transaction.failed': 'failed',
  'transaction.lockupFailed': 'failed',
  'invoice.failedToPay': 'failed',
  'transaction.refunded': 'refunded',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const status = await getSwapStatus(id);

    // Update DB status
    const dbStatus = BOLTZ_TO_DB_STATUS[status.status] || status.status;
    await supabase
      .from('swaps')
      .update({
        status: dbStatus,
        deposit_tx_hash: status.transaction?.id || undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('provider', 'boltz');

    return NextResponse.json({ success: true, ...status });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to get swap status' },
      { status: 500 },
    );
  }
}
