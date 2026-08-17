/**
 * Paying an x402 invoice from the wallet.
 *
 * The `exact` scheme on EVM is an EIP-3009 `TransferWithAuthorization`: the
 * signature IS the payment, and the facilitator broadcasts it and pays the
 * gas. So paying here means signing typed data, not building and broadcasting
 * a transaction — the wallet spends no native currency at all, and the user
 * needs none on the chain being paid.
 */

import { signTypedData, type TypedDataDomain } from './eip712.js';

/** CAIP-2 ids the wallet can sign an `exact` payment on, to the EVM chain id. */
export const SUPPORTED_X402_NETWORKS: Record<string, number> = {
  'eip155:1': 1,
  'eip155:137': 137,
  'eip155:8453': 8453,
};

/** Legacy bare names, for offers that have not moved to CAIP-2 yet. */
const LEGACY_NETWORK_IDS: Record<string, number> = {
  ethereum: 1,
  polygon: 137,
  base: 8453,
};

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

export interface AcceptsEntry {
  scheme?: string;
  network?: string;
  amount?: string;
  maxAmountRequired?: string;
  asset?: string;
  payTo?: string;
  resource?: string;
  description?: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string; [k: string]: unknown };
}

export interface PaymentRequired {
  x402Version?: number;
  accepts?: AcceptsEntry[];
}

/** The EVM chain id an entry names, or null if the wallet cannot pay it. */
export function entryChainId(network: string | undefined): number | null {
  if (!network) return null;
  return SUPPORTED_X402_NETWORKS[network] ?? LEGACY_NETWORK_IDS[network] ?? null;
}

/** Amount in the asset's smallest unit; v2 says `amount`, our v1 said `maxAmountRequired`. */
export function entryAmount(entry: AcceptsEntry): string {
  const raw = entry.amount ?? entry.maxAmountRequired;
  if (raw === undefined || raw === null || raw === '') {
    throw new Error('Payment option specifies no amount');
  }
  return String(raw);
}

/**
 * Choose an option this wallet can actually sign.
 *
 * The order of `accepts` is the merchant's preference, so it is honoured
 * rather than re-ranked. An entry is only payable if it names a supported
 * chain, a token contract, a payee, and the token's EIP-712 domain — without
 * `extra.name`/`extra.version` there is no domain to sign against, and a
 * guessed one yields a signature that recovers to the wrong address.
 */
export function selectPayableEntry(paymentRequired: PaymentRequired): AcceptsEntry | null {
  const accepts = paymentRequired?.accepts;
  if (!Array.isArray(accepts)) return null;

  return (
    accepts.find(
      (entry) =>
        (entry.scheme ?? 'exact') === 'exact' &&
        entryChainId(entry.network) !== null &&
        !!entry.asset &&
        !!entry.payTo &&
        !!entry.extra?.name &&
        !!entry.extra?.version,
    ) ?? null
  );
}

/** A random 32-byte EIP-3009 nonce. */
export function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `0x${hex}`;
}

export interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/**
 * Build the authorization to sign.
 *
 * `validAfter` stays 0 rather than "now": the payer's clock and the chain's
 * differ, and a validAfter slightly in the future makes the authorization
 * briefly unspendable for no benefit.
 */
export function buildAuthorization(
  entry: AcceptsEntry,
  from: string,
  now = Math.floor(Date.now() / 1000),
): Authorization {
  if (!entry.payTo) throw new Error('Payment option names no payee');

  const validForSeconds = entry.maxTimeoutSeconds ?? 600;

  return {
    from,
    to: entry.payTo,
    value: entryAmount(entry),
    validAfter: '0',
    validBefore: String(now + validForSeconds),
    nonce: randomNonce(),
  };
}

/** base64 of the payment payload, as the `X-PAYMENT` header carries it. */
export function encodePaymentHeader(payment: unknown): string {
  const json = JSON.stringify(payment);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Sign an authorization and produce the `X-PAYMENT` header.
 *
 * The private key is used and not retained; the caller owns zeroing it.
 */
export function signX402Payment(
  entry: AcceptsEntry,
  authorization: Authorization,
  privateKey: Uint8Array,
): string {
  const chainId = entryChainId(entry.network);
  if (chainId === null) throw new Error(`Unsupported network: ${entry.network}`);
  if (!entry.extra?.name || !entry.extra?.version) {
    throw new Error('Payment option is missing the token EIP-712 domain (extra.name/version)');
  }

  // The domain belongs to the TOKEN, not to x402: `verifyingContract` is the
  // token address and name/version are the token's own, which is why a v2
  // offer has to carry them.
  const domain: TypedDataDomain = {
    name: entry.extra.name,
    version: entry.extra.version,
    chainId,
    verifyingContract: entry.asset,
  };

  const signature = signTypedData(
    domain,
    TRANSFER_WITH_AUTHORIZATION_TYPES,
    'TransferWithAuthorization',
    authorization as unknown as Record<string, unknown>,
    privateKey,
  );

  return encodePaymentHeader({
    x402Version: 2,
    scheme: 'exact',
    // Always emit CAIP-2, even when the offer used a legacy bare name, so the
    // facilitator sees a standard proof regardless of how it was quoted.
    network: `eip155:${chainId}`,
    payload: { signature, authorization },
  });
}

/** Human-readable amount, for the approval window. */
export function formatAmount(entry: AcceptsEntry, decimals = 6): string {
  const raw = BigInt(entryAmount(entry));
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = (raw % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** What the approval window shows the user. */
export interface X402Summary {
  network: string;
  chainId: number;
  amount: string;
  assetSymbol: string;
  payTo: string;
  resource?: string;
  description?: string;
}

export function summarizeX402(entry: AcceptsEntry): X402Summary {
  const chainId = entryChainId(entry.network);
  if (chainId === null) throw new Error(`Unsupported network: ${entry.network}`);

  const chainNames: Record<number, string> = { 1: 'Ethereum', 137: 'Polygon', 8453: 'Base' };

  return {
    network: chainNames[chainId] ?? `Chain ${chainId}`,
    chainId,
    amount: formatAmount(entry),
    // The offer names the token by its EIP-712 domain name, which for the
    // stablecoins we support is the human name too.
    assetSymbol: String(entry.extra?.name ?? 'tokens'),
    payTo: String(entry.payTo),
    resource: entry.resource,
    description: entry.description,
  };
}
