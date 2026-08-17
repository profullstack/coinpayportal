/**
 * x402 v2 verification — EIP-3009 `exact` payments on EVM.
 *
 * A v2 proof is not a claim that a transaction happened; it IS the payment. The
 * payer signs an EIP-3009 `TransferWithAuthorization` and hands it over, and
 * whoever holds that signature can call `transferWithAuthorization` on the
 * token to move the funds. So verification here is pure cryptography plus a
 * few bounds checks — there is no chain lookup, because nothing has been
 * broadcast yet.
 *
 * That is the opposite of the v1 path, where the payer broadcast first and we
 * confirmed afterwards, and it is why v2 payers need no native currency: the
 * facilitator broadcasts and pays the gas.
 */

import { ethers } from 'ethers';

/**
 * EIP-3009 `TransferWithAuthorization`.
 *
 * Mirrors `TRANSFER_WITH_AUTHORIZATION_TYPES` in
 * `packages/sdk/src/x402-v2.js`. The two are asserted equal by
 * `src/lib/x402/v2.test.ts` rather than shared through an import, so the Next
 * build does not take a runtime dependency on the SDK package — but they must
 * never drift, because the payer signs one and this verifies the other.
 */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

/** CAIP-2 -> numeric EVM chain id, or null when it is not an eip155 chain. */
export function evmChainId(network: string | null | undefined): number | null {
  if (!network) return null;
  const match = /^eip155:(\d+)$/.exec(network);
  if (match) return Number(match[1]);

  // Legacy bare names, so a v2 proof that names a chain the old way still works.
  const legacy: Record<string, number> = { ethereum: 1, polygon: 137, base: 8453 };
  return legacy[network] ?? null;
}

/** RPC endpoint per numeric chain id. */
const RPC_BY_CHAIN_ID: Record<number, string | undefined> = {
  1: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  137: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
  8453: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
};

export interface V2Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface V2Payment {
  x402Version?: number;
  scheme?: string;
  network?: string;
  payload?: {
    signature?: string;
    authorization?: V2Authorization;
  };
}

/**
 * Does this look like a v2 proof rather than our v1 dialect?
 *
 * v1 payloads carry the payment fields flat (`payload.to`, `payload.amount`);
 * v2 nests them under `payload.authorization` alongside a signature. Detecting
 * on shape rather than on `x402Version` alone means a client that omits the
 * version still routes correctly.
 */
export function isV2Payment(payment: unknown): payment is V2Payment {
  const p = payment as V2Payment | null;
  if (!p || typeof p !== 'object') return false;
  const auth = p.payload?.authorization;
  return (
    p.x402Version === 2 ||
    (!!auth && typeof auth === 'object' && typeof auth.nonce === 'string' && !!p.payload?.signature)
  );
}

export interface V2VerifyExpectation {
  /** Smallest-unit amount the resource costs. */
  amount: string;
  /** Address the merchant expects to be paid. */
  payTo: string;
  /** Token contract the payment must be denominated in. */
  asset: string;
}

export interface V2VerifyResult {
  valid: boolean;
  error?: string;
  /** Canonical fields for the ledger, present only when valid. */
  payment?: {
    from: string;
    to: string;
    amount: string;
    asset: string;
    network: string;
    /** The EIP-3009 nonce — this proof's single-use replay identity. */
    uniqueKey: string;
    validBefore: string;
  };
}

/** Parse a decimal or hex integer string, or return null. */
function toBigInt(value: unknown): bigint | null {
  try {
    return BigInt(String(value));
  } catch {
    return null;
  }
}

/**
 * Verify an EIP-3009 `exact` payment.
 *
 * Checks, in order: the shape is complete, the network is one we settle on,
 * the authorization is currently valid in time, it pays the expected payee at
 * least the asking price, and the signature recovers to the stated payer under
 * the token's own EIP-712 domain.
 *
 * The domain is resolved from the token contract rather than taken from the
 * proof. A payer who could nominate the domain could nominate one whose
 * separator they control, sign under that, and have the recovery succeed
 * against an authorization the real token would reject.
 *
 * NOTE ON RESOURCE BINDING: EIP-3009's struct has no field for the resource
 * being bought, so unlike our v1 proofs a v2 proof cannot be cryptographically
 * bound to a URL. What bounds it is the payee, the amount, and the nonce being
 * spendable once. The residual exposure is that a proof minted for one
 * resource can buy a DIFFERENT resource from the SAME merchant at the SAME or
 * lower price. That is inherent to the scheme, not an oversight here, and the
 * caller records the resource so it is at least auditable after the fact.
 */
