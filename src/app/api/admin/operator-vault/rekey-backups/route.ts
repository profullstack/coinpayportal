import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { OPERATOR_SUBJECT_ID, verifyVaultKey } from '@/lib/vault/vault-service';
import { dropRekeyBackup, listRekeyBackups, restoreRekeyBackup } from '@/lib/wallets/operator-keys';

/**
 * Re-key backups: the restore path with an OLD passphrase.
 *
 * GET   the retired vaults, each with its record (ciphertext, for the browser
 *       to unwrap with the old passphrase) and how many values it backs up.
 * POST  { action: 'restore', retired_vault, data_key }  data key of the OLD vault
 *       { action: 'drop', retired_vault, data_key }     data key of the CURRENT
 *       vault, so dropping the restore path needs the current passphrase.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  const backups = await listRekeyBackups();
  const { data } = await getSupabaseAdmin()
    .from('secret_vaults')
    .select('subject_id, record, updated_at')
    .eq('subject_type', 'operator')
    .like('subject_id', `${OPERATOR_SUBJECT_ID}:retired:%`);
  const retired = (data ?? []).map((r) => ({
    retired_vault: r.subject_id as string,
    retired_at: r.updated_at as string,
    record: r.record,
    values: backups.find((b) => b.retiredVault === r.subject_id)?.values ?? 0,
  }));
  return NextResponse.json({ success: true, retired }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  let body: { action?: string; retired_vault?: string; data_key?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const retired = String(body.retired_vault ?? '');
  try {
    if (body.action === 'restore') {
      const out = await restoreRekeyBackup(retired, body.data_key ?? '');
      console.log(`[operator-vault] restore of ${retired} by admin ${guard.id}: ${JSON.stringify(out)}`);
      return NextResponse.json({ success: true, ...out });
    }
    if (body.action === 'drop') {
      await verifyVaultKey('operator', OPERATOR_SUBJECT_ID, body.data_key ?? '');
      await dropRekeyBackup(retired);
      console.log(`[operator-vault] backup ${retired} dropped by admin ${guard.id}`);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ success: false, error: "action must be 'restore' or 'drop'" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ success: false, error: /Wrong key/i.test(msg) ? 'Wrong passphrase' : msg }, { status: 400 });
  }
}
