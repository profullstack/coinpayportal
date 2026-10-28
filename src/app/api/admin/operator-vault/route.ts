import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { createVault, getVaultRecord, OPERATOR_SUBJECT_ID, rewrapVault, unlockStatus } from '@/lib/vault/vault-service';
import {
  collectEnvMnemonics,
  refreshOperatorState,
  resealLegacyPaymentAddressKeys,
  sealEnvMnemonics,
  SYSTEM_MNEMONICS_ROW,
} from '@/lib/wallets/operator-keys';

/**
 * Operator vault for CoinPay's own SYSTEM_MNEMONIC_* (admin only).
 *
 * GET   status: vault record (ciphertext + KDF params for the browser/CLI),
 *       unlock state, whether the mnemonics are sealed, which SYSTEM_MNEMONIC_*
 *       names are still in the environment, and the address pool level.
 * POST  { record } create the vault (built client-side; the passphrase never
 *       reaches us), seal the current env mnemonics to it, and re-seal every
 *       legacy deposit-address key. After this, remove SYSTEM_MNEMONIC_* from
 *       app.env and the logicsrc vault and redeploy.
 * PUT   { record, data_key } change the passphrase.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  const supabase = getSupabaseAdmin();
  const record = await getVaultRecord('operator', OPERATOR_SUBJECT_ID);
  const { sealed } = await refreshOperatorState(true);
  const { data: pool } = await supabase.from('operator_address_pool').select('cryptocurrency').is('claimed_at', null);
  const poolCounts: Record<string, number> = {};
  for (const r of pool ?? []) poolCounts[r.cryptocurrency as string] = (poolCounts[r.cryptocurrency as string] ?? 0) + 1;
  const { data: bundle } = await supabase.from('operator_sealed_secrets').select('meta, updated_at').eq('name', SYSTEM_MNEMONICS_ROW).maybeSingle();
  return NextResponse.json(
    {
      success: true,
      subject_id: OPERATOR_SUBJECT_ID,
      exists: !!record,
      record,
      sealed,
      sealed_names: (bundle?.meta as { names?: string[] } | null)?.names ?? [],
      sealed_at: bundle?.updated_at ?? null,
      env_mnemonic_names: Object.keys(collectEnvMnemonics()).sort(),
      pool: poolCounts,
      ...unlockStatus('operator', OPERATOR_SUBJECT_ID),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  let body: { record?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    await createVault('operator', OPERATOR_SUBJECT_ID, body.record);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not create the vault';
    return NextResponse.json({ success: false, error: message }, { status: /exists/.test(message) ? 409 : 400 });
  }
  let sealedNames: string[] = [];
  try {
    sealedNames = (await sealEnvMnemonics()).sealed;
  } catch (err) {
    return NextResponse.json(
      { success: false, error: `Vault created, but sealing the mnemonics failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 },
    );
  }
  const resealed = await resealLegacyPaymentAddressKeys().catch((err) => {
    console.error('[operator-vault] legacy address key re-seal failed', err instanceof Error ? err.message : err);
    return null;
  });
  console.log(`[operator-vault] set up by admin ${guard.id}: sealed ${sealedNames.length} mnemonics`);
  return NextResponse.json({ success: true, sealed: sealedNames, resealed }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  let body: { record?: unknown; data_key?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    await rewrapVault('operator', OPERATOR_SUBJECT_ID, body.record, body.data_key ?? '');
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Could not update the vault' }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
