import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { vaultErrorBody } from '@/lib/vault/vault-service';
import { rekeyOperatorVault } from '@/lib/wallets/operator-keys';

/**
 * POST /api/admin/operator-vault/rekey  { record, data_key }
 *
 * Move every operator secret to a NEW vault (new key pair, new data key, new
 * passphrase) built in the browser; the passphrase never reaches us. Needs the
 * current vault unlocked. The old vault row and the old ciphertexts are kept
 * (operator_rekey_backup), so the old passphrase can restore until dropped.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  let body: { record?: unknown; data_key?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const result = await rekeyOperatorVault(body.record, body.data_key ?? '');
    console.log(`[operator-vault] re-keyed by admin ${guard.id}: ${JSON.stringify(result)}`);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const v = vaultErrorBody(err);
    if (v) return NextResponse.json(v.body, { status: v.status });
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Re-key failed' }, { status: 400 });
  }
}
