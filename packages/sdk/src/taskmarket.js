/**
 * TaskMarket delegation for CoinPay agent wallets.
 *
 * Bridges the CoinPayPortal x402 v2 rails to TaskMarket (https://taskmarket.dev):
 * an agent or user can discover open work, fetch live task status, list
 * submissions, and create a fully-funded task through the TaskMarket HTTP API
 * using the same EIP-712 transfer-authorization mechanics as the rest of this
 * SDK.
 *
 * Safety properties (mirroring the TaskMarket integration bounty rules):
 *
 * - No private key, seed phrase, token or cookie is ever requested, stored,
 *   logged or committed. All signing is delegated to a caller-supplied
 *   `signer` object (e.g. an EIP-1193 wallet or a CoinPay web-wallet signer).
 * - Every spend requires fresh, explicit user authorization: the `authorize`
 *   callback is invoked with the exact amount, asset, payee and deadline, and
 *   must return `true` before any payment header is produced.
 * - `spendingLimitUsd` caps the amount that may be authorized in one call.
 *   The guard is only enforced for assets with known decimals; for any other
 *   asset the call refuses to proceed rather than pay blind.
 * - The created task's live status and its submissions are readable through
 *   `getTask` / `listSubmissions` and are meant to be presented to a human for
 *   review; this module never silently accepts or rejects work.
 * - No blind payment retries: a second POST happens exactly once; if its
 *   settlement status is unknown the error tells the caller to verify with
 *   `getTask` instead of re-paying.
 *
 * @module taskmarket
 */

import { randomUUID } from 'node:crypto';
import {
  buildAuthorization,
  encodePaymentHeader,
  requiredAmount,
  selectAcceptEntry,
  X402_VERSION,
} from './x402-v2.js';

/** TaskMarket API base URL (overridable for tests / self-hosted). */
export const TASKMARKET_API_URL =
  process.env.TASKMARKET_API_URL ?? 'https://api.taskmarket.dev';

/** Amounts are quoted in base units; USDC settles at 1e6 per dollar. */
const DECIMALS = {
  USDC: 6,
  USDC_E: 6,
  USDT: 6,
  ETH: 18,
  POL: 18,
  SOL: 9,
};

/** Error raised for non-2xx responses from the TaskMarket API. */
export class TaskMarketError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'TaskMarketError';
    this.status = status;
    this.body = body;
  }
}

/** Error raised when the caller declines the payment authorization. */
export class PaymentNotAuthorizedError extends Error {
  constructor(details) {
    super('Payment not authorized by caller');
    this.name = 'PaymentNotAuthorizedError';
    this.details = details;
  }
}

/**
 * True when a single 402 `accepts` entry stays within the caller's spending
 * cap. Amount comparison happens in base units (`amount * 10^decimals`).
 *
 * @param {object} accept  one entry of the 402 `accepts` array
 * @param {number} spendingLimitUsd  maximum USD the caller allows
 * @returns {boolean}
 */
export function withinSpendingLimit(accept, spendingLimitUsd) {
  if (!spendingLimitUsd) return true;
  const asset = String(accept?.asset ?? '').toUpperCase();
  const decimals = DECIMALS[asset];
  if (decimals === undefined) {
    throw new TaskMarketError(
      0,
      `Cannot enforce a USD spending limit for asset "${asset}": ` +
        'its decimals are unknown. Pass an amount with known decimals or ' +
        'leave spendingLimitUsd unset only if you fully trust the flow.'
    );
  }
  const amount = Number(requiredAmount(accept));
  return amount <= spendingLimitUsd * 10 ** decimals;
}

/**
 * Parse a TaskMarket JSON response, tolerating both `{data: {...}}` wrappers
 * (task list) and bare payloads (task detail, submissions list).
 */
function unwrap(result, key) {
  if (result && typeof result === 'object') {
    if (key && result[key] !== undefined) return result[key];
    if (result.data !== undefined) {
      if (key && result.data[key] !== undefined) return result.data[key];
      return result.data;
    }
  }
  return result;
}

