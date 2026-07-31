import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';
import { authorizeBusiness, listAccessibleBusinessIds } from '@/lib/auth/authz';
import {
  addRevision,
  generateAccessToken,
  nextProposalNumber,
} from '@/lib/proposals/service';

/**
 * GET /api/proposals
 * List proposals for every business the caller can read.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const auth = await resolveMerchant(supabase, request);
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const { merchantId, apiKeyBusinessId } = auth;

    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const status = searchParams.get('status');

    // The standing revision is fetched separately rather than embedded: the
    // embed would depend on PostgREST resolving the `proposals -> revisions`
    // FK by constraint name, and a rename there would silently 500 the list.
    let query = supabase
      .from('proposals')
      .select(`
        *,
        clients (id, name, email, company_name),
        businesses (id, name)
      `)
      .order('created_at', { ascending: false });

    if (apiKeyBusinessId) {
      query = query.eq('business_id', apiKeyBusinessId);
    } else if (businessId) {
      const authz = await authorizeBusiness(supabase, merchantId, businessId, 'business.read');
      if (!authz.ok) {
        return NextResponse.json({ success: false, error: authz.error }, { status: authz.status });
      }
      query = query.eq('business_id', businessId);
    } else {
      const ids = await listAccessibleBusinessIds(supabase, merchantId);
      if (ids.length === 0) {
        return NextResponse.json({ success: true, proposals: [] });
      }
      query = query.in('business_id', ids);
    }

    if (status) query = query.eq('status', status);

    const { data: proposals, error } = await query;
    if (error) {
      console.error('List proposals error:', error);
      return NextResponse.json({ success: false, error: 'Failed to fetch proposals' }, { status: 500 });
    }

    const rows = proposals ?? [];
    const revisionIds = rows
      .map((p: { current_revision_id: string | null }) => p.current_revision_id)
      .filter((id: string | null): id is string => !!id);

    let byId = new Map<string, Record<string, unknown>>();
    if (revisionIds.length > 0) {
      const { data: revisions } = await supabase
        .from('proposal_revisions')
        .select('*')
        .in('id', revisionIds);
      byId = new Map((revisions ?? []).map((r: { id: string }) => [r.id, r]));
    }

    return NextResponse.json({
      success: true,
      proposals: rows.map((p: { current_revision_id: string | null }) => ({
        ...p,
        current_revision: p.current_revision_id ? byId.get(p.current_revision_id) ?? null : null,
      })),
    });
  } catch (error) {
    console.error('List proposals error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/proposals
 * Open a negotiation: creates the proposal plus its first revision (the offer).
 *
 * When `crypto_currency` is set the offer must name a payee. One is resolved
 * from the account (business wallet > global wallet > linked web wallet) and, if
 * nothing is determinable, the response is `PAYEE_REQUIRED` so the caller can
 * ask for it manually instead of creating an offer that settles nowhere.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const auth = await resolveMerchant(supabase, request);
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const { merchantId, apiKeyBusinessId } = auth;

    const body = await request.json();
    const {
      business_id,
      client_id,
      title,
      description,
      amount,
      currency,
      crypto_currency,
      merchant_wallet_address,
      terms,
      message,
      due_date,
      expires_at,
    } = body;

    const resolvedBusinessId: string | undefined = (() => {
      if (apiKeyBusinessId) {
        if (business_id && business_id !== apiKeyBusinessId) return undefined;
        return apiKeyBusinessId;
      }
      return business_id;
    })();

    if (!resolvedBusinessId || !title || !amount || Number(amount) <= 0) {
      return NextResponse.json(
        { success: false, error: 'business_id, title and a positive amount are required' },
        { status: 400 },
      );
    }

    if (!(apiKeyBusinessId && apiKeyBusinessId === resolvedBusinessId)) {
      const authz = await authorizeBusiness(supabase, merchantId, resolvedBusinessId, 'invoice.write');
      if (!authz.ok) {
        return NextResponse.json({ success: false, error: authz.error }, { status: authz.status });
      }
    }

    const { data: business } = await supabase
      .from('businesses')
      .select('id, merchant_id')
      .eq('id', resolvedBusinessId)
      .single();

    if (!business) {
      return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });
    }
    const ownerId = business.merchant_id ?? merchantId;

    const { data: proposal, error } = await supabase
      .from('proposals')
      .insert({
        user_id: ownerId,
        business_id: resolvedBusinessId,
        client_id: client_id || null,
        proposal_number: await nextProposalNumber(supabase, resolvedBusinessId),
        title,
        description: description || null,
        status: 'draft',
        access_token: generateAccessToken(),
        expires_at: expires_at || null,
      })
      .select('*')
      .single();

    if (error || !proposal) {
      console.error('Create proposal error:', error);
      return NextResponse.json(
        { success: false, error: error?.message || 'Failed to create proposal' },
        { status: 400 },
      );
    }

    const revisionResult = await addRevision(supabase, {
      proposal,
      party: 'merchant',
      actorMerchantId: merchantId,
      revision: {
        amount: Number(amount),
        currency,
        crypto_currency,
        merchant_wallet_address,
        terms,
        message,
        due_date,
      },
      eventType: 'created',
    });

    if (!revisionResult.ok) {
      // Roll the shell back so a rejected offer does not leave an empty,
      // un-numberable proposal behind.
      await supabase.from('proposals').delete().eq('id', proposal.id);
      return NextResponse.json(
        { success: false, error: revisionResult.error, code: revisionResult.code },
        { status: revisionResult.status },
      );
    }

    // `addRevision` already recorded the 'created' event for the opening offer.

    return NextResponse.json(
      {
        success: true,
        proposal: revisionResult.proposal,
        revision: revisionResult.revision,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Create proposal error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
