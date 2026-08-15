import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSwapStatus } from '@/lib/swap/boltz';
import { authorizeWallet } from '@/lib/swap/auth';

function getSupabase() {
  return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

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


/**
 * Confirm the authenticated wallet owns this swap.
 *
 * A swap id is handed to the payer and echoed in URLs, so possession of it is
 * not authorization to read or mutate the swap.
 */
async function requireSwapOwner(
  supabase: ReturnType<typeof getSupabase>,
  request: NextRequest,
  swapId: string,
  body?: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const auth = await authorizeWallet(supabase, request, body);
  if (!auth.ok) return auth;

  const { data: swap } = await supabase
    .from('swaps')
    .select('wallet_id')
    .eq('id', swapId)
    .single();

  if (!swap || swap.wallet_id !== auth.walletId) {
    // Same response for "no such swap" and "not yours", so the endpoint is not
    // an existence oracle for other wallets' swap ids.
    return { ok: false, status: 404, error: 'Swap not found' };
  }

  return { ok: true };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = getSupabase();
  try {
    const { id } = await params;

    const owner = await requireSwapOwner(supabase, request, id);
    if (!owner.ok) {
      return NextResponse.json({ success: false, error: owner.error }, { status: owner.status });
    }

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
