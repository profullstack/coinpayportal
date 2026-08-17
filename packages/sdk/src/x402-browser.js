/**
 * Browser-side x402 payer.
 *
 * Turns a 402 response into a paid retry, using whatever wallet the visitor
 * actually has. CoinPay Wallet is preferred when present; otherwise any
 * injected EIP-1193 wallet — MetaMask, Phantom's EVM provider, Rabby, Coinbase
 * Wallet — can pay, because what gets signed is the standard EIP-3009
 * authorization rather than anything CoinPay-specific.
 *
 * That interoperability is the whole point of signing the real structure. A
 * bespoke payload would still be signable by MetaMask, but the resulting
 * signature would authorise no transfer on-chain and only CoinPayPortal could
 * interpret it — which is not a wallet integration, it is a lock-in.
 *
 * Usage:
 *   const res = await fetchWithX402('https://api.example.com/premium');
 *
 * @module x402-browser
 */

import {
  buildAuthorization,
  buildEip3009Domain,
  buildExactEvmPayment,
  encodePaymentHeader,
  evmChainId,
  requiredAmount,
  selectAcceptEntry,
  toCaip2,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
} from './x402-v2.js';

/** How long a discovery sweep waits for EIP-6963 wallets to announce. */
const EIP6963_ANNOUNCE_MS = 100;

/**
 * Enumerate injected EVM wallets via EIP-6963.
 *
 * Before EIP-6963 every wallet raced to own `window.ethereum`, so with two
 * installed you got whichever won — the user could not choose, and a site
 * could not tell which it had. EIP-6963 has each wallet announce itself with
 * its own provider object instead.
 *
 * `window.ethereum` is still included as a last resort, for wallets that have
 * not adopted the standard.
 */
export async function discoverEvmWallets({ timeoutMs = EIP6963_ANNOUNCE_MS } = {}) {
  const found = new Map();

  if (typeof window === 'undefined') return [];

  const onAnnounce = (event) => {
    const detail = event.detail;
    if (!detail?.info?.uuid || !detail.provider) return;
    found.set(detail.info.uuid, { info: detail.info, provider: detail.provider });
  };

  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  window.removeEventListener('eip6963:announceProvider', onAnnounce);

  const wallets = [...found.values()].map(({ info, provider }) => ({
    id: info.rdns || info.uuid,
    name: info.name,
    icon: info.icon,
    provider,
  }));

  // Legacy fallback: only if nothing announced, so a 6963-aware wallet is not
  // listed twice under two different identities.
  if (wallets.length === 0 && window.ethereum) {
    wallets.push({ id: 'injected', name: detectLegacyName(window.ethereum), provider: window.ethereum });
  }

  return wallets;
}

function detectLegacyName(provider) {
  if (provider.isMetaMask) return 'MetaMask';
  if (provider.isPhantom) return 'Phantom';
  if (provider.isCoinbaseWallet) return 'Coinbase Wallet';
  if (provider.isRabby) return 'Rabby';
  return 'Injected Wallet';
}

/**
 * True when a CoinPay Wallet that can actually pay an x402 invoice is present.
 *
 * Checks for the method, not merely for the wallet. `payX402` shipped after
 * the provider itself, so an installed-but-older extension has `isCoinPay`
 * and no way to pay — treating that as "CoinPay is here" would hand the
 * payment to a wallet that cannot take it and throw a TypeError, when the
 * visitor may well have MetaMask sitting right there.
 */
export function hasCoinPayWallet() {
  return (
    typeof window !== 'undefined' &&
    window.coinpay?.isCoinPay === true &&
    typeof window.coinpay.payX402 === 'function'
  );
}

/** True when CoinPay Wallet is installed but predates x402 support. */
export function hasOutdatedCoinPayWallet() {
  return (
    typeof window !== 'undefined' &&
    window.coinpay?.isCoinPay === true &&
    typeof window.coinpay.payX402 !== 'function'
  );
}

/**
 * Choose a wallet to pay with.
 *
 * CoinPay Wallet first when installed — it is the only one that can pay on
 * every rail CoinPayPortal accepts, including Bitcoin and Lightning, which no
 * EVM wallet can touch. Otherwise the first injected EVM wallet, or one named
 * explicitly by `preferWalletId`.
 */
export async function selectWallet({ preferWalletId, allowCoinPay = true } = {}) {
  if (allowCoinPay && hasCoinPayWallet() && !preferWalletId) {
    return { kind: 'coinpay', id: 'coinpay', name: 'CoinPay Wallet', provider: window.coinpay };
  }

  const evm = await discoverEvmWallets();
  if (evm.length === 0) {
    if (allowCoinPay && hasCoinPayWallet()) {
      return { kind: 'coinpay', id: 'coinpay', name: 'CoinPay Wallet', provider: window.coinpay };
    }
    return null;
  }

  const chosen = preferWalletId ? evm.find((w) => w.id === preferWalletId) : evm[0];
  if (!chosen) return null;
  return { kind: 'evm', ...chosen };
}

/** Ask an EIP-1193 provider for the active account, prompting if needed. */
async function requireEvmAccount(provider) {
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('Wallet returned no accounts');
  }
  return accounts[0];
}

