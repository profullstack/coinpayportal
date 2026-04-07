/**
 * Derivation-family scoping for the system HD wallet.
 *
 * Lives in its own module (no ethers/bitcoinjs imports) so the unit tests
 * for this critical bug-fix can run without the broader system-wallet
 * import graph that triggers ethers→ws CommonJS/ESM interop failures.
 *
 * Background — the bug this guards against:
 *
 *   Every EVM cryptocurrency (ETH, POL, BNB, USDT, USDC, USDT_ETH,
 *   USDT_POL, USDC_ETH, USDC_POL) shares the same HD seed AND the same
 *   derivation path m/44'/60'/0'/0/i. So index `i` produces the SAME
 *   0x… address regardless of which chain the merchant chose.
 *
 *   The same is true for the Solana family (SOL, USDT_SOL, USDC_SOL)
 *   under m/44'/501'/i'/0'.
 *
 *   Previously system_wallet_indexes had one row per cryptocurrency, so
 *   the USDC_POL counter could sit at 0 while ETH was at 50. The next
 *   USDC_POL payment would derive an address already minted by ETH and
 *   crash on the unique_address constraint with "Failed to store payment
 *   address after retries — all derived addresses already exist".
 *
 *   Fix: key the counter by *family*, and on every collision fast-forward
 *   the family counter past the highest index already taken in any
 *   member cryptocurrency.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type SystemBlockchain =
  | 'BTC' | 'BCH' | 'ETH' | 'POL' | 'SOL'
  | 'DOGE' | 'XRP' | 'ADA' | 'BNB'
  | 'USDT' | 'USDT_ETH' | 'USDT_POL' | 'USDT_SOL'
  | 'USDC' | 'USDC_ETH' | 'USDC_POL' | 'USDC_SOL';

const ALL_CRYPTOS: SystemBlockchain[] = [
  'BTC', 'BCH', 'ETH', 'POL', 'SOL', 'DOGE', 'XRP', 'ADA', 'BNB',
  'USDT', 'USDT_ETH', 'USDT_POL', 'USDT_SOL',
  'USDC', 'USDC_ETH', 'USDC_POL', 'USDC_SOL',
];

export function getDerivationFamily(cryptocurrency: SystemBlockchain): string {
  switch (cryptocurrency) {
    case 'ETH':
    case 'POL':
    case 'BNB':
    case 'USDT':
    case 'USDC':
    case 'USDT_ETH':
    case 'USDT_POL':
    case 'USDC_ETH':
    case 'USDC_POL':
      return 'EVM';
    case 'SOL':
    case 'USDT_SOL':
    case 'USDC_SOL':
      return 'SOL';
    default:
      return cryptocurrency;
  }
}

export function getFamilyMembers(family: string): SystemBlockchain[] {
  return ALL_CRYPTOS.filter((c) => getDerivationFamily(c) === family);
}

/**
 * Find the highest derivation_index already minted in the cryptocurrency's
 * family. Returns -1 if no rows exist (so callers can use `result + 1` as
 * the next free index).
 */
export async function getMaxFamilyIndex(
  supabase: SupabaseClient,
  cryptocurrency: SystemBlockchain
): Promise<number> {
  const family = getDerivationFamily(cryptocurrency);
  const members = getFamilyMembers(family);

  const { data } = await supabase
    .from('payment_addresses')
    .select('derivation_index')
    .in('cryptocurrency', members)
    .order('derivation_index', { ascending: false })
    .limit(1);

  if (data && data.length > 0 && typeof data[0].derivation_index === 'number') {
    return data[0].derivation_index;
  }
  return -1;
}

/**
 * Atomically acquire the next free derivation index for a cryptocurrency's
 * family, using compare-and-swap on `system_wallet_indexes`.
 *
 * Returns the index that the caller should use to derive the address.
 * Throws on persistent failure so callers must wrap in try/catch.
 */
export async function acquireFamilyIndex(
  supabase: SupabaseClient,
  cryptocurrency: SystemBlockchain
): Promise<number> {
  const familyKey = getDerivationFamily(cryptocurrency);

  for (let attempt = 0; attempt < 10; attempt++) {
    const { data: indexData, error: indexError } = await supabase
      .from('system_wallet_indexes')
      .select('next_index')
      .eq('cryptocurrency', familyKey)
      .single();

    if (indexError || !indexData) {
      // Initialize the row, seeded past any pre-existing addresses in
      // the family so we don't immediately collide with them.
      const seed = await getMaxFamilyIndex(supabase, cryptocurrency);
      const { error: insertErr } = await supabase
        .from('system_wallet_indexes')
        .insert({ cryptocurrency: familyKey, next_index: seed + 2 });
      if (!insertErr) {
        return seed + 1;
      }
      // Conflict — another process created it. Retry the read.
      continue;
    }

    const candidate = indexData.next_index;
    const { data: swapped, error: casError } = await supabase
      .from('system_wallet_indexes')
      .update({ next_index: candidate + 1 })
      .eq('cryptocurrency', familyKey)
      .eq('next_index', candidate)
      .select('next_index')
      .single();

    if (!casError && swapped) {
      return candidate;
    }

    // CAS lost — another process moved the counter. Back off and retry.
    await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
  }

  throw new Error('Failed to acquire wallet index after retries — high contention');
}

/**
 * Fast-forward the family counter past `newIndex` (only forward, never
 * regress). Used after a unique-constraint collision to bump the global
 * counter so subsequent payments don't repeat the doomed index.
 */
export async function bumpFamilyIndex(
  supabase: SupabaseClient,
  cryptocurrency: SystemBlockchain,
  newIndex: number
): Promise<void> {
  const familyKey = getDerivationFamily(cryptocurrency);
  await supabase
    .from('system_wallet_indexes')
    .update({ next_index: newIndex + 1 })
    .eq('cryptocurrency', familyKey)
    .lt('next_index', newIndex + 1);
}