/**
 * Discover open TaskMarket tasks.
 *
 * Listing is public on TaskMarket; a `signer` is therefore optional and only
 * used to attach the EIP-191 read-auth headers when provided.
 *
 * @param {object} [options]
 * @param {string} [options.status='open']
 * @param {number} [options.limit=50]
 * @param {string} [options.phase]      lifecycle filter (active, in_review, ...)
 * @param {string} [options.mode]       bounty | claim | pitch | benchmark | auction
 * @param {string} [options.tags]       comma-separated tags
 * @param {object} [options.signer]     optional `{address, signMessage}` wallet
 * @param {Function} [options.fetchImpl]  fetch substitute for tests
 * @returns {Promise<object[]>}
 */
export async function discoverTasks(options = {}) {
  const {
    status = 'open',
    limit = 50,
    phase,
    mode,
    tags,
    signer,
    fetchImpl = fetch,
  } = options;
  const params = new URLSearchParams({ status: String(status), limit: String(limit) });
  if (phase) params.set('phase', phase);
  if (mode) params.set('mode', mode);
  if (tags) params.set('tags', tags);

  let headers = { 'User-Agent': 'coinpay-sdk-taskmarket/0.8' };
  if (signer && signer.address && signer.signMessage) {
    const message = `TaskMarket read auth for ${signer.address}`;
    const signature = await signer.signMessage({ message });
    headers['X-Taskmarket-Address'] = signer.address;
    headers['X-Taskmarket-Signature'] = signature;
  }

  const res = await fetchImpl(`${TASKMARKET_API_URL}/api/tasks?${params}`, { headers });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new TaskMarketError(res.status, `GET /api/tasks failed (${res.status})`, result);
  return unwrap(result, 'tasks') ?? [];
}

/**
 * Fetch the live status of one TaskMarket task.
 *
 * @param {string} taskId
 * @param {object} [options]
 * @param {Function} [options.fetchImpl]
 * @returns {Promise<object>}
 */
