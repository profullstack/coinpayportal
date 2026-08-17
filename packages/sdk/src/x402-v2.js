/**
 * x402 v2 protocol primitives.
 *
 * `x402.js` speaks a dialect only CoinPayPortal understands: `x402Version: 1`,
 * bare network names like `"base"`, `maxAmountRequired` instead of `amount`,
 * and an EIP-712 domain of our own invention (`name: 'x402'`). Nothing else in
 * the ecosystem can read a 402 we emit, and no proof from a standard client
 * verifies against us.
 *
 * That is survivable while CoinPay Wallet is the only payer. It stops being
 * survivable the moment MetaMask or Phantom is expected to pay, because those
 * wallets sign standard structures and nothing else: MetaMask will happily
 * sign our bespoke domain, but the resulting signature authorises nothing
 * on-chain and only we could ever interpret it.
 *
 * This module is the real thing, and is shared by the browser payer and the
 * facilitator so the two cannot drift.
 *
 * Field shapes here were taken from live `/supported` and
 * `/discovery/resources` responses on facilitator.goplausible.xyz and
 * Coinbase's facilitator, not from memory of the spec.
 *
 * @module x402-v2
 */

/** The protocol version the ecosystem is actually on. */
export const X402_VERSION = 2;

/**
 * CAIP-2 chain identifiers.
 *
 * The ecosystem addresses chains as `namespace:reference`, never as a bare
 * name — `"base"` is meaningless to another facilitator, `eip155:8453` is not.
 *
 * `eip155:*` and `solana:*` are verified against live facilitator responses.
 * Solana's reference is the first 32 characters of the genesis hash, per
 * CAIP-30.
 */
export const CAIP2 = {
  ethereum: 'eip155:1',
  polygon: 'eip155:137',
  base: 'eip155:8453',
  'base-sepolia': 'eip155:84532',
  solana: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  // CAIP-2 namespace for Bitcoin-family chains is `bip122`, referenced by the
  // genesis block hash. Bitcoin Cash shares Bitcoin's genesis block, so the two
  // are not distinguishable by CAIP-2 alone; BCH is left out rather than given
  // an identifier that collides with Bitcoin's.
  bitcoin: 'bip122:000000000019d6689c085ae165831e93',
};

/**
 * Rails CoinPayPortal supports that have no CAIP-2 identity.
 *
 * Nobody else's facilitator accepts these, so there is no interoperable name
 * to use. They keep their legacy identifiers and are flagged here so callers
 * can tell "not yet mapped" from "deliberately outside CAIP-2".
 */
export const NON_CAIP2_NETWORKS = new Set(['bitcoin-cash', 'lightning', 'stripe']);

/** Legacy bare name -> CAIP-2, for translating our own v1 records. */
export function toCaip2(network) {
  if (!network) return '';
  if (network.includes(':')) return network; // already CAIP-2
  return CAIP2[network] ?? network;
}

/** CAIP-2 -> legacy bare name, for code that still keys on the old names. */
export function fromCaip2(caip2) {
  if (!caip2) return '';
  if (!caip2.includes(':')) return caip2; // already a bare name
  const match = Object.entries(CAIP2).find(([, id]) => id === caip2);
  return match ? match[0] : caip2;
}

/** Numeric EVM chain id from a CAIP-2 id, or null if it is not an eip155 chain. */
export function evmChainId(network) {
  const caip2 = toCaip2(network);
  const match = /^eip155:(\d+)$/.exec(caip2);
  return match ? Number(match[1]) : null;
}

/**
 * EIP-3009 `TransferWithAuthorization` type.
 *
 * This — not a bespoke `Payment` struct — is what x402's `exact` scheme signs
 * on EVM. The signature IS the payment: whoever holds it can call
 * `transferWithAuthorization` on the token and move the funds, which is why
 * the facilitator can broadcast and pay the gas while the payer needs no
 * native currency at all.
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

/**
 * Build the EIP-712 domain for an EIP-3009 authorization.
 *
 * The domain belongs to the TOKEN, not to x402: `verifyingContract` is the
 * token's own address, and `name`/`version` are the values that token returns
 * from its own EIP-712 domain. Tokens disagree about `version` ("1" vs "2")
 * and it is not derivable, which is why a v2 `accepts` entry carries it in
 * `extra` — that is what `extra: { name: 'USD Coin', version: '2' }` in live
 * discovery data is for.
 *
 * Getting this wrong is not a soft failure: the recovered signer is simply
 * some other address, so the authorization is void.
 *
 * @param {object} args
 * @param {string} args.network   CAIP-2 id or legacy name
 * @param {string} args.asset     token contract address
 * @param {string} args.name      token's EIP-712 domain name
 * @param {string} args.version   token's EIP-712 domain version
 */
