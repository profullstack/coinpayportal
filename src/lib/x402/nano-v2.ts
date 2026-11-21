/**
 * x402 v2 proofs on Nano (`nano:mainnet`).
 *
 * A standard v2 client names Nano by its CAIP-2 id, `nano:mainnet`, sets
 * `x402Version: 2`, echoes the requirements it chose in `accepted`, and puts
 * the hash of the send block it published in `payload.blockHash`. That is the
 * `exact` scheme other facilitators verify on Nano.
 *
 * `isV2Payment` keys on `x402Version === 2`, so such a proof used to go to
 * `verifyV2`, which only knows EIP-3009 on eip155 chains and refused it as
 * "Not an EVM network". No standard Nano payer could pay a CoinPayPortal
 * merchant, although the facilitator verifies Nano blocks already.
 *
 * This module turns such a proof into the flat v1 shape the Nano path already
 * verifies (`payload.network: 'nano'`, `blockHash`, `to`, `amount`,
 * `resource`). Nothing about the check changes: `enforcePriceBinding` still
 * compares the claimed price, resource and recipient with `expected`, and
 * `verifyNanoBlock` still reads the block from the operator's node and checks
 * it against `expected.payTo` and `expected.amount`. Because the network
 * becomes `nano`, the replay identity is the same (block hash, network) row
 * in `x402_payments`, so one block cannot be redeemed once as v1 and again
 * as v2.
 *
 * No imports on purpose: this is pure data shaping and is tested on its own.
 */

/** CAIP-2 id of the Nano main network. */
export const NANO_MAINNET_CAIP2 = 'nano:mainnet';

/** Legacy network name the facilitator's Nano path keys on. */
export const NANO_LEGACY_NETWORK = 'nano';

type Converted =
  | { ok: true; payment: { x402Version: 1; scheme: 'exact'; payload: Record<string, unknown> } }
  | { ok: false; error: string };

function asObject(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

/**
 * Is this a proof that names `nano:mainnet` at the top level or in
 * `accepted`? Only those are converted; every other proof is left alone.
 */
export function isNanoV2Payment(payment: unknown): boolean {
  const p = asObject(payment);
  if (!p) return false;
  const accepted = asObject(p.accepted);
  return p.network === NANO_MAINNET_CAIP2 || accepted?.network === NANO_MAINNET_CAIP2;
}

/**
 * Convert a v2 `nano:mainnet` proof to the v1 Nano shape.
 *
 * Refuses rather than guesses: a proof without `accepted`, with a scheme
 * other than `exact`, with a top-level network that disagrees with
 * `accepted.network`, or without a block hash is an error, never a partial
 * payment.
 */
export function nanoV2ToV1(payment: unknown): Converted {
  const p = asObject(payment);
  if (!p) return { ok: false, error: 'Invalid payment proof' };

  const accepted = asObject(p.accepted);
  if (!accepted) {
    return {
      ok: false,
      error: 'A v2 Nano proof must echo the requirements it pays in `accepted`',
    };
  }

  const network = p.network ?? accepted.network;
  if (network !== NANO_MAINNET_CAIP2 || (accepted.network ?? network) !== NANO_MAINNET_CAIP2) {
    return { ok: false, error: `Network mismatch in v2 Nano proof: ${String(network)}` };
  }

  const scheme = p.scheme ?? accepted.scheme ?? 'exact';
  if (scheme !== 'exact' || (accepted.scheme ?? 'exact') !== 'exact') {
    return { ok: false, error: `Scheme ${String(scheme)} is not valid on ${NANO_MAINNET_CAIP2}` };
  }

  const inner = asObject(p.payload);
  const blockHash = inner?.blockHash;
  if (typeof blockHash !== 'string' || blockHash === '') {
    return {
      ok: false,
      error:
        'A v2 Nano proof must carry `payload.blockHash`, the hash of a send block ' +
        'the payer already published; an unpublished block is not accepted',
    };
  }

  const resourceInfo = asObject(p.resource);
  const resource =
    typeof p.resource === 'string' ? p.resource : (resourceInfo?.url ?? accepted.resource);

  return {
    ok: true,
    payment: {
      x402Version: 1,
      scheme: 'exact',
      payload: {
        network: NANO_LEGACY_NETWORK,
        scheme: 'exact',
        blockHash,
        to: accepted.payTo,
        amount: accepted.amount ?? accepted.maxAmountRequired,
        asset: accepted.asset,
        resource,
      },
    },
  };
}
