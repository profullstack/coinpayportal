import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { vaultErrorBody } from '@/lib/vault/vault-service';
import { unlockOperatorKeys } from '@/lib/wallets/operator-keys';
import { refillAddressPool } from '@/lib/wallets/address-pool';
import { deriveSystemPaymentAddress } from '@/lib/wallets/system-wallet';

/**
 * POST /api/admin/operator-vault/unlock  { data_key, ttl_hours? (default/max 168) }
 *
 * The data key is derived where the passphrase is (admin page or
 * scripts/operator-vault-unlock.mts). The mnemonics stay in this process's
 * memory until the TTL, a lock, or a restart. Forwarding parked while locked
 * resumes from the retry queue; the deposit-address pool is topped up.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  let body: { data_key?: string; ttl_hours?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const ttlMs = typeof body.ttl_hours === 'number' ? body.ttl_hours * 3600_000 : null;
  try {
    const { expiresAt, names } = await unlockOperatorKeys(body.data_key ?? '', ttlMs);
    console.log(`[operator-vault] unlocked by admin ${guard.id} until ${expiresAt}`);
    // Top the pool up in the background; never blocks the unlock.
    void refillAddressPool(getSupabaseAdmin(), (c, i) => deriveSystemPaymentAddress(c, i))
      .then((added) => console.log('[operator-vault] address pool refilled', JSON.stringify(added)))
      .catch((err) => console.error('[operator-vault] pool refill failed', err instanceof Error ? err.message : err));
    return NextResponse.json({ success: true, unlocked: true, expiresAt, names });
  } catch (err) {
    const v = vaultErrorBody(err);
    if (v) return NextResponse.json(v.body, { status: v.status });
    const message = err instanceof Error && /Wrong key|data_key|sealed|retired/i.test(err.message) ? err.message : 'Could not unlock';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
