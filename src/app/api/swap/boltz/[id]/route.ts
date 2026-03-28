import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSwapStatus } from '@/lib/swap/boltz';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
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
    const txHash = status.transaction?.id || undefined;
    
    // First get existing provider_data to merge
    const { data: existing } = await supabase
      .from('swaps')
      .select('provider_data')
      .eq('id', id)
      .eq('provider', 'boltz')
      .single();

    const providerData = {
      ...(existing?.provider_data || {}),
      boltz_status: status.status,
      ...(txHash ? { deposit_tx_hash: txHash } : {}),
    };

    await supabase
      .from('swaps')
      .update({
        status: dbStatus,
        deposit_tx_hash: txHash,
        provider_data: providerData,
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
