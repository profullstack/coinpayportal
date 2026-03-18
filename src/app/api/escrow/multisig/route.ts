/**
 * POST /api/escrow/multisig — Create a new multisig escrow
 * GET  /api/escrow/multisig — Get a multisig escrow by ID (query param)
 *
 * Non-custodial 2-of-3 multisig escrow.
 * CoinPay is a dispute mediator and co-signer — never a custodian.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
<<<<<<< HEAD
=======
import { authenticateRequest } from '@/lib/auth/middleware';
>>>>>>> feat/multisig-escrow
import {
  createMultisigEscrow,
  getMultisigEscrow,
  createMultisigEscrowSchema,
  isMultisigEnabled,
} from '@/lib/multisig';
<<<<<<< HEAD
import { requireMultisigAuth } from './auth';
=======
>>>>>>> feat/multisig-escrow

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

<<<<<<< HEAD
    const auth = await requireMultisigAuth(request);
    if (!auth.ok) return auth.response;

    const supabase = getSupabase();
=======
    const supabase = getSupabase();

    // Authentication required
    const authHeader = request.headers.get('authorization');
    const apiKeyHeader = request.headers.get('x-api-key');

    if (!authHeader && !apiKeyHeader) {
      return NextResponse.json(
        { error: 'Authentication required. Provide Authorization header or X-API-Key.' },
        { status: 401 },
      );
    }

    try {
      const authResult = await authenticateRequest(supabase, authHeader || apiKeyHeader);
      if (!authResult.success) {
        return NextResponse.json(
          { error: 'Invalid or expired authentication' },
          { status: 401 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 401 },
      );
    }

>>>>>>> feat/multisig-escrow
    const body = await request.json();

    // Validate input
    const parsed = createMultisigEscrowSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0].message },
        { status: 400 },
      );
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

    return NextResponse.json(result.escrow);
  } catch (error) {
    console.error('Failed to get multisig escrow:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
