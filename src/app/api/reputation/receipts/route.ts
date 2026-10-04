import { NextRequest, NextResponse } from 'next/server';
import { isValidDid } from '@/lib/reputation/crypto';
import { createServiceClient } from '@/lib/supabase/service-client';

function getSupabase() {
  return createServiceClient();
}

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const did = request.nextUrl.searchParams.get('did');

    if (!did || !isValidDid(did)) {
      return NextResponse.json({ success: false, error: 'Valid DID parameter required' }, { status: 400 });
    }

    // Public projection, not `select('*')`.
    //
    // This endpoint is unauthenticated by design — a reputation graph is only
    // useful if a counterparty can check it before transacting. What it must
    // not do is hand out the whole row for any DID a caller names: `amount`,
    // `escrow_tx` and `buyer_did` together expose what an agent was paid, by
    // whom, and the on-chain transaction to look up, for every job they have
    // ever done. That is a commercial intelligence feed on any competitor,
    // free and unauthenticated.
    //
    // What a trust decision actually needs is the shape of the history: how
    // many jobs, in what categories, with what outcomes, and whether any were
    // disputed. Those are below. Amounts, counterparties and settlement
    // transactions are not.
    const { data: receipts, error } = await supabase
      .from('reputation_receipts')
      .select(
        'receipt_id, agent_did, category, action_category, action_type, ' +
        'outcome, dispute, currency, created_at, finalized_at'
      )
      .eq('agent_did', did)
      .order('created_at', { ascending: false })
      // A DID with a long history could otherwise return an unbounded response.
      .limit(200);

    if (error) {
      console.error('Receipts fetch error:', error);
      return NextResponse.json({ success: false, error: 'Failed to fetch receipts' }, { status: 500 });
    }

    return NextResponse.json({ success: true, receipts: receipts || [] });
  } catch (error) {
    console.error('Receipts fetch error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