export async function getTask(taskId, options = {}) {
  const { fetchImpl = fetch } = options;
  const res = await fetchImpl(`${TASKMARKET_API_URL}/api/tasks/${encodeURIComponent(taskId)}`, {
    headers: { 'User-Agent': 'coinpay-sdk-taskmarket/0.8' },
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new TaskMarketError(res.status, `GET /api/tasks/${taskId} failed (${res.status})`, result);
  return unwrap(result);
}

/**
 * List the submissions of a TaskMarket task for human review.
 *
 * @param {string} taskId
 * @param {object} [options]
 * @param {Function} [options.fetchImpl]
 * @returns {Promise<object[]>}
 */
export async function listSubmissions(taskId, options = {}) {
  const { fetchImpl = fetch } = options;
  const res = await fetchImpl(
    `${TASKMARKET_API_URL}/api/tasks/${encodeURIComponent(taskId)}/submissions`,
    { headers: { 'User-Agent': 'coinpay-sdk-taskmarket/0.8' } }
  );
  const result = await res.json().catch(() => []);
  if (!res.ok) throw new TaskMarketError(res.status, `GET /api/tasks/${taskId}/submissions failed (${res.status})`, result);
  return Array.isArray(result) ? result : (unwrap(result, 'submissions') ?? []);
}

/**
 * Create a TaskMarket task and pay for it over x402 v2.
 *
 * Flow:
 *   1. POST the task body with an idempotency key.
 *   2. TaskMarket answers `402 Payment Required` with the accepted rails.
 *   3. `spendingLimitUsd` is enforced against the quoted amount.
 *   4. `authorize` is invoked with the exact resource, payee, amount, asset
 *      and timeout; it must return `true` (fresh, explicit user consent).
 *   5. The EIP-712 transfer authorization is built, signed by `signer`, and
 *      sent once as the `PAYMENT-SIGNATURE` header.
 *   6. The created task id is returned; callers can then poll `getTask`.
 *
 * @param {object} task  `{title, description, reward, ...}` — fields are passed
 *                       through verbatim (reward is in base units).
 * @param {object} options
 * @param {object} options.signer  `{address, signTypedData({domain, types, primaryType, message})}`
 * @param {string[]} [options.capabilities]  CAIP-2 ids the signer can pay
 * @param {number} [options.spendingLimitUsd]  hard cap in USD for this call
 * @param {Function} [options.authorize]  `({resource, scheme, network, amount, asset, payTo, maxTimeoutSeconds}) => boolean`
 * @param {string} [options.idempotencyKey]  defaults to a fresh UUID
 * @param {Function} [options.fetchImpl]  fetch substitute for tests
 * @returns {Promise<{taskId: string}>}
 */
export async function createTask(task, options) {
  if (!options?.signer) throw new TypeError('createTask requires options.signer');
  if (!task?.title || !task?.description) throw new TypeError('task requires title and description');
  if (!(Number(task.reward) > 0)) throw new TypeError('task requires reward > 0 (base units)');

  const {
    signer,
    capabilities = ['eip155:8453', 'eip155:1'],
    spendingLimitUsd,
    authorize,
    idempotencyKey = randomUUID(),
    fetchImpl = fetch,
  } = options;

  const url = `${TASKMARKET_API_URL}/api/tasks`;
  const body = JSON.stringify(task);

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'coinpay-sdk-taskmarket/0.8',
      'X-Taskmarket-Idempotency-Key': idempotencyKey,
    },
    body,
  });

  if (res.ok) return res.json().catch(() => ({}));
  if (res.status !== 402) {
    const result = await res.json().catch(() => ({}));
    throw new TaskMarketError(res.status, `POST /api/tasks failed (${res.status})`, result);
  }

  // ── Payment required: pick a rail we can sign, then ask the user. ──
  const requirements = await res.json().catch(() => ({}));
  const accepts = Array.isArray(requirements.accepts) ? requirements.accepts : [];
  if (accepts.length === 0) {
    throw new TaskMarketError(402, 'TaskMarket sent no accepted payment methods', requirements);
  }
  const accept = selectAcceptEntry(accepts, capabilities) ?? accepts[0];
  if (!accept) throw new TaskMarketError(402, 'No acceptable payment method for this wallet', requirements);

  if (!withinSpendingLimit(accept, spendingLimitUsd)) {
    throw new TaskMarketError(
      402,
      `Payment of ${requiredAmount(accept)} ${accept.asset} exceeds spendingLimitUsd=${spendingLimitUsd}`
    );
  }

  const details = {
    resource: requirements.resource,
    scheme: accept.scheme,
    network: accept.network,
    amount: requiredAmount(accept),
    asset: accept.asset,
    payTo: accept.payTo,
    maxTimeoutSeconds: accept.maxTimeoutSeconds,
  };
  if (authorize && !(await authorize(details))) {
    throw new PaymentNotAuthorizedError(details);
  }

  const authorization = buildAuthorization({
    from: signer.address,
    to: accept.payTo,
    value: requiredAmount(accept),
    validForSeconds: Number(accept.maxTimeoutSeconds ?? 300),
  });
  const signature = await signer.signTypedData({
    domain: accept.extra?.eip712?.domain,
    types: accept.extra?.eip712?.types,
    primaryType: accept.extra?.eip712?.primaryType,
    message: authorization,
  });

  const paymentPayload = {
    x402Version: X402_VERSION,
    resource: requirements.resource,
    accepted: {
      scheme: accept.scheme,
      network: accept.network,
      amount: requiredAmount(accept),
      asset: accept.asset,
      payTo: accept.payTo,
      maxTimeoutSeconds: accept.maxTimeoutSeconds,
      extra: accept.extra,
    },
    payload: { authorization, signature },
  };

  const paid = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'coinpay-sdk-taskmarket/0.8',
      'X-Taskmarket-Idempotency-Key': idempotencyKey,
      'PAYMENT-SIGNATURE': encodePaymentHeader(paymentPayload),
    },
    body,
  });
  const result = await paid.json().catch(() => ({}));
  if (!paid.ok) {
    // Settlement state is unknown — never auto-retry the payment.
    throw new TaskMarketError(
      paid.status,
      `POST /api/tasks failed after payment (${paid.status}). ` +
        'Verify settlement with getTask(taskId) before retrying.',
      result
    );
  }
  return result;
}
