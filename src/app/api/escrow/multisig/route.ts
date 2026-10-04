/**
 * POST /api/escrow/multisig — Create a new multisig escrow
 * GET  /api/escrow/multisig — Get a multisig escrow by ID (query param)
 *
 * Non-custodial 2-of-3 multisig escrow.
 * CoinPay is a dispute mediator and co-signer — never a custodian.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createMultisigEscrow,
  getMultisigEscrow,
  createMultisigEscrowSchema,
  isMultisigEnabled,
} from '@/lib/multisig';
import { requireMultisigAuth } from './auth';
import { verifyBusinessAccess } from '@/lib/wallets/supported-coins';
import { callerOwnsEscrow } from '@/lib/escrow/access';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/**
 * POST /api/escrow/multisig
 * Create a new 2-of-3 multisig escrow
 */
export async function POST(request: NextRequest) {
  try {
    if (!isMultisigEnabled()) {
      return NextResponse.json(
        { error: 'Multisig escrow is not enabled' },
        { status: 503 },
      );
    }

    const auth = await requireMultisigAuth(request);
    if (!auth.ok) return auth.response;

    const supabase = getSupabase();
    const body = await request.json();

    // Validate input
    const parsed = createMultisigEscrowSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0].message },
        { status: 400 },
      );
    }

    // The body's `business_id` is a claim, not an authorization. Check the
    // caller can act on it before it is persisted (F-1.1-04).
    const requestedBusinessId = (parsed.data as { business_id?: string }).business_id;
    if (requestedBusinessId) {
      if (auth.context.type === 'business') {
        if (auth.context.businessId !== requestedBusinessId) {
          return NextResponse.json(
            { error: 'This API key cannot create an escrow for that business' },
            { status: 403 },
          );
        }
      } else {
        const access = await verifyBusinessAccess(
          supabase,
          requestedBusinessId,
          auth.context.merchantId,
          'escrow.write',
        );
        if (!access.ok) {
          return NextResponse.json({ error: access.error }, { status: access.status ?? 403 });
        }
      }
    }

    const result = await createMultisigEscrow(supabase, parsed.data);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.escrow, { status: 201 });
  } catch (error) {
    console.error('Failed to create multisig escrow:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/escrow/multisig?id=<escrow_id>
 * Get a multisig escrow by ID
 */
export async function GET(request: NextRequest) {
  try {
    // F-1.1-03: this was unauthenticated, so possession of an escrow id — which
    // is handed to counterparties and echoed in URLs — exposed both parties'
    // pubkeys, the amount, the lockup address and the owning business_id.
    const auth = await requireMultisigAuth(request);
    if (!auth.ok) return auth.response;

    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const escrowId = searchParams.get('id');

    if (!escrowId) {
      return NextResponse.json(
        { error: 'id query parameter is required' },
        { status: 400 },
      );
    }

    const result = await getMultisigEscrow(supabase, escrowId);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    // Holding a credential is not the same as owning this escrow. 404 rather
    // than 403 so the endpoint is not an existence oracle for escrow ids.
    const allowed = await callerOwnsEscrow(supabase, auth.context, result.escrow as never);
    if (!allowed) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 });
    }

    return NextResponse.json(result.escrow);
  } catch (error) {
    console.error('Failed to get multisig escrow:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
