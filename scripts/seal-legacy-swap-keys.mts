#!/usr/bin/env npx tsx
/**
 * Re-seal legacy Boltz swap keys to each owning wallet's secp256k1 public key.
 *
 * Legacy rows hold `enc:` blobs under ENCRYPTION_KEY (or plaintext from before
 * that). Sealing to the wallet's PUBLIC key needs no user present, so this can
 * migrate every row in one pass. The recovery route does the same per row on
 * demand; this script just finishes the job.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/seal-legacy-swap-keys.mts --count     # counts only, no key needed
 *   ENCRYPTION_KEY=... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/seal-legacy-swap-keys.mts --apply
 *
 * Never prints key material. Rows whose wallet has no secp256k1 key are left
 * untouched and counted.
 */
import { createClient } from '@supabase/supabase-js';
import { hasLegacyProviderSecrets, resealLegacyProviderSecrets } from '../src/lib/swap/legacy-reseal';
import { SWAP_SEAL_VERSION } from '../src/lib/swap/sealed-keys';

const apply = process.argv.includes('--apply');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const counts = { boltz_rows: 0, legacy: 0, sealed: 0, no_wallet_key: 0, failed: 0 };
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('swaps')
      .select('id, wallet_id, provider_data')
      .eq('provider', 'boltz')
      .order('id')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const row of data) {
      counts.boltz_rows++;
      const pd = (row.provider_data ?? {}) as Record<string, unknown>;
      if (!hasLegacyProviderSecrets(pd)) continue;
      counts.legacy++;
      if (!apply) continue;
      const { data: w } = await supabase.from('wallets').select('public_key_secp256k1').eq('id', row.wallet_id).single();
      const pub = (w as { public_key_secp256k1?: string | null } | null)?.public_key_secp256k1;
      if (!pub) { counts.no_wallet_key++; continue; }
      try {
        const r = await resealLegacyProviderSecrets(pd, { walletId: row.wallet_id, swapId: row.id, walletPublicKey: pub });
        if (!r.ok) { counts.failed++; continue; }
        const { error: upd } = await supabase
          .from('swaps')
          .update({ provider_data: r.providerData, seal_version: SWAP_SEAL_VERSION })
          .eq('id', row.id);
        if (upd) counts.failed++; else counts.sealed++;
      } catch {
        counts.failed++;
      }
    }
    if (data.length < pageSize) break;
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'count', ...counts }));
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
