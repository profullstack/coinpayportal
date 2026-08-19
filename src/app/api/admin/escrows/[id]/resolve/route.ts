import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { resolveDispute } from '@/lib/escrow/service';

/**
 * POST /api/admin/escrows/[id]/resolve — arbitrate a disputed escrow.
 *
 * ESC-NEW-01: `dispute_resolution` and `dispute_status` existed in the schema
 * with no writer anywhere, and a disputed escrow had no exit. Release required
 * the depositor — the party who had just been disputed against, or who had just
 * disputed — and refund required `funded`, so raising a dispute *removed* the
 * refund path. Whoever raised one made their own position worse and the escrow
 * sat until somebody gave up.
 *
 * Admin-gated on purpose. The two parties disagree by definition, so neither
 * can be the one who decides; the platform is the arbiter of record, which is
 * the role `arbiter_address` names for the multisig model. `requireAdmin` is
 * the whole security boundary here — this moves other people's money.
 *
 * Body: `{ "resolution": "release" | "refund", "note": "..." }`
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const resolution = body?.resolution;
  const note = typeof body?.note === 'string' ? body.note : '';

  if (resolution !== 'release' && resolution !== 'refund') {
    return NextResponse.json(
      { success: false, error: "resolution must be 'release' or 'refund'" },
      { status: 400 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const result = await resolveDispute(supabase, id, {
    resolution,
    note,
    // Recorded as the actor on the event, so an arbitration is always
    // attributable to a person rather than to "system".
    resolvedBy: guard.email ?? guard.id,
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  console.log(
    `[Admin] Escrow ${id} dispute resolved as ${resolution} by ${guard.email ?? guard.id}`
  );

  return NextResponse.json({ success: true, escrow: result.escrow });
}
