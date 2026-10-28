import { NextRequest, NextResponse } from 'next/server';
import { createVault, getVaultRecord, rewrapVault, unlockStatus } from '@/lib/vault/vault-service';
import { vaultMerchant } from '@/lib/vault/route-auth';
import { migrateLegacyMerchantSecrets } from '@/lib/vault/legacy-migration';

/**
 * GET  /api/vault  the merchant's vault record (ciphertext + KDF params, which
 *                  the browser/CLI needs to derive the data key) and unlock status.
 * POST /api/vault  create it: { record }. The record is built client-side
 *                  (src/lib/vault/sealed-vault.ts createVault); the passphrase
 *                  never reaches us. Existing secrets under the old server key
 *                  are re-sealed to the new vault right away.
 * PUT  /api/vault  change the passphrase: { record, data_key }.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const who = await vaultMerchant(request);
  if (who instanceof NextResponse) return who;
  const record = await getVaultRecord('merchant', who.merchantId);
  return NextResponse.json(
    // subject_id is the AAD the client binds the vault to.
    { success: true, subject_id: who.merchantId, exists: !!record, record, ...unlockStatus('merchant', who.merchantId) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  const who = await vaultMerchant(request);
  if (who instanceof NextResponse) return who;
  let body: { record?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    await createVault('merchant', who.merchantId, body.record);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not create the vault';
    return NextResponse.json({ success: false, error: message }, { status: /exists/.test(message) ? 409 : 400 });
  }
  const migrated = await migrateLegacyMerchantSecrets(who.merchantId).catch((err) => {
    console.error('[vault] legacy re-seal failed', err instanceof Error ? err.message : err);
    return null;
  });
  return NextResponse.json({ success: true, migrated }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const who = await vaultMerchant(request);
  if (who instanceof NextResponse) return who;
  let body: { record?: unknown; data_key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    await rewrapVault('merchant', who.merchantId, body.record, body.data_key ?? '');
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Could not update the vault' }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