export function buildEip3009Domain({ network, asset, name, version }) {
  const chainId = evmChainId(network);
  if (chainId === null) {
    throw new Error(`Not an EVM network, cannot build an EIP-3009 domain: ${network}`);
  }
  if (!asset) {
    throw new Error('EIP-3009 requires the token contract address as verifyingContract');
  }
  if (!name || !version) {
    throw new Error(
      'EIP-3009 requires the token EIP-712 domain name and version; ' +
        'a v2 `accepts` entry supplies them in `extra.name` / `extra.version`',
    );
  }

  return { name, version, chainId, verifyingContract: asset };
}

/**
 * A random 32-byte nonce, hex encoded.
 *
 * EIP-3009 nonces are arbitrary bytes32 rather than a sequence — the token
 * tracks used ones per authorizer, so they need only be unpredictable and not
 * repeated. Uses WebCrypto, which is present in browsers, Workers and Node 18+.
 */
export function randomNonce() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Build the authorization message to be signed.
 *
 * `validAfter` is 0 rather than "now": clocks differ between the payer and the
 * chain, and a validAfter in the payer's near future makes the authorization
 * briefly unusable for no benefit.
 *
 * @param {object} args
 * @param {string} args.from            payer address
 * @param {string} args.to              payee address (`payTo` from `accepts`)
 * @param {string|bigint} args.value    amount in the token's smallest unit
 * @param {number} [args.validForSeconds=600]
 * @param {string} [args.nonce]         defaults to a fresh random nonce
 */
export function buildAuthorization({ from, to, value, validForSeconds = 600, nonce }) {
  if (!from) throw new Error('buildAuthorization requires `from`');
  if (!to) throw new Error('buildAuthorization requires `to`');
  if (value === undefined || value === null || value === '') {
    throw new Error('buildAuthorization requires `value`');
  }

  const now = Math.floor(Date.now() / 1000);

  return {
    from,
    to,
    value: String(value),
    validAfter: '0',
    validBefore: String(now + validForSeconds),
    nonce: nonce ?? randomNonce(),
  };
}

/**
 * Assemble the payment payload that goes in the `X-PAYMENT` header.
 *
 * @param {object} args
 * @param {string} args.network        CAIP-2 id
 * @param {string} args.signature      65-byte EIP-712 signature, hex
 * @param {object} args.authorization  from `buildAuthorization`
 * @param {string} [args.scheme='exact']
 */
export function buildExactEvmPayment({ network, signature, authorization, scheme = 'exact' }) {
  return {
    x402Version: X402_VERSION,
    scheme,
    network: toCaip2(network),
    payload: { signature, authorization },
  };
}

/**
 * base64 encoding of a payment payload, as the `X-PAYMENT` header carries it.
 *
 * Uses base64url-safe output only where the runtime gives it; the header is
 * standard base64 in the spec, so plain base64 is what is produced.
 */
export function encodePaymentHeader(payment) {
  const json = JSON.stringify(payment);
  if (typeof globalThis.btoa === 'function') {
    // Browsers: btoa is latin1-only, so UTF-8 must be widened first.
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return globalThis.btoa(binary);
  }
  return Buffer.from(json, 'utf-8').toString('base64');
}

/** Inverse of {@link encodePaymentHeader}. */
export function decodePaymentHeader(header) {
  let json;
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(header);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    json = new TextDecoder().decode(bytes);
  } else {
    json = Buffer.from(header, 'base64').toString('utf-8');
  }
  return JSON.parse(json);
}

/**
 * Pick the best `accepts` entry a given set of wallets can actually pay.
 *
 * A 402 lists several options and the payer must choose one it can sign. The
 * order of `accepts` is the merchant's preference, so it is honoured rather
 * than re-ranked — the first entry whose network is supported wins.
 *
 * @param {object[]} accepts       the 402's `accepts` array
 * @param {string[]} capabilities  CAIP-2 ids (or bare names) the payer can sign
 * @returns {object|null}
 */
export function selectAcceptEntry(accepts, capabilities) {
  if (!Array.isArray(accepts) || accepts.length === 0) return null;
  const supported = new Set(capabilities.map(toCaip2));
  return accepts.find((entry) => supported.has(toCaip2(entry?.network))) ?? null;
}

/**
 * The amount an `accepts` entry asks for, in the asset's smallest unit.
 *
 * v2 names this `amount`; our own v1 emitted `maxAmountRequired`. Both are
 * read so a payer can pay a CoinPayPortal 402 that has not been migrated yet.
 */
export function requiredAmount(entry) {
  const raw = entry?.amount ?? entry?.maxAmountRequired;
  if (raw === undefined || raw === null || raw === '') {
    throw new Error('`accepts` entry has neither `amount` nor `maxAmountRequired`');
  }
  return String(raw);
}
