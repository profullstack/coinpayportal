import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { OPERATOR_SUBJECT_ID, vaultErrorBody, verifyVaultKey } from '@/lib/vault/vault-service';
import { lockOperatorKeys } from '@/lib/wallets/operator-keys';

/**
 * POST /api/admin/operator-vault/lock  { data_key }
 *
 * Forget the operator keys now; forwarding pauses. Locking stops customer
 * payments, so it needs the passphrase: the browser derives the data key and
 * this checks it opens the vault before locking.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  let body: { data_key?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body: no key
  }
  if (!body.data_key) {
    return NextResponse.json({ success: false, error: 'Enter the passphrase to lock' }, { status: 400 });
  }
  try {
    await verifyVaultKey('operator', OPERATOR_SUBJECT_ID, body.data_key);
  } catch (err) {
    const v = vaultErrorBody(err);
    if (v) return NextResponse.json(v.body, { status: v.status });
    const msg = err instanceof Error ? err.message : '';
    return NextResponse.json({ success: false, error: /Wrong key/i.test(msg) ? 'Wrong passphrase' : msg || 'Could not verify' }, { status: 400 });
  }
  const wasUnlocked = lockOperatorKeys();
  console.log(`[operator-vault] locked by admin ${guard.id}`);
  return NextResponse.json({ success: true, unlocked: false, wasUnlocked });
}
