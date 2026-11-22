import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { migratePaypalSecretsToPlatform } from '@/lib/paypal/accounts';
import { getSupabaseAdmin } from '@/lib/supabase/server';

/**
 * POST /api/admin/paypal/platform-seal
 *
 * One-shot sweep: give every PayPal row whose secret can be opened right now
 * (legacy server-key rows, and rows whose owner's vault is unlocked in this
 * process) its platform-sealed copy, so PayPal checkout survives restarts.
 * Rows still waiting for an owner unlock are counted, never touched. The same
 * sweep runs for a merchant on every vault unlock (POST /api/vault/unlock).
 *
 * The response holds counts and business ids only, never anything derived from
 * a secret.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  try {
    const result = await migratePaypalSecretsToPlatform(getSupabaseAdmin());
    if (!result.configured) {
      return NextResponse.json({ success: false, error: 'PAYPAL_SECRETS_KEY is not configured', ...result }, { status: 503 });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[paypal] platform-seal sweep failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Sweep failed' }, { status: 500 });
  }
}