export async function verifyExactEvmV2(
  payment: V2Payment,
  expected: V2VerifyExpectation,
): Promise<V2VerifyResult> {
  const auth = payment.payload?.authorization;
  const signature = payment.payload?.signature;

  if (!auth || !signature) {
    return { valid: false, error: 'v2 proof must carry payload.authorization and payload.signature' };
  }
  for (const field of ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce'] as const) {
    if (!auth[field]) {
      return { valid: false, error: `v2 authorization is missing \`${field}\`` };
    }
  }

  const chainId = evmChainId(payment.network);
  if (chainId === null) {
    return { valid: false, error: `Not an EVM network for the exact scheme: ${payment.network}` };
  }
  const rpcUrl = RPC_BY_CHAIN_ID[chainId];
  if (!rpcUrl) {
    return { valid: false, error: `No RPC configured for chain ${chainId}` };
  }

  if (!expected.asset) {
    return { valid: false, error: 'Missing `expected.asset` — cannot resolve the token domain' };
  }

  // Time bounds. An expired authorization is worthless: the token itself will
  // reject it, so accepting one here would promise a settlement that cannot
  // happen.
  const now = BigInt(Math.floor(Date.now() / 1000));
  const validAfter = toBigInt(auth.validAfter);
  const validBefore = toBigInt(auth.validBefore);
  if (validAfter === null || validBefore === null) {
    return { valid: false, error: 'v2 authorization has a non-integer validity window' };
  }
  if (validBefore <= now) {
    return { valid: false, error: 'Payment authorization has expired' };
  }
  if (validAfter > now) {
    return { valid: false, error: 'Payment authorization is not valid yet' };
  }

  // Value and payee.
  const value = toBigInt(auth.value);
  const owed = toBigInt(expected.amount);
  if (value === null || owed === null) {
    return { valid: false, error: 'Invalid amount: expected an integer in the asset smallest unit' };
  }
  if (value < owed) {
    return { valid: false, error: `Underpayment: authorization pays ${value}, resource costs ${owed}` };
  }
  if (auth.to.toLowerCase() !== expected.payTo.toLowerCase()) {
    return {
      valid: false,
      error: `Authorization pays ${auth.to}, but this resource is paid to ${expected.payTo}`,
    };
  }

  // The token's real domain, read from the contract.
  let domain: ethers.TypedDataDomain | null;
  try {
    // Imported here rather than at module scope: `evm-gas` reaches the system
    // wallet, which drags ethers' `ws` dependency into every module that so
    // much as imports `isV2Payment` from this file.
    const { resolvePermitDomain } = await import('@/lib/wallets/evm-gas');

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const token = new ethers.Contract(
      expected.asset,
      [
        'function name() view returns (string)',
        'function version() view returns (string)',
        'function DOMAIN_SEPARATOR() view returns (bytes32)',
      ],
      provider,
    );
    domain = await resolvePermitDomain(token, BigInt(chainId));
  } catch (err) {
    return {
      valid: false,
      error: `Could not read the token's EIP-712 domain: ${(err as Error).message}`,
    };
  }

  if (!domain) {
    return {
      valid: false,
      error:
        `Token ${expected.asset} does not expose an EIP-712 domain, ` +
        'so an EIP-3009 authorization against it cannot be verified',
    };
  }

  // Recover the signer.
  let recovered: string;
  try {
    recovered = ethers.verifyTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, auth, signature);
  } catch (err) {
    return { valid: false, error: `Malformed signature: ${(err as Error).message}` };
  }

  if (recovered.toLowerCase() !== auth.from.toLowerCase()) {
    return { valid: false, error: 'Invalid payment signature' };
  }

  return {
    valid: true,
    payment: {
      from: auth.from,
      to: auth.to,
      amount: auth.value,
      asset: expected.asset,
      network: payment.network ?? `eip155:${chainId}`,
      // The nonce is the authorization's identity: the token rejects a second
      // use of it, so it is exactly the right replay key for our ledger too.
      uniqueKey: auth.nonce,
      validBefore: auth.validBefore,
    },
  };
}
