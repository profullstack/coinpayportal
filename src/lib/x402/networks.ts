/**
 * Which payment schemes each x402 network accepts.
 *
 * Both `/api/x402/verify` and `/api/x402/settle` dispatch on the network named
 * in a proof, and both need the same answer to "is this scheme even possible
 * here?". Keeping one table means the two routes cannot drift apart — the audit
 * found several pairs where a check present in one route was silently missing
 * from its sibling, and a shared constant is the cheap structural fix for that.
 *
 * Why this matters at all: `scheme` and `network` are independent fields the
 * payer fills in. Dispatch used to read `scheme === 'bolt12' || network ===
 * 'lightning'`, so a proof labelled `{scheme:'bolt12', network:'ethereum'}` ran
 * the Lightning verifier while the response reported `amountAuthenticated:
 * true` — a flag derived from the network. The weakest check ran and the answer
 * advertised the strongest guarantee. Dispatch is on `network` alone now, and a
 * scheme that network does not support is a rejected proof.
 */
export const SCHEMES_BY_NETWORK: Record<string, Set<string>> = {
  lightning: new Set(['bolt12', 'bolt11']),
  stripe: new Set(['stripe-checkout']),
  ethereum: new Set(['exact']),
  polygon: new Set(['exact']),
  base: new Set(['exact']),
  bitcoin: new Set(['exact']),
  'bitcoin-cash': new Set(['exact']),
  solana: new Set(['exact']),
};

/** EVM networks — verified by EIP-712 signature, settled on-chain. */
export const EVM_NETWORKS = new Set(['ethereum', 'polygon', 'base']);

/** UTXO networks — verified by transaction proof. */
export const UTXO_NETWORKS = new Set(['bitcoin', 'bitcoin-cash']);

/**
 * Reject a proof whose `scheme` is not one the named `network` supports.
 *
 * Returns null when the pair is acceptable, or a human-readable reason to
 * refuse. An absent scheme is allowed — several callers omit it and the network
 * alone is enough to route.
 */
export function checkSchemeForNetwork(network: string, scheme?: string): string | null {
  const allowed = SCHEMES_BY_NETWORK[network];
  if (!allowed) return `Unsupported network: ${network}`;
  if (scheme && !allowed.has(scheme)) return `Scheme ${scheme} is not valid on ${network}`;
  return null;
}
