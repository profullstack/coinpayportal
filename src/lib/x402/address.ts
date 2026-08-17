/**
 * Address normalisation for the x402 facilitator.
 *
 * `/api/x402/verify` recorded the payee as `payload.to.toLowerCase()` and
 * `/api/x402/settle` then compared that stored string against what the chain
 * reports. That works on EVM, where an address is case-insensitive hex, and
 * silently breaks everywhere else:
 *
 *   * Bitcoin/BCH — base58 and bech32 are case-sensitive. `mempool.space`
 *     returns `scriptpubkey_address` in its true case, which never equals the
 *     lowercased copy, so no output is ever attributed to the payee and
 *     settlement fails with "Transaction paid 0 sats".
 *   * Solana — base58 pubkeys are mixed case, so the payee is never found
 *     among the transaction's account keys and settlement fails with
 *     "Transaction does not involve <address>".
 *
 * Both failures are indistinguishable from a genuinely unpaid invoice, which
 * is why they read as "settlement is unimplemented" rather than as a bug.
 *
 * Casing is therefore a per-network property, not a global one.
 */

/** Networks whose addresses are case-insensitive and normalise to lowercase. */
const CASE_INSENSITIVE_NETWORKS = new Set(['ethereum', 'polygon', 'base']);

/**
 * Canonical stored form of an address for a given network.
 *
 * EVM addresses lowercase so that equality is a plain string compare. Every
 * other network keeps the payer's exact bytes, because for those chains case
 * carries information — in bech32 and base58 it is part of the checksum.
 */
export function normalizeAddressForNetwork(
  network: string | null | undefined,
  address: string | null | undefined,
): string {
  const value = (address ?? '').trim();
  if (!value) return '';

  return CASE_INSENSITIVE_NETWORKS.has((network ?? '').toLowerCase())
    ? value.toLowerCase()
    : value;
}

/**
 * Compare two addresses under the given network's casing rules.
 *
 * Use this rather than `===` anywhere a stored address meets one read back
 * from a chain, so the comparison cannot silently depend on which side was
 * normalised first.
 */
export function addressesEqual(
  network: string | null | undefined,
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizeAddressForNetwork(network, a);
  const right = normalizeAddressForNetwork(network, b);
  return left !== '' && left === right;
}
