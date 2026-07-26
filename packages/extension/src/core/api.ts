/**
 * CoinPay portal API client (background context only).
 *
 * The extension holds the keys but NOT the chain infrastructure: it has no RPC
 * endpoints, no UTXO indexer, no fee oracle. Rather than duplicate all of that
 * inside a service worker, it reuses the portal's existing web-wallet API,
 * which already does exactly this split for the CoinPay web wallet:
 *
 *   POST /web-wallet/:id/prepare-tx  → server assembles the UNSIGNED tx
 *                                      (nonce / UTXOs / blockhash / fees)
 *   ── sign locally, keys never leave the device ──
 *   POST /web-wallet/:id/broadcast   → server relays the SIGNED blob to the net
 *
 * Registration (`/web-wallet/import`) is non-custodial: it uploads PUBLIC keys
 * and addresses plus a signature proving we hold the matching private key. The
 * seed is never sent. Subsequent calls authenticate per-request by signing
 * `METHOD:path:timestamp:body` with the same key.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';

import type { PayChain } from './pay-chains.js';
import type { UnsignedTransactionData } from './signing.js';

const DEFAULT_BASE_URL = 'https://coinpayportal.com/api';

export interface RegisteredAddress {
  chain: string;
  address: string;
  derivation_path: string;
}

export interface PreparedTx {
  tx_id: string;
  chain: PayChain;
  from_address: string;
  to_address: string;
  amount: string;
  fee: { total_fee?: string; fee_rate?: string; [k: string]: unknown };
  expires_at: string;
  unsigned_tx: UnsignedTransactionData;
}

export interface BroadcastedTx {
  tx_hash: string;
  chain: PayChain;
  status: 'pending' | 'confirming';
  explorer_url: string;
}

/** A portal error surfaced with its API code so callers can branch on it. */
export class CoinPayApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CoinPayApiError';
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sign a UTF-8 message the way the portal's `verifySecp256k1Signature` expects:
 * compact (64-byte) ECDSA over the message with internal SHA-256 prehashing.
 */
export function signAuthMessage(message: string, privateKey: Uint8Array): string {
  const sig = secp256k1.sign(new TextEncoder().encode(message), privateKey, { prehash: true });
  return toHex(sig);
}

export function compressedPublicKey(privateKey: Uint8Array): string {
  return toHex(secp256k1.getPublicKey(privateKey, true));
}

export class CoinPayApi {
  readonly baseUrl: string;

  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Unauthenticated GET. `/rates` is public and returns its payload flat
   * (`{ success, rate, fiat }`) rather than wrapped in `data`, so it can't go
   * through `#request`, which unwraps.
   */
  async #publicGet<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      throw new CoinPayApiError(
        err instanceof Error ? err.message : 'Network request failed',
        'NETWORK_ERROR',
        0,
      );
    }

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      // Non-JSON body — the status below carries the failure.
    }

    if (!response.ok || payload?.success === false) {
      // `/rates` reports `error` as a plain string; the wallet routes nest it.
      const message =
        typeof payload?.error === 'string'
          ? payload.error
          : payload?.error?.message || `Request failed with status ${response.status}`;
      throw new CoinPayApiError(message, payload?.error?.code || 'HTTP_ERROR', response.status);
    }

    return payload as T;
  }

  /**
   * Live exchange rate: one unit of `coin` priced in `fiat`.
   *
   * `coin` may be a PayChain (`USDC_POL`) or a bare ticker (`BTC`) — the portal
   * resolves tokens itself. The endpoint is IP rate-limited, so callers should
   * go through `RateCache` rather than fetching per keystroke.
   */
  async getRate(coin: string, fiat: string): Promise<number> {
    const payload = await this.#publicGet<{ rate?: number | null }>(
      `/rates?coin=${encodeURIComponent(coin)}&fiat=${encodeURIComponent(fiat)}`,
    );
    const rate = Number(payload?.rate);
    // A 200 with `rate: null` means the upstream price feed had nothing for
    // this pair — surface it as an error, never as a zero-value quote.
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new CoinPayApiError(`No ${fiat} rate available for ${coin}`, 'NO_RATE', 200);
    }
    return rate;
  }

  /** Path as the server sees it, for signature reconstruction. */
  #signedPath(path: string): string {
    const url = new URL(this.baseUrl + path);
    return url.pathname;
  }

  async #request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; walletId?: string; privateKey?: Uint8Array } = {},
  ): Promise<T> {
    const { body, walletId, privateKey } = options;
    // The signature covers the exact bytes sent, so serialize once and reuse.
    const rawBody = body === undefined ? '' : JSON.stringify(body);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (walletId && privateKey) {
      const timestamp = Math.floor(Date.now() / 1000);
      const message = `${method}:${this.#signedPath(path)}:${timestamp}:${rawBody}`;
      headers.Authorization = `Wallet ${walletId}:${signAuthMessage(message, privateKey)}:${timestamp}`;
    }

    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: method === 'GET' ? undefined : rawBody,
      });
    } catch (err) {
      throw new CoinPayApiError(
        err instanceof Error ? err.message : 'Network request failed',
        'NETWORK_ERROR',
        0,
      );
    }

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      // Fall through — a non-JSON body is reported via the status below.
    }

    if (!response.ok || payload?.success === false) {
      throw new CoinPayApiError(
        payload?.error?.message || `Request failed with status ${response.status}`,
        payload?.error?.code || 'HTTP_ERROR',
        response.status,
      );
    }

    return payload?.data as T;
  }

  /**
   * Register this wallet's public material so prepare-tx/broadcast will accept
   * it. Idempotent: an already-registered key returns its existing wallet id
   * (and backfills any addresses added since).
   */
  async registerWallet(input: {
    publicKeySecp256k1: string;
    publicKeyEd25519?: string;
    addresses: RegisteredAddress[];
    /** Signs the proof-of-ownership challenge. Must match publicKeySecp256k1. */
    privateKey: Uint8Array;
  }): Promise<{ wallet_id: string; already_exists?: boolean }> {
    // The challenge is self-describing and time-stamped so a captured proof
    // can't be replayed into a different context later.
    const message = `CoinPay extension wallet registration:${Date.now()}`;
    return this.#request('POST', '/web-wallet/import', {
      body: {
        public_key_secp256k1: input.publicKeySecp256k1,
        public_key_ed25519: input.publicKeyEd25519,
        addresses: input.addresses,
        proof_of_ownership: {
          message,
          signature: signAuthMessage(message, input.privateKey),
        },
      },
    });
  }

  async prepareTx(
    walletId: string,
    privateKey: Uint8Array,
    input: {
      from_address: string;
      to_address: string;
      chain: PayChain;
      amount: string;
      priority?: 'low' | 'medium' | 'high';
    },
  ): Promise<PreparedTx> {
    return this.#request('POST', `/web-wallet/${walletId}/prepare-tx`, {
      body: input,
      walletId,
      privateKey,
    });
  }

  async broadcast(
    walletId: string,
    privateKey: Uint8Array,
    input: { tx_id: string; signed_tx: string; chain: PayChain },
  ): Promise<BroadcastedTx> {
    return this.#request('POST', `/web-wallet/${walletId}/broadcast`, {
      body: input,
      walletId,
      privateKey,
    });
  }
}
