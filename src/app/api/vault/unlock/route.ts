import { NextRequest, NextResponse } from 'next/server';
import { unlockVault, vaultErrorBody } from '@/lib/vault/vault-service';
import { vaultMerchant } from '@/lib/vault/route-auth';

/**
 * POST /api/vault/unlock  { data_key: base64(32 bytes), ttl_hours?: number }
 *
 * The data key is derived where the passphrase is (browser or CLI: PBKDF2 600k
 * + HKDF unwraps it from the record GET /api/vault returns). The passphrase is
 * never sent. The unlock lives in this server's memory only, for ttl_hours
 * (default 8, max 168), until POST /api/vault/lock or a restart.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const who = await vaultMerchant(request);
  if (who instanceof NextResponse) return who;
  let body: { data_key?: string; ttl_hours?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const ttlMs = typeof body.ttl_hours === 'number' ? body.ttl_hours * 3600_000 : null;
  try {
    const { expiresAt } = await unlockVault('merchant', who.merchantId, body.data_key ?? '', ttlMs);
    return NextResponse.json({ success: true, unlocked: true, expiresAt });
  } catch (err) {
    const v = vaultErrorBody(err);
    if (v) return NextResponse.json(v.body, { status: v.status });
    // Wrong key / malformed: never echo anything derived from the key.
    const message = err instanceof Error && /Wrong key|data_key/.test(err.message) ? err.message : 'Could not unlock';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
