/**
 * Shared Solana JSON-RPC settings.
 *
 * `maxSupportedTransactionVersion` caps which transaction versions an RPC node
 * will return. A transaction (or any transaction inside a block) newer than the
 * cap makes the node answer with error -32015 and no `result`, which callers
 * used to read as "not found yet" — x402 settlements sent as version 1
 * transactions sat in pending forever (#521). Version 1 is a large share of
 * mainnet traffic, and `getBlock` fails outright on almost any recent block
 * when the cap is 0.
 *
 * Keep every `getTransaction` / `getBlock` call on this constant. Note that
 * @solana/web3.js 1.x cannot decode version 1 transactions at all (its
 * response schema only accepts `0 | 'legacy'`), so those calls must be made
 * as raw JSON-RPC with `encoding: 'jsonParsed'`, not through `Connection`.
 */
export const SOLANA_MAX_TX_VERSION = 1;

/** JSON-RPC error codes that mean "try again later", not "this is wrong". */
const TRANSIENT_RPC_CODES = new Set([
  429, // rate limited (some providers put the HTTP status in the code)
  -32004, // block not available for slot
  -32005, // node is behind / unhealthy
  -32007, // slot skipped or missing in long-term storage (may backfill)
  -32014, // block status not yet available
]);

export function isTransientSolanaRpcError(error: { code?: number } | null | undefined): boolean {
  return !!error && typeof error.code === 'number' && TRANSIENT_RPC_CODES.has(error.code);
}