/**
 * Put an EIP-1193 wallet on the chain an `accepts` entry requires.
 *
 * Signing an EIP-712 payload whose domain names chain X while the wallet is on
 * chain Y produces a signature that verifies against neither — wallets bind
 * the domain's chainId to their active chain. So the switch is mandatory, not
 * a nicety.
 */
async function ensureEvmChain(provider, network) {
  const chainId = evmChainId(network);
  if (chainId === null) throw new Error(`Not an EVM network: ${network}`);
  const hexChainId = `0x${chainId.toString(16)}`;

  const current = await provider.request({ method: 'eth_chainId' });
  if (typeof current === 'string' && current.toLowerCase() === hexChainId) return;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
  } catch (err) {
    // 4902 = chain unknown to the wallet. Adding it needs RPC details we do
    // not have here, so surface it rather than guessing an RPC URL.
    if (err?.code === 4902) {
      throw new Error(
        `Your wallet does not have chain ${chainId} configured. Add it, then try again.`,
      );
    }
    throw err;
  }
}

/**
 * Sign an EIP-3009 authorization with an EIP-1193 wallet.
 *
 * @returns {{signature: string, authorization: object, from: string}}
 */
export async function signExactEvm(provider, entry, { from } = {}) {
  const payer = from ?? (await requireEvmAccount(provider));
  await ensureEvmChain(provider, entry.network);

  const domain = buildEip3009Domain({
    network: entry.network,
    asset: entry.asset,
    name: entry.extra?.name,
    version: entry.extra?.version,
  });

  const authorization = buildAuthorization({
    from: payer,
    to: entry.payTo,
    value: requiredAmount(entry),
    validForSeconds: entry.maxTimeoutSeconds ?? 600,
  });

  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      ...TRANSFER_WITH_AUTHORIZATION_TYPES,
    },
    primaryType: 'TransferWithAuthorization',
    domain,
    message: authorization,
  };

  const signature = await provider.request({
    method: 'eth_signTypedData_v4',
    params: [payer, JSON.stringify(typedData)],
  });

  return { signature, authorization, from: payer };
}

/**
 * Produce the `X-PAYMENT` header value for a 402 body.
 *
 * @param {object} paymentRequired  the parsed 402 JSON (`{x402Version, accepts}`)
 * @param {object} [options]
 * @param {string} [options.preferWalletId]
 * @param {string[]} [options.capabilities] override which networks to consider
 */
export async function createPaymentHeader(paymentRequired, options = {}) {
  const accepts = paymentRequired?.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) {
    throw new Error('402 response carried no `accepts` options');
  }

  const wallet = await selectWallet(options);
  if (!wallet) {
    if (hasOutdatedCoinPayWallet()) {
      throw new Error(
        'Your CoinPay Wallet is too old to pay x402 invoices and no other wallet is ' +
          'available. Update it, or install MetaMask.',
      );
    }
    throw new Error(
      'No wallet available to pay. Install CoinPay Wallet, MetaMask, or another EVM wallet.',
    );
  }

  if (wallet.kind === 'coinpay') {
    // The extension picks among the offered options itself — it knows which
    // chains the user actually holds funds on, which this page does not.
    const header = await wallet.provider.payX402(paymentRequired);
    return { header, wallet };
  }

  // An injected EVM wallet can only pay the EVM entries.
  const evmCapable = accepts
    .map((entry) => entry.network)
    .filter((network) => evmChainId(network) !== null);

  const entry = selectAcceptEntry(accepts, options.capabilities ?? evmCapable);
  if (!entry) {
    throw new Error(
      `${wallet.name} cannot pay any of the offered options ` +
        `(${accepts.map((a) => toCaip2(a.network)).join(', ')}). ` +
        'CoinPay Wallet supports Bitcoin, Lightning and card rails as well.',
    );
  }

  const { signature, authorization } = await signExactEvm(wallet.provider, entry);
  const payment = buildExactEvmPayment({
    network: entry.network,
    signature,
    authorization,
    scheme: entry.scheme ?? 'exact',
  });

  return { header: encodePaymentHeader(payment), wallet, entry };
}

/**
 * `fetch` that pays once if the resource asks for payment.
 *
 * Retries exactly one time. A second 402 after paying means the payment was
 * rejected rather than missing, and retrying again would sign a fresh
 * authorization for a resource that just refused one — at the user's expense.
 *
 * @param {string|URL|Request} input
 * @param {RequestInit} [init]
 * @param {object} [options] forwarded to {@link createPaymentHeader}
 */
export async function fetchWithX402(input, init = {}, options = {}) {
  const first = await fetch(input, init);
  if (first.status !== 402) return first;

  let paymentRequired;
  try {
    paymentRequired = await first.clone().json();
  } catch {
    throw new Error('Resource returned 402 but its body was not valid x402 JSON');
  }

  const { header } = await createPaymentHeader(paymentRequired, options);

  const headers = new Headers(init.headers ?? {});
  headers.set('X-PAYMENT', header);

  const paid = await fetch(input, { ...init, headers });
  if (paid.status === 402) {
    throw new Error('Payment was rejected by the resource; not retrying to avoid double-paying');
  }
  return paid;
}
